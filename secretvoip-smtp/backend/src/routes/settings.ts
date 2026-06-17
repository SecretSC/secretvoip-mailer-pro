import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db';
import { requireAuth, requirePasswordOk, requireRole } from '../auth/middleware';
import { audit } from '../lib/audit';

export const settingsRouter = Router();

// Public-ish (still requires auth): everyone reads
settingsRouter.get('/', requireAuth, requirePasswordOk, async (_req, res) => {
  const { rows } = await query(`SELECT site_name, tagline, support_telegram, maintenance_mode FROM settings WHERE id=1`);
  res.json({ settings: rows[0] });
});

const schema = z.object({
  site_name: z.string().min(1).max(120).optional(),
  tagline: z.string().min(1).max(200).optional(),
  support_telegram: z.string().max(120).optional(),
  maintenance_mode: z.boolean().optional(),
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
  await audit(req, 'settings.update', null, v);
  res.json({ ok: true });
});
