-- SecretVoIP SMTP — Per-user quotas (additive, idempotent).
-- Each client gets an independent sending quota controlled by admin.
-- Existing daily_limit / monthly_limit / global quota columns are preserved.

ALTER TABLE users ADD COLUMN IF NOT EXISTS quota_total BIGINT NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS quota_used  BIGINT NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS quota_updated_at TIMESTAMPTZ;

-- Backfill: leave 0 (= unlimited / disabled until admin sets it).
UPDATE users SET quota_total = COALESCE(quota_total, 0),
                 quota_used  = COALESCE(quota_used, 0);
