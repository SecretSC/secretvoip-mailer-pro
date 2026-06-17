import { Router } from 'express';
import { query } from '../db';
import { requireAuth, requirePasswordOk, requireRole } from '../auth/middleware';

export const logsRouter = Router();
logsRouter.use(requireAuth, requirePasswordOk);

// Transmission log (per user; admin can scope via ?user_id=)
logsRouter.get('/transmission', async (req, res) => {
  const status = req.query.status as string | undefined;
  const campaignId = req.query.campaign_id as string | undefined;
  const userScope = req.user!.role === 'admin' && req.query.user_id
    ? (req.query.user_id as string) : req.user!.sub;
  const { rows } = await query(
    `SELECT e.id, e.recipient, e.status, e.error, e.created_at,
            s.name AS smtp_name, c.name AS campaign_name
       FROM email_logs e
       LEFT JOIN smtp_configs s ON s.id = e.smtp_id
       LEFT JOIN campaigns c ON c.id = e.campaign_id
      WHERE e.user_id=$1
        AND ($2::text IS NULL OR e.status=$2)
        AND ($3::uuid IS NULL OR e.campaign_id=$3)
      ORDER BY e.created_at DESC LIMIT 2000`,
    [userScope, status ?? null, campaignId ?? null]
  );
  res.json({ logs: rows });
});

logsRouter.get('/transmission.csv', async (req, res) => {
  const userScope = req.user!.role === 'admin' && req.query.user_id
    ? (req.query.user_id as string) : req.user!.sub;
  const { rows } = await query<any>(
    `SELECT e.created_at, e.recipient, e.status, e.error, s.name AS smtp_name, c.name AS campaign_name
       FROM email_logs e
       LEFT JOIN smtp_configs s ON s.id = e.smtp_id
       LEFT JOIN campaigns c ON c.id = e.campaign_id
      WHERE e.user_id=$1
      ORDER BY e.created_at DESC LIMIT 50000`, [userScope]
  );
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=transmission.csv');
  res.write('timestamp,recipient,status,error,smtp,campaign\n');
  for (const r of rows) {
    const esc = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    res.write([r.created_at.toISOString?.() ?? r.created_at, r.recipient, r.status, r.error ?? '', r.smtp_name ?? '', r.campaign_name ?? ''].map(esc).join(',') + '\n');
  }
  res.end();
});

// Audit log (admin only)
logsRouter.get('/audit', requireRole('admin'), async (_req, res) => {
  const { rows } = await query(
    `SELECT a.id, a.action, a.target, a.ip, a.created_at, a.meta, u.username
       FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
      ORDER BY a.created_at DESC LIMIT 2000`
  );
  res.json({ logs: rows });
});
