import { Router } from 'express';
import { query } from '../db';
import { requireAuth, requirePasswordOk } from '../auth/middleware';
import { getQuota, getUserQuota } from '../lib/quota';

export const dashboardRouter = Router();
dashboardRouter.use(requireAuth, requirePasswordOk);

dashboardRouter.get('/', async (req, res) => {
  const uid = req.user!.sub;
  const quota = await getQuota(uid).catch(() => null); // legacy field, kept for back-compat
  const user_quota = await getUserQuota(uid).catch(() => null);

  const { rows: stats } = await query<{ s: string }>(
    `SELECT COALESCE(SUM(CASE WHEN status='delivered' THEN 1 ELSE 0 END),0)::text AS s
       FROM email_logs WHERE user_id=$1`, [uid]
  );
  const { rows: failed } = await query<{ s: string }>(
    `SELECT COALESCE(SUM(CASE WHEN status IN ('failed','bounced','invalid') THEN 1 ELSE 0 END),0)::text AS s
       FROM email_logs WHERE user_id=$1`, [uid]
  );
  const { rows: active } = await query<{ s: string }>(
    `SELECT COUNT(*)::text AS s FROM campaigns
      WHERE user_id=$1 AND status IN ('queued','processing','paused')`, [uid]
  );
  const { rows: smtps } = await query<{ s: string }>(
    `SELECT COUNT(*)::text AS s FROM smtp_configs WHERE user_id=$1 AND status='active'`, [uid]
  );

  const { rows: daily } = await query(
    `SELECT day::text AS day, sent_count FROM usage_counters
      WHERE user_id=$1 AND day >= CURRENT_DATE - INTERVAL '30 days'
      ORDER BY day`, [uid]
  );

  const totalSent = parseInt(stats[0].s, 10);
  const totalFailed = parseInt(failed[0].s, 10);
  const successRate = totalSent + totalFailed === 0 ? 0
    : Math.round((totalSent / (totalSent + totalFailed)) * 100);

  res.json({
    quota,
    stats: {
      sent: totalSent,
      failed: totalFailed,
      active_campaigns: parseInt(active[0].s, 10),
      smtp_servers: parseInt(smtps[0].s, 10),
      success_rate: successRate,
    },
    daily,
  });
});
