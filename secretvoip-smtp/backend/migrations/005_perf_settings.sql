-- SecretVoIP SMTP — Sending performance settings (additive, idempotent).
-- Admin-controlled throughput knobs read live by API + worker.

ALTER TABLE settings ADD COLUMN IF NOT EXISTS worker_concurrency       INT NOT NULL DEFAULT 50;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS emails_per_second        INT NOT NULL DEFAULT 100;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS max_smtp_connections     INT NOT NULL DEFAULT 50;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS queue_batch_size         INT NOT NULL DEFAULT 500;

UPDATE settings
   SET worker_concurrency   = COALESCE(NULLIF(worker_concurrency, 0), 50),
       emails_per_second    = COALESCE(NULLIF(emails_per_second, 0), 100),
       max_smtp_connections = COALESCE(NULLIF(max_smtp_connections, 0), 50),
       queue_batch_size     = COALESCE(NULLIF(queue_batch_size, 0), 500)
 WHERE id = 1;
