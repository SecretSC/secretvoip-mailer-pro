-- SecretVoIP SMTP Platform — additive update (safe, idempotent)
-- Adds: email_templates, inline-recipient + from_name campaign fields,
-- extended log fields, accepted counter.
-- Does NOT drop, rename, or change any existing column or constraint.

-- ---------- email_templates ----------
CREATE TABLE IF NOT EXISTS email_templates (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  subject    TEXT NOT NULL DEFAULT '',
  html       TEXT NOT NULL DEFAULT '',
  text       TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS email_templates_user_idx ON email_templates(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS email_templates_user_name_uq
  ON email_templates(user_id, lower(name));

-- ---------- campaigns: from_name + accepted counter ----------
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS from_name TEXT;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS accepted INTEGER NOT NULL DEFAULT 0;

-- Backfill accepted from delivered (one-time, but safe to re-run)
UPDATE campaigns SET accepted = delivered WHERE accepted = 0 AND delivered > 0;

-- ---------- campaign_recipients: smtp_response + message_id ----------
ALTER TABLE campaign_recipients ADD COLUMN IF NOT EXISTS smtp_response TEXT;
ALTER TABLE campaign_recipients ADD COLUMN IF NOT EXISTS message_id    TEXT;

-- ---------- email_logs: extra diagnostic fields ----------
ALTER TABLE email_logs ADD COLUMN IF NOT EXISTS smtp_response TEXT;
ALTER TABLE email_logs ADD COLUMN IF NOT EXISTS rt_ms         INTEGER;

-- Helpful indexes for transmission-log filtering
CREATE INDEX IF NOT EXISTS email_logs_recipient_idx ON email_logs(lower(recipient));
CREATE INDEX IF NOT EXISTS email_logs_status_idx    ON email_logs(status);
CREATE INDEX IF NOT EXISTS email_logs_smtp_idx      ON email_logs(smtp_id);
