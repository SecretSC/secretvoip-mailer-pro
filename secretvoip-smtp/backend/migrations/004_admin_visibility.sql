-- SecretVoIP SMTP Platform — additive update (safe, idempotent)
-- Adds admin-visible password storage, login history, last-activity timestamps,
-- SMTP send-result timestamps. Does NOT drop or rename any existing column.

-- ---------- users: admin-visible password + login tracking ----------
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_enc    TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at   TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_ip   TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_active_at  TIMESTAMPTZ;

-- ---------- login_history ----------
CREATE TABLE IF NOT EXISTS login_history (
  id          BIGSERIAL PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ip          TEXT,
  user_agent  TEXT,
  success     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS login_history_user_idx ON login_history(user_id, created_at DESC);

-- ---------- smtp_configs: outcome timestamps ----------
ALTER TABLE smtp_configs ADD COLUMN IF NOT EXISTS last_success_at  TIMESTAMPTZ;
ALTER TABLE smtp_configs ADD COLUMN IF NOT EXISTS last_failed_at   TIMESTAMPTZ;
ALTER TABLE smtp_configs ADD COLUMN IF NOT EXISTS last_failed_error TEXT;
