import { query } from '../db';

export interface QuotaSnapshot {
  daily_limit: number;
  monthly_limit: number;
  daily_used: number;
  monthly_used: number;
  daily_remaining: number;
  monthly_remaining: number;
}

export async function getQuota(userId: string): Promise<QuotaSnapshot> {
  const { rows: users } = await query<{ daily_limit: number; monthly_limit: number }>(
    `SELECT daily_limit, monthly_limit FROM users WHERE id=$1`, [userId]
  );
  const u = users[0];
  if (!u) throw new Error('user_not_found');

  const { rows: d } = await query<{ s: string }>(
    `SELECT COALESCE(SUM(sent_count),0)::text AS s FROM usage_counters WHERE user_id=$1 AND day=CURRENT_DATE`,
    [userId]
  );
  const { rows: m } = await query<{ s: string }>(
    `SELECT COALESCE(SUM(sent_count),0)::text AS s FROM usage_counters
     WHERE user_id=$1 AND day >= date_trunc('month', CURRENT_DATE)::date`,
    [userId]
  );
  const daily_used = parseInt(d[0].s, 10);
  const monthly_used = parseInt(m[0].s, 10);
  return {
    daily_limit: u.daily_limit,
    monthly_limit: u.monthly_limit,
    daily_used,
    monthly_used,
    daily_remaining: Math.max(0, u.daily_limit - daily_used),
    monthly_remaining: Math.max(0, u.monthly_limit - monthly_used),
  };
}

export async function incrementUsage(userId: string, n = 1) {
  await query(
    `INSERT INTO usage_counters (user_id, day, sent_count)
     VALUES ($1, CURRENT_DATE, $2)
     ON CONFLICT (user_id, day) DO UPDATE SET sent_count = usage_counters.sent_count + EXCLUDED.sent_count`,
    [userId, n]
  );
}
