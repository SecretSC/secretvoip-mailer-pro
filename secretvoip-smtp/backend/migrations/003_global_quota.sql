-- SecretVoIP SMTP — Global shared quota (additive, idempotent).
-- Adds a platform-wide email sending quota stored on the singleton settings row.

ALTER TABLE settings ADD COLUMN IF NOT EXISTS global_quota_total BIGINT NOT NULL DEFAULT 0;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS global_quota_used  BIGINT NOT NULL DEFAULT 0;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS global_quota_reset_at TIMESTAMPTZ;

-- Backfill: leave 0 (unlimited) so existing deployments keep working until admin sets a quota.
UPDATE settings SET global_quota_total = COALESCE(global_quota_total, 0),
                    global_quota_used  = COALESCE(global_quota_used, 0)
 WHERE id = 1;
