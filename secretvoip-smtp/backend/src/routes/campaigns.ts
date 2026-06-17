import { Router } from 'express';
import { z } from 'zod';
import { query, tx } from '../db';
import { requireAuth, requirePasswordOk } from '../auth/middleware';
import { audit } from '../lib/audit';
import { campaignQueue } from '../queue';
import { getQuota } from '../lib/quota';
import { buildTransport, renderTemplate } from '../lib/mailer';

export const campaignsRouter = Router();
campaignsRouter.use(requireAuth, requirePasswordOk);

// --- list ---
campaignsRouter.get('/', async (req, res) => {
  const { rows } = await query(
    `SELECT id, name, subject, status, total, sent, delivered, failed, bounced, invalid,
            started_at, completed_at, created_at, updated_at
       FROM campaigns WHERE user_id=$1 ORDER BY created_at DESC LIMIT 200`,
    [req.user!.sub]
  );
  res.json({ campaigns: rows });
});

// --- get one ---
campaignsRouter.get('/:id', async (req, res) => {
  const { rows } = await query(
    `SELECT * FROM campaigns WHERE id=$1 AND user_id=$2`,
    [req.params.id, req.user!.sub]
  );
  const c = rows[0];
  if (!c) return res.status(404).json({ error: 'not_found' });

  // live counts
  const { rows: counts } = await query<{ status: string; n: string }>(
    `SELECT status, COUNT(*)::text AS n FROM campaign_recipients WHERE campaign_id=$1 GROUP BY status`,
    [req.params.id]
  );
  const breakdown: Record<string, number> = {
    queued: 0, processing: 0, delivered: 0, failed: 0, bounced: 0, invalid: 0, delayed: 0, cancelled: 0,
  };
  for (const r of counts) breakdown[r.status] = parseInt(r.n, 10);
  res.json({ campaign: c, breakdown });
});

// --- recipients page ---
campaignsRouter.get('/:id/recipients', async (req, res) => {
  const status = req.query.status as string | undefined;
  const { rows } = await query(
    `SELECT id, email, first_name, last_name, company, status, smtp_id, error, attempts, sent_at, updated_at
       FROM campaign_recipients
      WHERE campaign_id=$1 AND ($2::text IS NULL OR status=$2)
      ORDER BY updated_at DESC LIMIT 1000`,
    [req.params.id, status ?? null]
  );
  res.json({ recipients: rows });
});

// --- create / save draft ---
const upsertSchema = z.object({
  name: z.string().min(1).max(200),
  subject: z.string().min(1).max(500),
  html: z.string().max(500_000).default(''),
  text: z.string().max(200_000).default(''),
  list_id: z.string().uuid().optional(),
  smtp_ids: z.array(z.string().uuid()).default([]),
});

campaignsRouter.post('/', async (req, res) => {
  const v = upsertSchema.parse(req.body);
  const { rows } = await query<{ id: string }>(
    `INSERT INTO campaigns (user_id, name, subject, html, text, list_id, smtp_ids)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [req.user!.sub, v.name, v.subject, v.html, v.text, v.list_id ?? null, v.smtp_ids]
  );
  await audit(req, 'campaigns.create', rows[0].id, { name: v.name });
  res.status(201).json({ id: rows[0].id });
});

campaignsRouter.patch('/:id', async (req, res) => {
  const v = upsertSchema.partial().parse(req.body);
  const fields: string[] = []; const vals: any[] = [];
  for (const [k, val] of Object.entries(v)) {
    if (val === undefined) continue;
    vals.push(val); fields.push(`${k}=$${vals.length}`);
  }
  if (!fields.length) return res.json({ ok: true });
  vals.push(req.params.id, req.user!.sub);
  await query(
    `UPDATE campaigns SET ${fields.join(',')}, updated_at=now()
      WHERE id=$${vals.length - 1} AND user_id=$${vals.length}
        AND status IN ('draft','paused','queued')`, vals
  );
  res.json({ ok: true });
});

// --- duplicate ---
campaignsRouter.post('/:id/duplicate', async (req, res) => {
  const { rows } = await query<{ id: string }>(
    `INSERT INTO campaigns (user_id, name, subject, html, text, list_id, smtp_ids)
     SELECT user_id, name || ' (copy)', subject, html, text, list_id, smtp_ids
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
    const info = await t.sendMail({
      from: `"${smtp.from_name}" <${smtp.from_email}>`,
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
  const { rows: cRows } = await query<any>(
    `SELECT * FROM campaigns WHERE id=$1 AND user_id=$2`, [req.params.id, req.user!.sub]
  );
  const c = cRows[0]; if (!c) return res.status(404).json({ error: 'not_found' });
  if (!['draft', 'paused'].includes(c.status)) return res.status(400).json({ error: 'bad_state' });
  if (!c.smtp_ids?.length) return res.status(400).json({ error: 'no_smtp' });
  if (!c.list_id) return res.status(400).json({ error: 'no_list' });

  // verify quotas
  const q = await getQuota(req.user!.sub);
  const { rows: listCount } = await query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM contacts WHERE user_id=$1 AND list_id=$2`,
    [req.user!.sub, c.list_id]
  );
  const audience = parseInt(listCount[0].n, 10);
  if (audience === 0) return res.status(400).json({ error: 'empty_list' });
  if (audience > q.daily_remaining) return res.status(400).json({ error: 'over_daily_limit', remaining: q.daily_remaining });
  if (audience > q.monthly_remaining) return res.status(400).json({ error: 'over_monthly_limit', remaining: q.monthly_remaining });

  await tx(async (q) => {
    if (c.status === 'draft') {
      await q(
        `INSERT INTO campaign_recipients (campaign_id, email, first_name, last_name, company)
         SELECT $1, email, first_name, last_name, company
           FROM contacts WHERE user_id=$2 AND list_id=$3`,
        [c.id, req.user!.sub, c.list_id]
      );
      await q(
        `UPDATE campaigns SET total=$1, status='queued', started_at=now(), updated_at=now() WHERE id=$2`,
        [audience, c.id]
      );
    } else {
      // resume from paused — re-queue anything still queued/delayed
      await q(`UPDATE campaigns SET status='queued', updated_at=now() WHERE id=$1`, [c.id]);
    }
  });

  // enqueue jobs for everything still in queued/delayed state
  const { rows: pending } = await query<{ id: string }>(
    `SELECT id FROM campaign_recipients WHERE campaign_id=$1 AND status IN ('queued','delayed')`,
    [c.id]
  );
  const jobs = pending.map(p => ({
    name: 'send',
    data: { recipientId: p.id, campaignId: c.id, userId: req.user!.sub },
    opts: { jobId: `r:${p.id}` },
  }));
  if (jobs.length) await campaignQueue.addBulk(jobs as any);

  await audit(req, 'campaigns.start', c.id, { audience });
  res.json({ ok: true, queued: jobs.length });
});

// --- pause ---
campaignsRouter.post('/:id/pause', async (req, res) => {
  await query(
    `UPDATE campaigns SET status='paused', updated_at=now()
      WHERE id=$1 AND user_id=$2 AND status IN ('queued','processing')`,
    [req.params.id, req.user!.sub]
  );
  await audit(req, 'campaigns.pause', req.params.id);
  res.json({ ok: true });
});

// --- resume ---
campaignsRouter.post('/:id/resume', async (req, res) => {
  await query(
    `UPDATE campaigns SET status='queued', updated_at=now()
      WHERE id=$1 AND user_id=$2 AND status='paused'`,
    [req.params.id, req.user!.sub]
  );
  // Re-enqueue jobs that have no live job (worker also re-checks campaign status)
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

// --- cancel ---
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

// --- delete ---
campaignsRouter.delete('/:id', async (req, res) => {
  await query(
    `DELETE FROM campaigns WHERE id=$1 AND user_id=$2 AND status IN ('draft','completed','cancelled','failed')`,
    [req.params.id, req.user!.sub]
  );
  await audit(req, 'campaigns.delete', req.params.id);
  res.json({ ok: true });
});
