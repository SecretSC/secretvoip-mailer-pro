import { Worker, Job } from 'bullmq';
import { env } from './env';
import { logger } from './logger';
import { bullConnection } from './redis';
import { query } from './db';
import { CAMPAIGN_QUEUE, SendJob } from './queue';
import { buildTransport, renderTemplate, SmtpRow } from './lib/mailer';
import { incrementUsage, reserveGlobalQuota, getGlobalQuota } from './lib/quota';

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
    const t = buildTransport(smtp);
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
    await incrementUsage(userId, 1);
  } catch (e: any) {
    const rtMs = Date.now() - startedAt;
    const msg = (e?.message ?? String(e)).slice(0, 1000);
    const code: string = e?.code ?? '';
    const smtpResp = e?.response ? String(e.response).slice(0, 1000) : null;
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

const worker = new Worker<SendJob>(CAMPAIGN_QUEUE, async (job) => {
  try {
    await handleJob(job);
  } catch (e: any) {
    if (e?.retryAfterMs) {
      await job.moveToDelayed(Date.now() + e.retryAfterMs, job.token!);
      throw new Worker.RateLimitError?.() ?? e;
    }
    throw e;
  }
}, {
  connection: bullConnection,
  concurrency: env.WORKER_CONCURRENCY,
  limiter: { max: env.WORKER_RATE_PER_SECOND, duration: 1000 },
});

worker.on('completed', (job) => logger.debug({ jobId: job.id }, 'job_done'));
worker.on('failed', (job, err) => logger.warn({ jobId: job?.id, err: err?.message }, 'job_failed'));
worker.on('error', (err) => logger.error({ err }, 'worker_error'));

logger.info({ concurrency: env.WORKER_CONCURRENCY, rate: env.WORKER_RATE_PER_SECOND }, 'secretvoip-smtp worker started');

const shutdown = async (sig: string) => {
  logger.info({ sig }, 'worker shutting down');
  await worker.close();
  process.exit(0);
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
