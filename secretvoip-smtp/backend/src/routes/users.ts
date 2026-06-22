import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { query } from '../db';
import { requireAuth, requireRole, requirePasswordOk } from '../auth/middleware';
import { audit } from '../lib/audit';
import { env } from '../env';
import { encryptSecret, decryptSecret } from '../crypto';
import {
  getUserQuota, setUserQuotaTotal, addUserQuota, setUserQuotaUsed, resetUserQuotaUsed,
} from '../lib/quota';

export const usersRouter = Router();

usersRouter.use(requireAuth, requirePasswordOk, requireRole('admin'));

usersRouter.get('/', async (req, res) => {
  const search = (req.query.search as string | undefined) ?? '';
  const { rows } = await query(
    `SELECT id, username, role, status, daily_limit, monthly_limit, balance, notes,
            COALESCE(quota_total,0)::bigint AS quota_total,
            COALESCE(quota_used,0)::bigint  AS quota_used,
            quota_updated_at,
            created_at, last_login_at, last_login_ip, last_active_at
       FROM users
      WHERE ($1 = '' OR username ILIKE '%' || $1 || '%')
      ORDER BY created_at DESC LIMIT 500`,
    [search]
  );
  const users = rows.map((u: any) => {
    const total = Number(u.quota_total ?? 0);
    const used = Number(u.quota_used ?? 0);
    return {
      ...u,
      quota_total: total,
      quota_used: used,
      quota_remaining: total > 0 ? Math.max(0, total - used) : 0,
    };
  });
  res.json({ users });
});

const createSchema = z.object({
  username: z.string().min(3).max(64).regex(/^[a-zA-Z0-9_.-]+$/),
  password: z.string().min(8).max(256),
  daily_limit: z.number().int().min(0).optional(),
  monthly_limit: z.number().int().min(0).optional(),
  balance: z.number().int().min(0).optional(),
  notes: z.string().max(2000).optional(),
  initial_quota: z.number().int().min(0).optional(),
});

const createSchema = z.object({
  username: z.string().min(3).max(64).regex(/^[a-zA-Z0-9_.-]+$/),
  password: z.string().min(8).max(256),
  daily_limit: z.number().int().min(0).optional(),
  monthly_limit: z.number().int().min(0).optional(),
  balance: z.number().int().min(0).optional(),
  notes: z.string().max(2000).optional(),
});

usersRouter.post('/', async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input', detail: parsed.error.format() });
  const v = parsed.data;
  const hash = await bcrypt.hash(v.password, 12);
  const pwEnc = encryptSecret(v.password);
  const daily = v.daily_limit ?? env.DEFAULT_DAILY_LIMIT;
  const monthly = v.monthly_limit ?? env.DEFAULT_MONTHLY_LIMIT;
  const balance = v.balance ?? 0;
  try {
    const { rows } = await query<{ id: string }>(
      `INSERT INTO users (username, password_hash, password_enc, role, force_password_change, daily_limit, monthly_limit, balance, notes)
       VALUES ($1,$2,$3,'client', true, $4,$5,$6,$7) RETURNING id`,
      [v.username, hash, pwEnc, daily, monthly, balance, v.notes ?? null]
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
  const pwEnc = encryptSecret(newPassword);
  await query(
    `UPDATE users SET password_hash=$1, password_enc=$2, force_password_change=true, updated_at=now() WHERE id=$3`,
    [hash, pwEnc, req.params.id]
  );
  await audit(req, 'users.reset_password', req.params.id);
  res.json({ ok: true, password: newPassword });
});

// Admin-only: retrieve current visible password (if available)
usersRouter.get('/:id/password', async (req, res) => {
  const { rows } = await query<{ password_enc: string | null; username: string }>(
    `SELECT username, password_enc FROM users WHERE id=$1`, [req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'not_found' });
  if (!rows[0].password_enc) {
    return res.json({ available: false, password: null, message: 'Password set before admin visibility was enabled. Reset to view.' });
  }
  try {
    const plain = decryptSecret(rows[0].password_enc);
    await audit(req, 'users.view_password', req.params.id);
    res.json({ available: true, password: plain });
  } catch {
    res.json({ available: false, password: null, message: 'Stored credential could not be decrypted.' });
  }
});

usersRouter.delete('/:id', async (req, res) => {
  if (req.params.id === req.user!.sub) return res.status(400).json({ error: 'cannot_delete_self' });
  await query(`DELETE FROM users WHERE id=$1 AND role <> 'admin'`, [req.params.id]);
  await audit(req, 'users.delete', req.params.id);
  res.json({ ok: true });
});

// Admin: detailed client inspection
usersRouter.get('/:id/details', async (req, res) => {
  const uid = req.params.id;
  const { rows: u } = await query(
    `SELECT id, username, role, status, created_at, notes,
            last_login_at, last_login_ip, last_active_at,
            (password_enc IS NOT NULL) AS password_visible
       FROM users WHERE id=$1`, [uid]
  );
  if (!u[0]) return res.status(404).json({ error: 'not_found' });

  const { rows: smtpsRaw } = await query<any>(
    `SELECT id, name, host, port, username, password_enc, secure, starttls,
            from_name, from_email, daily_cap, status,
            created_at, updated_at, last_test_at, last_test_status, last_test_error,
            last_success_at, last_failed_at, last_failed_error
       FROM smtp_configs WHERE user_id=$1 ORDER BY created_at DESC`, [uid]
  );
  // Decrypt SMTP passwords for admin inspection
  const smtps = smtpsRaw.map(s => {
    let password: string | null = null;
    try { password = s.password_enc ? decryptSecret(s.password_enc) : null; } catch { password = null; }
    const { password_enc, ...rest } = s;
    return { ...rest, password };
  });

  const { rows: campaigns } = await query(
    `SELECT id, name, status, total, sent, accepted, delivered, failed, created_at,
            started_at, completed_at
       FROM campaigns WHERE user_id=$1 ORDER BY created_at DESC LIMIT 200`, [uid]
  );
  const { rows: templates } = await query(
    `SELECT id, name, subject, created_at, updated_at FROM email_templates WHERE user_id=$1 ORDER BY updated_at DESC`, [uid]
  ).catch(() => ({ rows: [] as any[] }));
  const { rows: logs } = await query(
    `SELECT e.id, e.recipient, e.smtp_id, e.status, e.message_id, e.smtp_response, e.error,
            e.created_at, e.rt_ms,
            s.name AS smtp_name, s.host AS smtp_host, s.port AS smtp_port, s.username AS smtp_username,
            c.name AS campaign_name
       FROM email_logs e
       LEFT JOIN smtp_configs s ON s.id = e.smtp_id
       LEFT JOIN campaigns c ON c.id = e.campaign_id
      WHERE e.user_id=$1 ORDER BY e.created_at DESC LIMIT 200`, [uid]
  );
  const { rows: activity } = await query(
    `SELECT id, action, target, created_at, meta FROM audit_logs WHERE user_id=$1
      ORDER BY created_at DESC LIMIT 200`, [uid]
  );
  const { rows: logins } = await query(
    `SELECT id, ip, user_agent, success, created_at FROM login_history
      WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50`, [uid]
  ).catch(() => ({ rows: [] as any[] }));

  // Derived "last X" timestamps
  const lastOf = (rows: any[], pred: (r: any) => boolean): string | null => {
    const r = rows.find(pred);
    return r ? (r.created_at?.toISOString?.() ?? r.created_at) : null;
  };
  const lastCampaign = campaigns[0]?.created_at ?? null;
  const lastTemplate = templates[0]?.updated_at ?? null;
  const lastSmtpTest = smtps.reduce<string | null>((acc, s) => {
    const t = s.last_test_at; if (!t) return acc;
    if (!acc || new Date(t) > new Date(acc)) return t; return acc;
  }, null);
  const lastSmtpEdit = smtps.reduce<string | null>((acc, s) => {
    const t = s.updated_at; if (!t) return acc;
    if (!acc || new Date(t) > new Date(acc)) return t; return acc;
  }, null);

  res.json({
    user: u[0],
    smtps,
    campaigns: campaigns.map((c: any) => ({ ...c, accepted: c.accepted ?? c.delivered ?? 0 })),
    templates,
    logs,
    activity,
    logins,
    metrics: {
      last_login_at: u[0].last_login_at,
      last_login_ip: u[0].last_login_ip,
      last_active_at: u[0].last_active_at,
      last_campaign_at: lastCampaign,
      last_template_at: lastTemplate,
      last_smtp_test_at: lastSmtpTest,
      last_smtp_edit_at: lastSmtpEdit,
      last_audit_at: lastOf(activity, () => true),
    },
  });
});
