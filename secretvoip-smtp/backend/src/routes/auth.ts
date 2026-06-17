import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { query } from '../db';
import { signToken } from '../auth/jwt';
import { requireAuth } from '../auth/middleware';
import { audit } from '../lib/audit';

export const authRouter = Router();

const loginLimiter = rateLimit({ windowMs: 60_000, max: 10, standardHeaders: true, legacyHeaders: false });

const loginSchema = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(256),
});

authRouter.post('/login', loginLimiter, async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });
  const { username, password } = parsed.data;

  const { rows } = await query<{
    id: string; username: string; password_hash: string; role: 'admin' | 'client';
    status: string; force_password_change: boolean;
  }>(`SELECT id, username, password_hash, role, status, force_password_change
        FROM users WHERE username=$1`, [username]);
  const user = rows[0];
  if (!user) return res.status(401).json({ error: 'invalid_credentials' });
  if (user.status === 'suspended') return res.status(403).json({ error: 'suspended' });
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'invalid_credentials' });

  const token = signToken({
    sub: user.id, username: user.username, role: user.role, fpc: user.force_password_change,
  });
  await audit(Object.assign(req, { user: { sub: user.id, username, role: user.role, fpc: user.force_password_change } }), 'auth.login');
  res.json({
    token,
    user: {
      id: user.id, username: user.username, role: user.role,
      force_password_change: user.force_password_change,
    },
  });
});

authRouter.get('/me', requireAuth, async (req, res) => {
  const { rows } = await query<{
    id: string; username: string; role: string; status: string; force_password_change: boolean;
    daily_limit: number; monthly_limit: number;
  }>(`SELECT id, username, role, status, force_password_change, daily_limit, monthly_limit
        FROM users WHERE id=$1`, [req.user!.sub]);
  const u = rows[0];
  if (!u) return res.status(401).json({ error: 'unauthorized' });
  res.json({ user: u });
});

const changePwSchema = z.object({
  current_password: z.string().min(1),
  new_password: z.string().min(8).max(256),
});

authRouter.post('/change-password', requireAuth, async (req, res) => {
  const parsed = changePwSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });
  const { current_password, new_password } = parsed.data;
  const { rows } = await query<{ password_hash: string }>(
    `SELECT password_hash FROM users WHERE id=$1`, [req.user!.sub]
  );
  const ok = rows[0] && await bcrypt.compare(current_password, rows[0].password_hash);
  if (!ok) return res.status(401).json({ error: 'invalid_credentials' });
  const hash = await bcrypt.hash(new_password, 12);
  await query(
    `UPDATE users SET password_hash=$1, force_password_change=false, updated_at=now() WHERE id=$2`,
    [hash, req.user!.sub]
  );
  await audit(req, 'auth.password_change');
  // Re-issue token so fpc=false
  const token = signToken({ sub: req.user!.sub, username: req.user!.username, role: req.user!.role, fpc: false });
  res.json({ ok: true, token });
});

authRouter.post('/logout', requireAuth, async (req, res) => {
  await audit(req, 'auth.logout');
  res.json({ ok: true });
});
