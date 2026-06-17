import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { query } from '../db';
import { requireAuth, requireRole, requirePasswordOk } from '../auth/middleware';
import { audit } from '../lib/audit';
import { env } from '../env';

export const usersRouter = Router();

usersRouter.use(requireAuth, requirePasswordOk, requireRole('admin'));

usersRouter.get('/', async (req, res) => {
  const search = (req.query.search as string | undefined) ?? '';
  const { rows } = await query(
    `SELECT id, username, role, status, daily_limit, monthly_limit, balance, notes, created_at
       FROM users
      WHERE ($1 = '' OR username ILIKE '%' || $1 || '%')
      ORDER BY created_at DESC LIMIT 500`,
    [search]
  );
  res.json({ users: rows });
});

const createSchema = z.object({
  username: z.string().min(3).max(64).regex(/^[a-zA-Z0-9_.-]+$/),
  password: z.string().min(8).max(256),
  daily_limit: z.number().int().min(0).default(env.DEFAULT_DAILY_LIMIT),
  monthly_limit: z.number().int().min(0).default(env.DEFAULT_MONTHLY_LIMIT),
  balance: z.number().int().min(0).default(0),
  notes: z.string().max(2000).optional(),
});

usersRouter.post('/', async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input', detail: parsed.error.format() });
  const v = parsed.data;
  const hash = await bcrypt.hash(v.password, 12);
  try {
    const { rows } = await query<{ id: string }>(
      `INSERT INTO users (username, password_hash, role, force_password_change, daily_limit, monthly_limit, balance, notes)
       VALUES ($1,$2,'client', true, $3,$4,$5,$6) RETURNING id`,
      [v.username, hash, v.daily_limit, v.monthly_limit, v.balance, v.notes ?? null]
    );
    await audit(req, 'users.create', rows[0].id, { username: v.username });
    res.status(201).json({ id: rows[0].id, username: v.username, password: v.password });
  } catch (e: any) {
    if (e?.code === '23505') return res.status(409).json({ error: 'username_taken' });
    throw e;
  }
});

const updateSchema = z.object({
  daily_limit: z.number().int().min(0).optional(),
  monthly_limit: z.number().int().min(0).optional(),
  balance: z.number().int().min(0).optional(),
  notes: z.string().max(2000).optional(),
  status: z.enum(['active', 'suspended']).optional(),
});

usersRouter.patch('/:id', async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });
  const v = parsed.data;
  const fields: string[] = []; const vals: any[] = [];
  for (const [k, val] of Object.entries(v)) {
    if (val === undefined) continue;
    vals.push(val); fields.push(`${k}=$${vals.length}`);
  }
  if (!fields.length) return res.json({ ok: true });
  vals.push(req.params.id);
  await query(`UPDATE users SET ${fields.join(',')}, updated_at=now() WHERE id=$${vals.length}`, vals);
  await audit(req, 'users.update', req.params.id, v);
  res.json({ ok: true });
});

usersRouter.post('/:id/reset-password', async (req, res) => {
  const newPassword = (req.body?.password as string | undefined) ?? Math.random().toString(36).slice(2, 12) + 'A!1';
  const hash = await bcrypt.hash(newPassword, 12);
  await query(
    `UPDATE users SET password_hash=$1, force_password_change=true, updated_at=now() WHERE id=$2`,
    [hash, req.params.id]
  );
  await audit(req, 'users.reset_password', req.params.id);
  res.json({ ok: true, password: newPassword });
});

usersRouter.delete('/:id', async (req, res) => {
  if (req.params.id === req.user!.sub) return res.status(400).json({ error: 'cannot_delete_self' });
  await query(`DELETE FROM users WHERE id=$1 AND role <> 'admin'`, [req.params.id]);
  await audit(req, 'users.delete', req.params.id);
  res.json({ ok: true });
});
