import { Router } from 'express';
import { query } from '../db';
import { requireAuth, requirePasswordOk, requireRole } from '../auth/middleware';

export const logsRouter = Router();
logsRouter.use(requireAuth, requirePasswordOk);

function scope(req: any): string {
  return req.user!.role === 'admin' && req.query.user_id
    ? (req.query.user_id as string) : req.user!.sub;
}

// Transmission log (per user; admin can scope via ?user_id=)
logsRouter.get('/transmission', async (req, res) => {
  const status = req.query.status as string | undefined;
  const campaignId = req.query.campaign_id as string | undefined;
  const smtpId = req.query.smtp_id as string | undefined;
  const search = ((req.query.search as string) || '').trim().toLowerCase();
  const since = req.query.since as string | undefined; // ISO date
  const until = req.query.until as string | undefined;
  const limit = Math.min(parseInt((req.query.limit as string) || '500', 10) || 500, 5000);
  const userScope = scope(req);

  const { rows } = await query(
    `SELECT e.id, e.recipient, e.status, e.error, e.created_at,
            e.message_id, e.smtp_response, e.rt_ms,
            e.smtp_id, e.campaign_id,
            s.name AS smtp_name, c.name AS campaign_name,
            (SELECT attempts FROM campaign_recipients cr
              WHERE cr.campaign_id=e.campaign_id AND cr.email=e.recipient LIMIT 1) AS attempts
       FROM email_logs e
       LEFT JOIN smtp_configs s ON s.id = e.smtp_id
       LEFT JOIN campaigns c ON c.id = e.campaign_id
      WHERE e.user_id=$1
        AND ($2::text IS NULL OR e.status=$2)
        AND ($3::uuid IS NULL OR e.campaign_id=$3)
        AND ($4::uuid IS NULL OR e.smtp_id=$4)
        AND ($5::text = '' OR lower(e.recipient) LIKE '%' || $5 || '%')
        AND ($6::timestamptz IS NULL OR e.created_at >= $6)
        AND ($7::timestamptz IS NULL OR e.created_at <= $7)
      ORDER BY e.created_at DESC LIMIT ${limit}`,
    [userScope, status ?? null, campaignId ?? null, smtpId ?? null, search,
     since ?? null, until ?? null]
  );
  res.json({ logs: rows });
});

// Aggregate counters for the summary cards
logsRouter.get('/transmission/summary', async (req, res) => {
  const userScope = scope(req);
  const campaignId = req.query.campaign_id as string | undefined;
  const { rows } = await query<{ status: string; n: string }>(
    `SELECT status, COUNT(*)::text AS n
       FROM email_logs
      WHERE user_id=$1
        AND ($2::uuid IS NULL OR campaign_id=$2)
      GROUP BY status`,
    [userScope, campaignId ?? null]
  );
  const out: Record<string, number> = {
    total: 0, accepted: 0, delivered: 0, failed: 0,
    bounced: 0, invalid: 0, queued: 0, processing: 0, rejected: 0,
  };
  for (const r of rows) {
    const n = parseInt(r.n, 10);
    out[r.status] = (out[r.status] || 0) + n;
    out.total += n;
  }
  // accepted == delivered (SMTP only confirms acceptance)
  out.accepted = out.delivered;

  // Live in-flight counters from campaign_recipients (queued/processing not in email_logs yet)
  const { rows: live } = await query<{ status: string; n: string }>(
    `SELECT cr.status, COUNT(*)::text AS n
       FROM campaign_recipients cr
       JOIN campaigns c ON c.id = cr.campaign_id
      WHERE c.user_id=$1
        AND ($2::uuid IS NULL OR cr.campaign_id=$2)
        AND cr.status IN ('queued','processing','delayed')
      GROUP BY cr.status`,
    [userScope, campaignId ?? null]
  );
  for (const r of live) out[r.status] = parseInt(r.n, 10);

  res.json({ summary: out });
});

logsRouter.get('/transmission.csv', async (req, res) => {
  const userScope = scope(req);
  const { rows } = await query<any>(
    `SELECT e.created_at, e.recipient, e.status, e.error, e.message_id, e.smtp_response, e.rt_ms,
            s.name AS smtp_name, c.name AS campaign_name
       FROM email_logs e
       LEFT JOIN smtp_configs s ON s.id = e.smtp_id
       LEFT JOIN campaigns c ON c.id = e.campaign_id
      WHERE e.user_id=$1
      ORDER BY e.created_at DESC LIMIT 100000`, [userScope]
  );
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=transmission.csv');
  res.write('timestamp,recipient,status,smtp,campaign,message_id,smtp_response,error,rt_ms\n');
  for (const r of rows) {
    const esc = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    res.write([
      r.created_at?.toISOString?.() ?? r.created_at,
      r.recipient, r.status, r.smtp_name ?? '', r.campaign_name ?? '',
      r.message_id ?? '', r.smtp_response ?? '', r.error ?? '', r.rt_ms ?? '',
    ].map(esc).join(',') + '\n');
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
