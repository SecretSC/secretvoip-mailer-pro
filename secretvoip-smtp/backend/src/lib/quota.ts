import { query } from '../db';

// ---------- Per-user (legacy, kept for backward compatibility) ----------
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
    daily_limit: u.daily_limit, monthly_limit: u.monthly_limit,
    daily_used, monthly_used,
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

// ---------- Global shared platform quota ----------
export interface GlobalQuota {
  total: number;
  used: number;
  remaining: number;
  active: boolean;       // true when total > 0 (enforcement enabled)
  exhausted: boolean;    // true when active && remaining <= 0
  reset_at: string | null;
}

export async function getGlobalQuota(): Promise<GlobalQuota> {
  const { rows } = await query<{ total: string; used: string; reset_at: string | null }>(
    `SELECT global_quota_total::text AS total,
            global_quota_used::text  AS used,
            global_quota_reset_at    AS reset_at
       FROM settings WHERE id=1`
  );
  const r = rows[0] ?? { total: '0', used: '0', reset_at: null };
  const total = parseInt(r.total, 10);
  const used = parseInt(r.used, 10);
  const remaining = total > 0 ? Math.max(0, total - used) : 0;
  return {
    total, used, remaining,
    active: total > 0,
    exhausted: total > 0 && used >= total,
    reset_at: r.reset_at ? new Date(r.reset_at).toISOString() : null,
  };
}

/** Atomically reserve N from the global quota. Returns true if reserved, false if exhausted. */
export async function reserveGlobalQuota(n = 1): Promise<boolean> {
  const { rows } = await query<{ ok: boolean }>(
    `UPDATE settings
        SET global_quota_used = global_quota_used + $1, updated_at = now()
      WHERE id = 1
        AND (global_quota_total = 0 OR global_quota_used + $1 <= global_quota_total)
      RETURNING true AS ok`,
    [n]
  );
  return rows.length > 0;
}

export async function setGlobalQuotaTotal(total: number) {
  await query(`UPDATE settings SET global_quota_total=$1, updated_at=now() WHERE id=1`, [total]);
}

export async function resetGlobalQuotaUsed() {
  await query(
    `UPDATE settings SET global_quota_used=0, global_quota_reset_at=now(), updated_at=now() WHERE id=1`
  );
}

// ---------- Per-user quota (primary workflow) ----------
export interface UserQuota {
  total: number;
  used: number;
  remaining: number;
  active: boolean;      // total > 0 => enforced
  exhausted: boolean;   // active && remaining <= 0
  updated_at: string | null;
}

export async function getUserQuota(userId: string): Promise<UserQuota> {
  const { rows } = await query<{ total: string; used: string; updated_at: string | null }>(
    `SELECT COALESCE(quota_total,0)::text AS total,
            COALESCE(quota_used,0)::text  AS used,
            quota_updated_at AS updated_at
       FROM users WHERE id=$1`, [userId]
  );
  const r = rows[0] ?? { total: '0', used: '0', updated_at: null };
  const total = parseInt(r.total, 10);
  const used = parseInt(r.used, 10);
  const remaining = total > 0 ? Math.max(0, total - used) : 0;
  return {
    total, used, remaining,
    active: total > 0,
    exhausted: total > 0 && used >= total,
    updated_at: r.updated_at ? new Date(r.updated_at).toISOString() : null,
  };
}

/** Atomically reserve N from this user's quota. Returns true if reserved. */
export async function reserveUserQuota(userId: string, n = 1): Promise<boolean> {
  const { rows } = await query<{ ok: boolean }>(
    `UPDATE users
        SET quota_used = quota_used + $2, quota_updated_at = now(), updated_at = now()
      WHERE id = $1
        AND (quota_total = 0 OR quota_used + $2 <= quota_total)
      RETURNING true AS ok`,
    [userId, n]
  );
  return rows.length > 0;
}

export async function setUserQuotaTotal(userId: string, total: number) {
  await query(
    `UPDATE users SET quota_total=$2, quota_updated_at=now(), updated_at=now() WHERE id=$1`,
    [userId, Math.max(0, Math.floor(total))]
  );
}
export async function addUserQuota(userId: string, n: number) {
  await query(
    `UPDATE users SET quota_total = COALESCE(quota_total,0) + $2,
                     quota_updated_at=now(), updated_at=now() WHERE id=$1`,
    [userId, Math.max(0, Math.floor(n))]
  );
}
export async function setUserQuotaUsed(userId: string, used: number) {
  await query(
    `UPDATE users SET quota_used=$2, quota_updated_at=now(), updated_at=now() WHERE id=$1`,
    [userId, Math.max(0, Math.floor(used))]
  );
}
export async function resetUserQuotaUsed(userId: string) {
  await query(
    `UPDATE users SET quota_used=0, quota_updated_at=now(), updated_at=now() WHERE id=$1`,
    [userId]
  );
}
