import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db';
import { requireAuth, requirePasswordOk } from '../auth/middleware';
import { encryptSecret } from '../crypto';
import { verifyTransport, invalidateTransport } from '../lib/mailer';
import { audit } from '../lib/audit';

export const smtpRouter = Router();
smtpRouter.use(requireAuth, requirePasswordOk);

smtpRouter.get('/', async (req, res) => {
  const { rows } = await query(
    `SELECT id, name, host, port, username, secure, starttls, from_name, from_email,
            status, last_test_at, last_test_status, last_test_error, created_at
       FROM smtp_configs WHERE user_id=$1 ORDER BY created_at DESC`,
    [req.user!.sub]
  );
  res.json({ smtps: rows });
});

const upsertSchema = z.object({
  name: z.string().min(1).max(120),
  host: z.string().min(1).max(255),
  port: z.number().int().min(1).max(65535),
  username: z.string().min(1).max(255),
  password: z.string().min(1).max(512).optional(),
  secure: z.boolean().default(false),
  starttls: z.boolean().default(true),
  from_name: z.string().min(1).max(120),
  from_email: z.string().email().max(255),
  status: z.enum(['active', 'disabled']).optional(),
});

smtpRouter.post('/', async (req, res) => {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input', detail: parsed.error.format() });
  const v = parsed.data;
  if (!v.password) return res.status(400).json({ error: 'password_required' });
  const enc = encryptSecret(v.password);
  const { rows } = await query<{ id: string }>(
    `INSERT INTO smtp_configs (user_id, name, host, port, username, password_enc, secure, starttls, from_name, from_email)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
    [req.user!.sub, v.name, v.host, v.port, v.username, enc, v.secure, v.starttls, v.from_name, v.from_email]
  );
  await audit(req, 'smtp.create', rows[0].id, { name: v.name, host: v.host });
  res.status(201).json({ id: rows[0].id });
});

smtpRouter.patch('/:id', async (req, res) => {
  const parsed = upsertSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });
  const v = parsed.data;
  const fields: string[] = []; const vals: any[] = [];
  for (const [k, val] of Object.entries(v)) {
    if (val === undefined) continue;
    if (k === 'password') {
      vals.push(encryptSecret(val as string)); fields.push(`password_enc=$${vals.length}`);
    } else {
      vals.push(val); fields.push(`${k}=$${vals.length}`);
    }
  }
  if (!fields.length) return res.json({ ok: true });
  vals.push(req.params.id, req.user!.sub);
  await query(
    `UPDATE smtp_configs SET ${fields.join(',')}, updated_at=now() WHERE id=$${vals.length - 1} AND user_id=$${vals.length}`,
    vals
  );
  invalidateTransport(req.params.id);
  await audit(req, 'smtp.update', req.params.id);
  res.json({ ok: true });
});

smtpRouter.delete('/:id', async (req, res) => {
  await query(`DELETE FROM smtp_configs WHERE id=$1 AND user_id=$2`, [req.params.id, req.user!.sub]);
  invalidateTransport(req.params.id);
  await audit(req, 'smtp.delete', req.params.id);
  res.json({ ok: true });
});

smtpRouter.post('/:id/test', async (req, res) => {
  const { rows } = await query<any>(
    `SELECT id, host, port, username, password_enc, secure, starttls, from_name, from_email
       FROM smtp_configs WHERE id=$1 AND user_id=$2`,
    [req.params.id, req.user!.sub]
  );
  const smtp = rows[0];
  if (!smtp) return res.status(404).json({ error: 'not_found' });
  const result = await verifyTransport(smtp);
  await query(
    `UPDATE smtp_configs SET last_test_at=now(), last_test_status=$1, last_test_error=$2 WHERE id=$3`,
    [result.ok ? 'ok' : 'failed', result.ok ? null : result.error ?? null, req.params.id]
  );
  await audit(req, 'smtp.test', req.params.id, { ok: result.ok });
  res.json(result);
});
