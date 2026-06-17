-- SecretVoIP SMTP Platform — initial schema
-- Idempotent: safe to re-run.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------- users ----------
CREATE TABLE IF NOT EXISTS users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username        TEXT NOT NULL UNIQUE,
  password_hash   TEXT NOT NULL,
  role            TEXT NOT NULL CHECK (role IN ('admin','client')),
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  force_password_change BOOLEAN NOT NULL DEFAULT FALSE,
  daily_limit     INTEGER NOT NULL DEFAULT 5000,
  monthly_limit   INTEGER NOT NULL DEFAULT 100000,
  balance         INTEGER NOT NULL DEFAULT 0,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- sessions (optional revocation list) ----------
CREATE TABLE IF NOT EXISTS sessions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL,
  revoked     BOOLEAN NOT NULL DEFAULT FALSE,
  user_agent  TEXT,
  ip          TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);

-- ---------- smtp_configs ----------
CREATE TABLE IF NOT EXISTS smtp_configs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  host            TEXT NOT NULL,
  port            INTEGER NOT NULL,
  username        TEXT NOT NULL,
  password_enc    TEXT NOT NULL,        -- AES-256-GCM ciphertext (iv:tag:ct in hex)
  secure          BOOLEAN NOT NULL DEFAULT FALSE,  -- SSL on connect
  starttls        BOOLEAN NOT NULL DEFAULT TRUE,
  from_name       TEXT NOT NULL,
  from_email      TEXT NOT NULL,
  daily_cap       INTEGER,              -- optional per-SMTP cap
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  last_test_at    TIMESTAMPTZ,
  last_test_status TEXT,
  last_test_error TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS smtp_user_idx ON smtp_configs(user_id);

-- ---------- contact_lists ----------
CREATE TABLE IF NOT EXISTS contact_lists (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS contact_lists_user_idx ON contact_lists(user_id);

-- ---------- contacts ----------
CREATE TABLE IF NOT EXISTS contacts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  list_id     UUID REFERENCES contact_lists(id) ON DELETE SET NULL,
  email       TEXT NOT NULL,
  first_name  TEXT,
  last_name   TEXT,
  company     TEXT,
  meta        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS contacts_user_idx ON contacts(user_id);
CREATE INDEX IF NOT EXISTS contacts_list_idx ON contacts(list_id);
CREATE UNIQUE INDEX IF NOT EXISTS contacts_user_list_email_uq
  ON contacts(user_id, COALESCE(list_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(email));

-- ---------- campaigns ----------
CREATE TABLE IF NOT EXISTS campaigns (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  subject         TEXT NOT NULL,
  html            TEXT NOT NULL DEFAULT '',
  text            TEXT NOT NULL DEFAULT '',
  list_id         UUID REFERENCES contact_lists(id) ON DELETE SET NULL,
  smtp_ids        UUID[] NOT NULL DEFAULT '{}',  -- rotate across these SMTPs
  status          TEXT NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft','queued','processing','paused','completed','cancelled','failed')),
  total           INTEGER NOT NULL DEFAULT 0,
  sent            INTEGER NOT NULL DEFAULT 0,
  delivered       INTEGER NOT NULL DEFAULT 0,
  failed          INTEGER NOT NULL DEFAULT 0,
  bounced         INTEGER NOT NULL DEFAULT 0,
  invalid         INTEGER NOT NULL DEFAULT 0,
  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS campaigns_user_idx ON campaigns(user_id);
CREATE INDEX IF NOT EXISTS campaigns_status_idx ON campaigns(status);

-- ---------- campaign_recipients ----------
CREATE TABLE IF NOT EXISTS campaign_recipients (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id   UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  email         TEXT NOT NULL,
  first_name    TEXT,
  last_name     TEXT,
  company       TEXT,
  status        TEXT NOT NULL DEFAULT 'queued'
                CHECK (status IN ('queued','processing','delivered','failed','bounced','invalid','delayed','cancelled')),
  smtp_id       UUID REFERENCES smtp_configs(id) ON DELETE SET NULL,
  error         TEXT,
  attempts      INTEGER NOT NULL DEFAULT 0,
  sent_at       TIMESTAMPTZ,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS recipients_campaign_idx ON campaign_recipients(campaign_id);
CREATE INDEX IF NOT EXISTS recipients_status_idx ON campaign_recipients(status);

-- ---------- email_logs ----------
CREATE TABLE IF NOT EXISTS email_logs (
  id            BIGSERIAL PRIMARY KEY,
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  campaign_id   UUID REFERENCES campaigns(id) ON DELETE SET NULL,
  recipient     TEXT NOT NULL,
  smtp_id       UUID REFERENCES smtp_configs(id) ON DELETE SET NULL,
  status        TEXT NOT NULL,
  error         TEXT,
  message_id    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS email_logs_user_idx ON email_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS email_logs_campaign_idx ON email_logs(campaign_id);

-- ---------- audit_logs ----------
CREATE TABLE IF NOT EXISTS audit_logs (
  id          BIGSERIAL PRIMARY KEY,
  user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  action      TEXT NOT NULL,
  target      TEXT,
  ip          TEXT,
  user_agent  TEXT,
  meta        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_user_idx ON audit_logs(user_id, created_at DESC);

-- ---------- settings (singleton row id=1) ----------
CREATE TABLE IF NOT EXISTS settings (
  id              INTEGER PRIMARY KEY CHECK (id = 1),
  site_name       TEXT NOT NULL DEFAULT 'SecretVoIP SMTP',
  tagline         TEXT NOT NULL DEFAULT 'Premium Email Infrastructure',
  support_telegram TEXT NOT NULL DEFAULT '',
  maintenance_mode BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- ---------- daily usage counters ----------
CREATE TABLE IF NOT EXISTS usage_counters (
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day         DATE NOT NULL,
  sent_count  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);
CREATE INDEX IF NOT EXISTS usage_day_idx ON usage_counters(day);
