import { Router } from 'express';
import { z } from 'zod';
import { query, tx } from '../db';
import { requireAuth, requirePasswordOk } from '../auth/middleware';
import { audit } from '../lib/audit';
import { campaignQueue, queueEventsState } from '../queue';
import { redis, bullConnection } from '../redis';
import { buildTransport, renderTemplate } from '../lib/mailer';
import { getGlobalQuota } from '../lib/quota';

export const campaignsRouter = Router();
campaignsRouter.use(requireAuth, requirePasswordOk);

const LAST_INSERT_KEY = 'smtp:queue:last_insert';


const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function parseRecipients(input: string[] | undefined): { valid: string[]; invalid: string[]; duplicates: number } {
  if (!input || !input.length) return { valid: [], invalid: [], duplicates: 0 };
  const seen = new Set<string>();
  const valid: string[] = [];
  const invalid: string[] = [];
  let duplicates = 0;
  for (const raw of input) {
    const e = String(raw ?? '').trim().toLowerCase();
    if (!e) continue;
    if (seen.has(e)) { duplicates++; continue; }
    seen.add(e);
    if (EMAIL_RE.test(e)) valid.push(e);
    else invalid.push(e);
  }
  return { valid, invalid, duplicates };
}

// Augment campaign rows with `accepted` alias of delivered for back-compat
function withAccepted<T extends Record<string, any>>(c: T) {
  if (!c) return c;
  return { ...c, accepted: c.accepted ?? c.delivered ?? 0 };
}

// --- list ---
campaignsRouter.get('/', async (req, res) => {
  const { rows } = await query(
    `SELECT id, name, subject, from_name, status, total, sent, accepted, delivered, failed, bounced, invalid,
            started_at, completed_at, created_at, updated_at
       FROM campaigns WHERE user_id=$1 ORDER BY created_at DESC LIMIT 500`,
    [req.user!.sub]
  );
  res.json({ campaigns: rows.map(withAccepted) });
});

// --- get one ---
campaignsRouter.get('/:id', async (req, res) => {
  const { rows } = await query(
    `SELECT * FROM campaigns WHERE id=$1 AND user_id=$2`,
    [req.params.id, req.user!.sub]
  );
  const c = rows[0];
  if (!c) return res.status(404).json({ error: 'not_found' });

  const { rows: counts } = await query<{ status: string; n: string }>(
    `SELECT status, COUNT(*)::text AS n FROM campaign_recipients WHERE campaign_id=$1 GROUP BY status`,
    [req.params.id]
  );
  const breakdown: Record<string, number> = {
    queued: 0, processing: 0, delivered: 0, accepted: 0, failed: 0, bounced: 0, invalid: 0, delayed: 0, cancelled: 0,
  };
  for (const r of counts) breakdown[r.status] = parseInt(r.n, 10);
  breakdown.accepted = breakdown.delivered; // surface "accepted" terminology
  res.json({ campaign: withAccepted(c), breakdown });
});

// --- recipients page ---
campaignsRouter.get('/:id/recipients', async (req, res) => {
  const status = req.query.status as string | undefined;
  const { rows } = await query(
    `SELECT id, email, first_name, last_name, company, status, smtp_id, error,
            attempts, sent_at, updated_at, smtp_response, message_id
       FROM campaign_recipients
      WHERE campaign_id=$1 AND ($2::text IS NULL OR status=$2)
      ORDER BY updated_at DESC LIMIT 2000`,
    [req.params.id, status ?? null]
  );
  res.json({ recipients: rows });
});

// --- create / save draft ---
const upsertSchema = z.object({
  name: z.string().min(1).max(200),
  subject: z.string().min(1).max(500),
  from_name: z.string().max(200).optional().nullable(),
  html: z.string().max(2_000_000).default(''),
  text: z.string().max(500_000).default(''),
  list_id: z.string().uuid().optional(), // legacy — still supported
  smtp_ids: z.array(z.string().uuid()).default([]),
  recipients: z.array(z.string()).max(2_000_000).optional(),
});

async function insertRecipients(campaignId: string, emails: string[]) {
  if (!emails.length) return 0;
  // Batch insert in chunks to avoid huge single statements
  const CHUNK = 1000;
  let inserted = 0;
  for (let i = 0; i < emails.length; i += CHUNK) {
    const slice = emails.slice(i, i + CHUNK);
    const values = slice.map((_, j) => `($1, $${j + 2}, 'queued')`).join(',');
    await query(
      `INSERT INTO campaign_recipients (campaign_id, email, status) VALUES ${values}`,
      [campaignId, ...slice]
    );
    inserted += slice.length;
  }
  return inserted;
}

campaignsRouter.post('/', async (req, res) => {
  const v = upsertSchema.parse(req.body);
  const parsed = parseRecipients(v.recipients);
  const { rows } = await query<{ id: string }>(
    `INSERT INTO campaigns (user_id, name, subject, from_name, html, text, list_id, smtp_ids)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [req.user!.sub, v.name, v.subject, v.from_name ?? null, v.html, v.text, v.list_id ?? null, v.smtp_ids]
  );
  const id = rows[0].id;
  if (parsed.valid.length) {
    await insertRecipients(id, parsed.valid);
    await query(`UPDATE campaigns SET total=$1, updated_at=now() WHERE id=$2`, [parsed.valid.length, id]);
  }
  await audit(req, 'campaigns.create', id, { name: v.name, recipients: parsed.valid.length });
  res.status(201).json({
    id,
    recipients: {
      valid: parsed.valid.length,
      invalid: parsed.invalid.length,
      duplicates: parsed.duplicates,
    },
  });
});

campaignsRouter.patch('/:id', async (req, res) => {
  const v = upsertSchema.partial().parse(req.body);
  const fields: string[] = []; const vals: any[] = [];
  for (const [k, val] of Object.entries(v)) {
    if (val === undefined) continue;
    if (k === 'recipients') continue; // handled separately
    vals.push(val); fields.push(`${k}=$${vals.length}`);
  }
  if (fields.length) {
    vals.push(req.params.id, req.user!.sub);
    await query(
      `UPDATE campaigns SET ${fields.join(',')}, updated_at=now()
        WHERE id=$${vals.length - 1} AND user_id=$${vals.length}
          AND status IN ('draft','paused','queued')`, vals
    );
  }

  let recipientsResult: { valid: number; invalid: number; duplicates: number } | undefined;
  if (v.recipients !== undefined) {
    // Only allow recipient replace while draft
    const { rows: cRows } = await query<{ status: string }>(
      `SELECT status FROM campaigns WHERE id=$1 AND user_id=$2`,
      [req.params.id, req.user!.sub]
    );
    if (cRows[0] && cRows[0].status === 'draft') {
      const parsed = parseRecipients(v.recipients);
      await query(`DELETE FROM campaign_recipients WHERE campaign_id=$1`, [req.params.id]);
      if (parsed.valid.length) await insertRecipients(req.params.id, parsed.valid);
      await query(`UPDATE campaigns SET total=$1, updated_at=now() WHERE id=$2`,
        [parsed.valid.length, req.params.id]);
      recipientsResult = {
        valid: parsed.valid.length, invalid: parsed.invalid.length, duplicates: parsed.duplicates,
      };
    }
  }

  res.json({ ok: true, recipients: recipientsResult });
});

// --- bulk-add recipients (used by editor for paste / upload) ---
const recipientsSchema = z.object({
  recipients: z.array(z.string()).min(1).max(2_000_000),
  replace: z.boolean().optional(),
});
campaignsRouter.post('/:id/recipients', async (req, res) => {
  const v = recipientsSchema.parse(req.body);
  const { rows: cRows } = await query<{ status: string }>(
    `SELECT status FROM campaigns WHERE id=$1 AND user_id=$2`,
    [req.params.id, req.user!.sub]
  );
  if (!cRows[0]) return res.status(404).json({ error: 'not_found' });
  if (cRows[0].status !== 'draft') return res.status(400).json({ error: 'not_draft' });

  const parsed = parseRecipients(v.recipients);
  if (v.replace) {
    await query(`DELETE FROM campaign_recipients WHERE campaign_id=$1`, [req.params.id]);
  }
  if (parsed.valid.length) await insertRecipients(req.params.id, parsed.valid);
  const { rows: tot } = await query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM campaign_recipients WHERE campaign_id=$1`,
    [req.params.id]
  );
  const total = parseInt(tot[0].n, 10);
  await query(`UPDATE campaigns SET total=$1, updated_at=now() WHERE id=$2`, [total, req.params.id]);
  res.json({ ok: true, total, ...parsed, valid: parsed.valid.length, invalid: parsed.invalid.length });
});

// --- duplicate ---
campaignsRouter.post('/:id/duplicate', async (req, res) => {
  const { rows } = await query<{ id: string }>(
    `INSERT INTO campaigns (user_id, name, subject, from_name, html, text, list_id, smtp_ids)
     SELECT user_id, name || ' (copy)', subject, from_name, html, text, list_id, smtp_ids
       FROM campaigns WHERE id=$1 AND user_id=$2
     RETURNING id`,
    [req.params.id, req.user!.sub]
  );
  if (!rows[0]) return res.status(404).json({ error: 'not_found' });
  await audit(req, 'campaigns.duplicate', rows[0].id);
  res.status(201).json({ id: rows[0].id });
});

// --- test send ---
const testSchema = z.object({ email: z.string().email() });
campaignsRouter.post('/:id/test', async (req, res) => {
  const { email } = testSchema.parse(req.body);
  const { rows: cRows } = await query<any>(
    `SELECT * FROM campaigns WHERE id=$1 AND user_id=$2`, [req.params.id, req.user!.sub]
  );
  const c = cRows[0]; if (!c) return res.status(404).json({ error: 'not_found' });
  const smtpId = c.smtp_ids?.[0];
  if (!smtpId) return res.status(400).json({ error: 'no_smtp_selected' });
  const { rows: sRows } = await query<any>(
    `SELECT * FROM smtp_configs WHERE id=$1 AND user_id=$2 AND status='active'`,
    [smtpId, req.user!.sub]
  );
  const smtp = sRows[0]; if (!smtp) return res.status(400).json({ error: 'smtp_not_found' });

  try {
    const t = buildTransport(smtp);
    const vars = { email, first_name: 'Test', last_name: 'Recipient', company: 'Test Co' };
    const fromName = c.from_name || smtp.from_name;
    const info = await t.sendMail({
      from: `"${fromName}" <${smtp.from_email}>`,
      to: email,
      subject: `[TEST] ${renderTemplate(c.subject, vars)}`,
      html: renderTemplate(c.html, vars),
      text: renderTemplate(c.text, vars),
    });
    await audit(req, 'campaigns.test_send', req.params.id, { email });
    res.json({ ok: true, message_id: info.messageId });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e?.message ?? String(e) });
  }
});

// --- start ---
campaignsRouter.post('/:id/start', async (req, res) => {
  try {
    const gq = await getGlobalQuota();
    if (gq.active && gq.exhausted) {
      return res.status(403).json({ error: 'quota_exhausted', message: 'Global SMTP quota exhausted. Contact administrator.' });
    }
    const { rows: cRows } = await query<any>(
      `SELECT * FROM campaigns WHERE id=$1 AND user_id=$2`, [req.params.id, req.user!.sub]
    );
    const c = cRows[0];
    if (!c) return res.status(404).json({ error: 'not_found', message: 'Campaign not found.' });
    if (!['draft', 'paused'].includes(c.status)) {
      return res.status(400).json({ error: 'bad_state', message: `Campaign is "${c.status}" and cannot be started.` });
    }
    if (!c.smtp_ids?.length) {
      return res.status(400).json({ error: 'no_smtp', message: 'Select at least one SMTP server.' });
    }
    // Verify the selected SMTPs still exist and are active for this user
    const { rows: smtpCheck } = await query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM smtp_configs
        WHERE user_id=$1 AND status='active' AND id = ANY($2::uuid[])`,
      [req.user!.sub, c.smtp_ids]
    );
    if (parseInt(smtpCheck[0].n, 10) === 0) {
      return res.status(400).json({ error: 'no_active_smtp', message: 'No active SMTP server matches your campaign selection.' });
    }

    try {
      await tx(async (q) => {
        if (c.status === 'draft') {
          const { rows: existing } = await q<{ n: string }>(
            `SELECT COUNT(*)::text AS n FROM campaign_recipients WHERE campaign_id=$1`, [c.id]
          );
          const existingCount = parseInt(existing[0].n, 10);
          if (existingCount === 0 && c.list_id) {
            await q(
              `INSERT INTO campaign_recipients (campaign_id, email, first_name, last_name, company)
               SELECT $1, email, first_name, last_name, company
                 FROM contacts WHERE user_id=$2 AND list_id=$3`,
              [c.id, req.user!.sub, c.list_id]
            );
          }
          const { rows: tot } = await q<{ n: string }>(
            `SELECT COUNT(*)::text AS n FROM campaign_recipients WHERE campaign_id=$1`, [c.id]
          );
          const total = parseInt(tot[0].n, 10);
          if (total === 0) throw Object.assign(new Error('no_recipients'), { status: 400, code: 'no_recipients' });
          await q(
            `UPDATE campaigns SET total=$1, status='queued', started_at=COALESCE(started_at, now()), updated_at=now()
              WHERE id=$2`,
            [total, c.id]
          );
        } else {
          await q(`UPDATE campaigns SET status='queued', updated_at=now() WHERE id=$1`, [c.id]);
        }
      });
    } catch (e: any) {
      if (e?.code === 'no_recipients') {
        return res.status(400).json({ error: 'no_recipients', message: 'Add at least one valid recipient before sending.' });
      }
      return res.status(500).json({ error: 'database_error', message: e?.message ?? 'Failed to prepare campaign.' });
    }

    const { rows: pending } = await query<{ id: string }>(
      `SELECT id FROM campaign_recipients WHERE campaign_id=$1 AND status IN ('queued','delayed')`,
      [c.id]
    );
    const jobs = pending.map(p => ({
      name: 'send',
      data: { recipientId: p.id, campaignId: c.id, userId: req.user!.sub },
      opts: { jobId: `r:${p.id}` },
    }));
    if (jobs.length) {
      // Pre-flight: Redis reachable?
      console.log('QUEUE ADD START campaign=' + c.id + ' jobs=' + jobs.length);
      try {
        const pong = await bullConnection.ping();
        if (pong !== 'PONG') throw new Error('redis_ping_unexpected: ' + pong);
      } catch (e: any) {
        console.error('QUEUE ADD FAILED redis_unreachable', e);
        await query(`UPDATE campaigns SET status='draft', updated_at=now() WHERE id=$1`, [c.id]).catch(() => {});
        return res.status(503).json({
          error: 'redis_unreachable',
          message: 'Redis connection failed: ' + (e?.message ?? String(e)),
        });
      }

      // Pre-flight: worker(s) connected?
      let workersConnected = 0;
      try {
        const workers = await campaignQueue.getWorkers();
        workersConnected = workers?.length ?? 0;
      } catch (e: any) {
        console.error('QUEUE ADD FAILED getWorkers', e);
      }

      // QueueEvents readiness (non-fatal warning)
      if (!queueEventsState.ready) {
        console.warn('QUEUE EVENTS not ready at start: ' + (queueEventsState.lastError ?? 'unknown'));
      }

      try {
        const added = await campaignQueue.addBulk(jobs as any);
        console.log('QUEUE ADD SUCCESS campaign=' + c.id + ' added=' + added.length);
        await redis.set(LAST_INSERT_KEY, JSON.stringify({
          at: Date.now(), campaignId: c.id, count: added.length,
        }), 'EX', 86400).catch(() => {});
      } catch (e: any) {
        console.error('QUEUE ADD FAILED bulk', e);
        await query(`UPDATE campaigns SET status='draft', updated_at=now() WHERE id=$1`, [c.id]).catch(() => {});
        return res.status(503).json({
          error: 'queue_add_failed',
          message: 'Queue add failed: ' + (e?.message ?? String(e)),
          detail: {
            redis: 'ok',
            workers_connected: workersConnected,
            queue_events_ready: queueEventsState.ready,
            queue_events_error: queueEventsState.lastError ?? null,
          },
        });
      }

      // Post-insert: if no workers were connected, surface a clear (but non-destructive) warning.
      // Jobs are safely persisted in Redis and will be picked up once a worker starts.
      if (workersConnected === 0) {
        await audit(req, 'campaigns.start', c.id, { queued: jobs.length, warning: 'no_worker_connected' });
        return res.status(202).json({
          ok: true,
          queued: jobs.length,
          warning: 'no_worker_connected',
          message: 'Jobs were queued, but no worker process is currently connected. Start the worker (systemctl start secretvoip-smtp-worker) — queued jobs will resume automatically.',
        });
      }
    }

    await audit(req, 'campaigns.start', c.id, { queued: jobs.length });
    res.json({ ok: true, queued: jobs.length });

  } catch (e: any) {
    return res.status(500).json({
      error: 'start_failed',
      message: e?.message ?? 'Unexpected error while starting campaign.',
    });
  }
});

campaignsRouter.post('/:id/pause', async (req, res) => {
  await query(
    `UPDATE campaigns SET status='paused', updated_at=now()
      WHERE id=$1 AND user_id=$2 AND status IN ('queued','processing')`,
    [req.params.id, req.user!.sub]
  );
  await audit(req, 'campaigns.pause', req.params.id);
  res.json({ ok: true });
});

campaignsRouter.post('/:id/resume', async (req, res) => {
  await query(
    `UPDATE campaigns SET status='queued', updated_at=now()
      WHERE id=$1 AND user_id=$2 AND status='paused'`,
    [req.params.id, req.user!.sub]
  );
  const { rows: pending } = await query<{ id: string }>(
    `SELECT id FROM campaign_recipients WHERE campaign_id=$1 AND status IN ('queued','delayed')`,
    [req.params.id]
  );
  const jobs = pending.map(p => ({
    name: 'send',
    data: { recipientId: p.id, campaignId: req.params.id, userId: req.user!.sub },
    opts: { jobId: `r:${p.id}` },
  }));
  if (jobs.length) await campaignQueue.addBulk(jobs as any);
  await audit(req, 'campaigns.resume', req.params.id);
  res.json({ ok: true, queued: jobs.length });
});

campaignsRouter.post('/:id/cancel', async (req, res) => {
  await tx(async (q) => {
    await q(
      `UPDATE campaigns SET status='cancelled', completed_at=now(), updated_at=now()
        WHERE id=$1 AND user_id=$2 AND status IN ('draft','queued','processing','paused')`,
      [req.params.id, req.user!.sub]
    );
    await q(
      `UPDATE campaign_recipients SET status='cancelled', updated_at=now()
        WHERE campaign_id=$1 AND status IN ('queued','processing','delayed')`,
      [req.params.id]
    );
  });
  await audit(req, 'campaigns.cancel', req.params.id);
  res.json({ ok: true });
});

// Alias for stop = cancel (front-end terminology)
campaignsRouter.post('/:id/stop', async (req, res) => {
  await tx(async (q) => {
    await q(
      `UPDATE campaigns SET status='cancelled', completed_at=now(), updated_at=now()
        WHERE id=$1 AND user_id=$2 AND status IN ('draft','queued','processing','paused')`,
      [req.params.id, req.user!.sub]
    );
    await q(
      `UPDATE campaign_recipients SET status='cancelled', updated_at=now()
        WHERE campaign_id=$1 AND status IN ('queued','processing','delayed')`,
      [req.params.id]
    );
  });
  await audit(req, 'campaigns.stop', req.params.id);
  res.json({ ok: true });
});

campaignsRouter.delete('/:id', async (req, res) => {
  await query(
    `DELETE FROM campaigns WHERE id=$1 AND user_id=$2 AND status IN ('draft','completed','cancelled','failed')`,
    [req.params.id, req.user!.sub]
  );
  await audit(req, 'campaigns.delete', req.params.id);
  res.json({ ok: true });
});
