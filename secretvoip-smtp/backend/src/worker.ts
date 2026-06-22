import { Worker, Job } from 'bullmq';
import { env } from './env';
import { logger } from './logger';
import { bullConnection, redis } from './redis';
import { query } from './db';
import { CAMPAIGN_QUEUE, SendJob } from './queue';
import { buildTransport, renderTemplate, SmtpRow } from './lib/mailer';
import { incrementUsage, reserveGlobalQuota, getGlobalQuota, reserveUserQuota, getUserQuota } from './lib/quota';
import { loadPerfSettings, getPerfSettingsSync } from './lib/perfSettings';

// Detect SMTP throttling / rate-limit / soft-fail errors.
// Returns ms to wait before retry, or 0 if not throttled.
function detectSmtpThrottle(e: any): number {
  const msg = String(e?.message ?? e ?? '').toLowerCase();
  const code = String(e?.responseCode ?? e?.code ?? '');
  if (/^(421|450|451|452|454)$/.test(code)) return 30_000;
  if (/\b(421|450|451|452|454)\b/.test(msg)) return 30_000;
  if (/too many (connections|messages|recipients)/.test(msg)) return 60_000;
  if (/rate ?limit|throttl|try again later|temporar/.test(msg)) return 45_000;
  if (/etimedout|esockettimedout|econnreset|econnrefused|timeout/.test(msg)) return 15_000;
  return 0;
}


// ---- Worker heartbeat (read by /diagnostics) -----------------------------
const WORKER_HEARTBEAT_KEY = 'smtp:worker:heartbeat';
const workerState: {
  pid: number; startedAt: number;
  lastJobId?: string; lastJobAt?: number; lastJobStatus?: 'ok' | 'fail';
  lastError?: string; lastErrorAt?: number;
} = { pid: process.pid, startedAt: Date.now() };

async function writeHeartbeat() {
  try {
    await redis.set(WORKER_HEARTBEAT_KEY, JSON.stringify(workerState), 'EX', 15);
  } catch (e: any) {
    logger.warn({ err: e?.message }, 'worker_heartbeat_failed');
  }
}

// Simple per-user, per-day rotation index for SMTP selection.
const rotationCursor = new Map<string, number>();

async function loadSmtp(userId: string, smtpIds: string[]): Promise<SmtpRow | null> {
  if (!smtpIds.length) return null;
  const { rows } = await query<SmtpRow>(
    `SELECT id, host, port, username, password_enc, secure, starttls, from_name, from_email
       FROM smtp_configs WHERE user_id=$1 AND status='active' AND id = ANY($2::uuid[])`,
    [userId, smtpIds]
  );
  if (!rows.length) return null;
  const key = `${userId}`;
  const idx = (rotationCursor.get(key) ?? 0) % rows.length;
  rotationCursor.set(key, idx + 1);
  return rows[idx];
}

async function handleJob(job: Job<SendJob>) {
  const { recipientId, campaignId, userId } = job.data;

  // Reload campaign to honor pause/cancel mid-flight
  const { rows: cRows } = await query<{ id: string; status: string; subject: string; html: string; text: string; from_name: string | null; smtp_ids: string[] }>(
    `SELECT id, status, subject, html, text, from_name, smtp_ids FROM campaigns WHERE id=$1`, [campaignId]
  );
  const c = cRows[0];
  if (!c) throw new Error('campaign_missing');
  if (c.status === 'paused') {
    // Defer: re-enqueue after a delay so we don't block the queue.
    throw Object.assign(new Error('paused'), { retryAfterMs: 60_000 });
  }
  if (c.status === 'cancelled' || c.status === 'completed' || c.status === 'failed') {
    await query(
      `UPDATE campaign_recipients SET status='cancelled', updated_at=now()
        WHERE id=$1 AND status IN ('queued','processing','delayed')`,
      [recipientId]
    );
    return;
  }

  const { rows: rRows } = await query<any>(
    `SELECT id, email, first_name, last_name, company, attempts, status
       FROM campaign_recipients WHERE id=$1 AND campaign_id=$2`,
    [recipientId, campaignId]
  );
  const r = rRows[0];
  if (!r) return;
  if (['delivered', 'cancelled', 'invalid'].includes(r.status)) return;

  await query(
    `UPDATE campaign_recipients SET status='processing', attempts=attempts+1, updated_at=now() WHERE id=$1`,
    [recipientId]
  );
  // Flip campaign to processing on the first real send
  await query(
    `UPDATE campaigns SET status='processing', updated_at=now()
      WHERE id=$1 AND status IN ('queued')`, [campaignId]
  );

  // Validate email
  const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
  if (!EMAIL_RE.test(r.email)) {
    await query(`UPDATE campaign_recipients SET status='invalid', error=$2, updated_at=now() WHERE id=$1`,
      [recipientId, 'invalid_email']);
    await query(
      `INSERT INTO email_logs (user_id, campaign_id, recipient, status, error) VALUES ($1,$2,$3,'invalid',$4)`,
      [userId, campaignId, r.email, 'invalid_email']
    );
    await query(`UPDATE campaigns SET invalid=invalid+1, updated_at=now() WHERE id=$1`, [campaignId]);
    await maybeComplete(campaignId);
    return;
  }

  const smtp = await loadSmtp(userId, c.smtp_ids);
  if (!smtp) {
    await query(`UPDATE campaign_recipients SET status='failed', error='no_active_smtp', updated_at=now() WHERE id=$1`, [recipientId]);
    await query(`UPDATE campaigns SET failed=failed+1, updated_at=now() WHERE id=$1`, [campaignId]);
    await query(
      `INSERT INTO email_logs (user_id, campaign_id, recipient, status, error) VALUES ($1,$2,$3,'failed','no_active_smtp')`,
      [userId, campaignId, r.email]
    );
    await maybeComplete(campaignId);
    return;
  }

  const vars = {
    email: r.email,
    first_name: r.first_name ?? '',
    last_name: r.last_name ?? '',
    company: r.company ?? '',
  };

  // Per-user quota: skip and requeue if exhausted
  const uq = await getUserQuota(userId).catch(() => null);
  if (uq && uq.active && uq.exhausted) {
    await query(
      `UPDATE campaign_recipients SET status='queued', error='user_quota_exhausted', updated_at=now() WHERE id=$1`,
      [recipientId]
    );
    throw Object.assign(new Error('user_quota_exhausted'), { retryAfterMs: 60_000 });
  }
  // Global shared quota: skip and requeue if exhausted; count on success.
  const gq = await getGlobalQuota();
  if (gq.active && gq.exhausted) {
    await query(
      `UPDATE campaign_recipients SET status='queued', error='global_quota_exhausted', updated_at=now() WHERE id=$1`,
      [recipientId]
    );
    throw Object.assign(new Error('global_quota_exhausted'), { retryAfterMs: 60_000 });
  }

  const startedAt = Date.now();
  try {
    const perf = getPerfSettingsSync();
    const t = buildTransport(smtp, { maxConnections: perf.max_smtp_connections });
    const fromName = c.from_name || smtp.from_name;
    const info = await t.sendMail({
      from: `"${fromName}" <${smtp.from_email}>`,
      to: r.email,
      subject: renderTemplate(c.subject, vars),
      html: renderTemplate(c.html, vars),
      text: renderTemplate(c.text, vars),
    });
    const rtMs = Date.now() - startedAt;
    const smtpResp = (info as any)?.response ? String((info as any).response).slice(0, 1000) : null;

    await query(
      `UPDATE campaign_recipients
          SET status='delivered', smtp_id=$2, sent_at=now(), updated_at=now(),
              smtp_response=$3, message_id=$4
        WHERE id=$1`,
      [recipientId, smtp.id, smtpResp, info.messageId ?? null]
    );
    await query(
      `UPDATE campaigns
          SET sent=sent+1, delivered=delivered+1, accepted=accepted+1, updated_at=now()
        WHERE id=$1`, [campaignId]
    );
    await query(
      `INSERT INTO email_logs (user_id, campaign_id, recipient, smtp_id, status, message_id, smtp_response, rt_ms)
       VALUES ($1,$2,$3,$4,'delivered',$5,$6,$7)`,
      [userId, campaignId, r.email, smtp.id, info.messageId ?? null, smtpResp, rtMs]
    );
    await query(
      `UPDATE smtp_configs SET last_success_at=now() WHERE id=$1`, [smtp.id]
    ).catch(() => {});
    await incrementUsage(userId, 1);
    await reserveUserQuota(userId, 1).catch(() => {});
    await reserveGlobalQuota(1).catch(() => {});
  } catch (e: any) {
    const rtMs = Date.now() - startedAt;
    const msg = (e?.message ?? String(e)).slice(0, 1000);
    const code: string = e?.code ?? '';
    const smtpResp = e?.response ? String(e.response).slice(0, 1000) : null;

    // 1) Detect SMTP throttling / soft fails FIRST. These are NOT bounces.
    //    Mark recipient as 'delayed' (NOT bounced/failed), do not deduct quota,
    //    do not increment campaign.failed/bounced counters, and retry later
    //    with adaptive backoff that grows under sustained throttling.
    const baseThrottleMs = detectSmtpThrottle(e);
    if (baseThrottleMs > 0) {
      // Adaptive backoff: count throttle hits per campaign in the last 60s.
      let hits = 1;
      try {
        const k = `smtp:throttle:hits:${campaignId}`;
        hits = await redis.incr(k);
        if (hits === 1) await redis.expire(k, 60);
      } catch {}
      // Global throttle counter (sliding 60s) — drives runtime EPS reduction.
      try {
        const gk = 'smtp:throttle:hits:global';
        const g = await redis.incr(gk);
        if (g === 1) await redis.expire(gk, 60);
      } catch {}
      // Multiplier scales 1x..6x based on recent throttle pressure.
      const mult = Math.min(6, 1 + Math.floor(hits / 10));
      const retryAfterMs = baseThrottleMs * mult;

      await query(
        `UPDATE campaign_recipients
            SET status='delayed', error=$2, smtp_id=$3, smtp_response=$4, updated_at=now()
          WHERE id=$1`,
        [recipientId, 'throttled: ' + msg, smtp.id, smtpResp]
      ).catch(() => {});
      await query(
        `INSERT INTO email_logs (user_id, campaign_id, recipient, smtp_id, status, error, smtp_response, rt_ms)
         VALUES ($1,$2,$3,$4,'delayed',$5,$6,$7)`,
        [userId, campaignId, r.email, smtp.id, 'throttled: ' + msg, smtpResp, rtMs]
      ).catch(() => {});
      await query(
        `UPDATE smtp_configs SET last_failed_at=now(), last_failed_error=$2 WHERE id=$1`,
        [smtp.id, 'throttled: ' + msg]
      ).catch(() => {});
      logger.warn({ campaignId, recipientId, hits, retryAfterMs, msg }, 'smtp_throttled');
      throw Object.assign(new Error('smtp_throttled:' + msg), { retryAfterMs });
    }

    // 2) Real failures (bounces / permanent errors).
    const bounced = /^EENVELOPE$|^EMESSAGE$/.test(code) || /55[0-9]/.test(msg);
    await query(
      `UPDATE campaign_recipients
          SET status=$2, error=$3, smtp_id=$4, smtp_response=$5, updated_at=now()
        WHERE id=$1`,
      [recipientId, bounced ? 'bounced' : 'failed', msg, smtp.id, smtpResp]
    );
    await query(
      `UPDATE campaigns SET ${bounced ? 'bounced=bounced+1' : 'failed=failed+1'}, updated_at=now() WHERE id=$1`,
      [campaignId]
    );
    await query(
      `INSERT INTO email_logs (user_id, campaign_id, recipient, smtp_id, status, error, smtp_response, rt_ms)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [userId, campaignId, r.email, smtp.id, bounced ? 'bounced' : 'failed', msg, smtpResp, rtMs]
    );
    await query(
      `UPDATE smtp_configs SET last_failed_at=now(), last_failed_error=$2 WHERE id=$1`,
      [smtp.id, msg]
    ).catch(() => {});
    if (!bounced && job.attemptsMade < (job.opts.attempts ?? 3)) {
      throw e; // let BullMQ retry with backoff
    }
  }

  await maybeComplete(campaignId);
}

async function maybeComplete(campaignId: string) {
  const { rows } = await query<{ pending: string; total: string; status: string }>(
    `SELECT
       (SELECT COUNT(*)::text FROM campaign_recipients
         WHERE campaign_id=$1 AND status IN ('queued','processing','delayed')) AS pending,
       (SELECT COUNT(*)::text FROM campaign_recipients WHERE campaign_id=$1) AS total,
       (SELECT status FROM campaigns WHERE id=$1) AS status`,
    [campaignId]
  );
  const r = rows[0]; if (!r) return;
  if (parseInt(r.pending, 10) === 0 && r.status !== 'cancelled' && r.status !== 'paused') {
    await query(
      `UPDATE campaigns SET status='completed', completed_at=now(), updated_at=now() WHERE id=$1 AND status <> 'completed'`,
      [campaignId]
    );
  }
}

// Boot perf settings synchronously (best-effort) then start worker.
const initialPerf = { ...getPerfSettingsSync() };
loadPerfSettings(true).catch(() => {});

const worker = new Worker<SendJob>(CAMPAIGN_QUEUE, async (job) => {
  try {
    await handleJob(job);
  } catch (e: any) {
    if (e?.retryAfterMs) {
      await job.moveToDelayed(Date.now() + e.retryAfterMs, job.token!);
      const RLE = (Worker as any).RateLimitError;
      throw RLE ? new RLE() : e;
    }
    throw e;
  }
}, {
  connection: bullConnection,
  concurrency: Math.max(env.WORKER_CONCURRENCY, initialPerf.worker_concurrency),
  limiter: { max: initialPerf.emails_per_second, duration: 1000 },
});

// Live-apply admin perf changes + automatic runtime throttle protection.
// Concurrency is adjusted dynamically based on recent throttling pressure
// (sliding 60s global counter). Admin-configured EPS/concurrency are never
// mutated — only the effective in-process values change while throttling
// is active, and recover gradually once SMTP stops pushing back.
let lastApplied = { conc: initialPerf.worker_concurrency };
let currentFactor = 1.0;          // 1.0 = full speed; 0.25..0.75 while throttled
let lastDegradeAt = 0;
let lastEffectiveConc = initialPerf.worker_concurrency;
let lastEffectiveEps  = initialPerf.emails_per_second;

function factorFromHits(hits: number): number {
  if (hits >= 50) return 0.25;
  if (hits >= 25) return 0.50;
  if (hits >= 10) return 0.75;
  return 1.0;
}

setInterval(async () => {
  try {
    const p = await loadPerfSettings(true);
    const baseConc = p.worker_concurrency;
    const baseEps  = p.emails_per_second;

    // 1) Admin changed base concurrency — reset our reference but keep factor.
    if (baseConc !== lastApplied.conc) {
      lastApplied.conc = baseConc;
      logger.info({ concurrency: baseConc }, 'worker_perf_base_changed');
    }

    // 2) Read current throttle pressure (last 60s, global).
    let hits = 0;
    try {
      const v = await redis.get('smtp:throttle:hits:global');
      hits = v ? parseInt(v, 10) : 0;
    } catch {}

    // 3) Compute target factor. Degrade immediately, recover gradually.
    const targetFactor = factorFromHits(hits);
    if (targetFactor < currentFactor) {
      currentFactor = targetFactor;        // degrade right away
      lastDegradeAt = Date.now();
    } else if (hits < 5) {
      // No meaningful pressure — step back up by +0.10 every tick (~+10%/10s).
      currentFactor = Math.min(1.0, currentFactor + 0.10);
    }
    // If hits between 5 and current threshold, hold steady.

    // 4) Apply effective concurrency and EPS limiter.
    const effConc = Math.max(1, Math.round(baseConc * currentFactor));
    const effEps  = Math.max(1, Math.round(baseEps  * currentFactor));
    if (effConc !== lastEffectiveConc) {
      (worker as any).concurrency = effConc;
      lastEffectiveConc = effConc;
    }
    if (effEps !== lastEffectiveEps) {
      // BullMQ exposes runtime limiter updates via the queue's rate limiter key.
      try {
        const fn: any = (worker as any).rateLimit;
        // No-op fallback: we cannot resize the in-memory limiter, but
        // reducing concurrency already throttles throughput. We log so
        // operators can see the effective EPS target.
        if (typeof fn === 'function') { /* reserved for future BullMQ API */ }
      } catch {}
      lastEffectiveEps = effEps;
    }

    if (currentFactor < 1.0 || hits > 0) {
      logger.info(
        { hits, factor: currentFactor, effConc, effEps, baseConc, baseEps },
        'worker_runtime_throttle'
      );
    }
  } catch {}
}, 10_000).unref?.();

worker.on('ready', () => {
  console.log('WORKER READY pid=' + process.pid + ' queue=' + CAMPAIGN_QUEUE);
  writeHeartbeat();
});
worker.on('active', (job) => {
  workerState.lastJobId = String(job.id ?? '');
  workerState.lastJobAt = Date.now();
  writeHeartbeat();
});
worker.on('completed', (job) => {
  workerState.lastJobStatus = 'ok';
  workerState.lastJobId = String(job.id ?? workerState.lastJobId ?? '');
  workerState.lastJobAt = Date.now();
  logger.debug({ jobId: job.id }, 'job_done');
  writeHeartbeat();
});
worker.on('failed', (job, err) => {
  workerState.lastJobStatus = 'fail';
  workerState.lastError = err?.message ?? String(err);
  workerState.lastErrorAt = Date.now();
  workerState.lastJobId = String(job?.id ?? workerState.lastJobId ?? '');
  workerState.lastJobAt = Date.now();
  logger.warn({ jobId: job?.id, err: err?.message }, 'job_failed');
  writeHeartbeat();
});
worker.on('error', (err) => {
  workerState.lastError = err?.message ?? String(err);
  workerState.lastErrorAt = Date.now();
  logger.error({ err }, 'worker_error');
  console.error('WORKER ERROR', err);
  writeHeartbeat();
});

logger.info({ pid: process.pid, concurrency: env.WORKER_CONCURRENCY, rate: env.WORKER_RATE_PER_SECOND }, 'secretvoip-smtp worker started');
console.log('WORKER START pid=' + process.pid + ' concurrency=' + env.WORKER_CONCURRENCY);
writeHeartbeat();
const hbTimer = setInterval(writeHeartbeat, 5000);
hbTimer.unref?.();

const shutdown = async (sig: string) => {
  logger.info({ sig }, 'worker shutting down');
  clearInterval(hbTimer);
  await redis.del(WORKER_HEARTBEAT_KEY).catch(() => {});
  await worker.close();
  process.exit(0);
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
