import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db';
import { requireAuth, requirePasswordOk, requireRole } from '../auth/middleware';
import { audit } from '../lib/audit';
import { getGlobalQuota, setGlobalQuotaTotal, resetGlobalQuotaUsed } from '../lib/quota';

export const settingsRouter = Router();

// Everyone (authenticated) reads settings + global quota
settingsRouter.get('/', requireAuth, requirePasswordOk, async (_req, res) => {
  const { rows } = await query(
    `SELECT site_name, tagline, support_telegram, maintenance_mode,
            global_quota_total, global_quota_used, global_quota_reset_at
       FROM settings WHERE id=1`
  );
  const quota = await getGlobalQuota();
  res.json({ settings: rows[0], quota });
});

// Lightweight quota endpoint (every authenticated user can poll cheaply)
settingsRouter.get('/quota', requireAuth, requirePasswordOk, async (_req, res) => {
  res.json({ quota: await getGlobalQuota() });
});

const schema = z.object({
  site_name: z.string().min(1).max(120).optional(),
  tagline: z.string().min(1).max(200).optional(),
  support_telegram: z.string().max(120).optional(),
  maintenance_mode: z.boolean().optional(),
  global_quota_total: z.number().int().min(0).max(10_000_000_000).optional(),
});

settingsRouter.patch('/', requireAuth, requirePasswordOk, requireRole('admin'), async (req, res) => {
  const v = schema.parse(req.body);
  const fields: string[] = []; const vals: any[] = [];
  for (const [k, val] of Object.entries(v)) {
    if (val === undefined) continue;
    vals.push(val); fields.push(`${k}=$${vals.length}`);
  }
  if (fields.length) {
    await query(`UPDATE settings SET ${fields.join(',')}, updated_at=now() WHERE id=1`, vals);
  }
  await audit(req, 'settings.update', undefined, v);
  res.json({ ok: true, quota: await getGlobalQuota() });
});

// Admin: reset global quota used counter
settingsRouter.post('/quota/reset', requireAuth, requirePasswordOk, requireRole('admin'), async (req, res) => {
  await resetGlobalQuotaUsed();
  await audit(req, 'settings.quota_reset');
  res.json({ ok: true, quota: await getGlobalQuota() });
});

// Admin: set quota total directly
settingsRouter.post('/quota', requireAuth, requirePasswordOk, requireRole('admin'), async (req, res) => {
  const v = z.object({ total: z.number().int().min(0).max(10_000_000_000) }).parse(req.body);
  await setGlobalQuotaTotal(v.total);
  await audit(req, 'settings.quota_set', undefined, v);
  res.json({ ok: true, quota: await getGlobalQuota() });
});
