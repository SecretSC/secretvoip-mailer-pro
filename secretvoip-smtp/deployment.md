# Deployment — SecretVoIP SMTP Platform

Production layout:

```
/var/www/secretvoip-smtp
├── frontend/dist/         ← built SPA, served by Apache at /smtp/
├── backend/
│   ├── dist/              ← compiled API + worker
│   ├── migrations/
│   └── .env               ← secrets (mode 0600, owned by www-data)
├── logs/                  ← api.log, worker.log
├── uploads/               ← CSV scratch (ephemeral)
├── exports/               ← CSV exports
├── backups/               ← pg_dump archives
└── systemd/               ← unit files (copied to /etc/systemd/system/)
```

## Process model

| Unit                            | Command                | Role                                  |
|---------------------------------|------------------------|---------------------------------------|
| `secretvoip-smtp-api.service`   | `node dist/index.js`   | HTTP API on 127.0.0.1:4010            |
| `secretvoip-smtp-worker.service`| `node dist/worker.js`  | BullMQ consumer — sends mail via Nodemailer |

Both run as `www-data`. The worker can be scaled by running multiple instances (different `Description=` / `ExecStart=` with `WORKER_RATE_PER_SECOND` tuned per process).

## Apache placement

`apache-example.conf` provides a block that goes **inside the existing** `secretvoip.com:443` vhost. It is prefix-scoped to `/smtp/` and never touches `/`, `/mail/`, or `/sms/`. After editing:

```bash
sudo apachectl configtest && sudo systemctl reload apache2
```

## Environment variables (`backend/.env`)

| Var                      | Purpose |
|--------------------------|---------|
| `PORT`                   | API port (default 4010, bind 127.0.0.1) |
| `JWT_SECRET`             | HS256 secret for tokens (≥ 64 hex chars) |
| `ENCRYPTION_KEY`         | 32-byte hex; AES-256-GCM key for SMTP passwords |
| `DATABASE_URL`           | `postgres://user:pass@host:port/db` |
| `REDIS_URL`              | `redis://127.0.0.1:6379/3` |
| `WORKER_CONCURRENCY`     | Parallel jobs per worker (default 10) |
| `WORKER_RATE_PER_SECOND` | Max emails/sec per worker process |
| `DEFAULT_DAILY_LIMIT`    | New-client daily quota |
| `DEFAULT_MONTHLY_LIMIT`  | New-client monthly quota |

## TLS / proxy headers

The API runs behind Apache. `TRUST_PROXY=1` is set so `req.ip` reflects the real client. Apache sets `X-Forwarded-Proto: https` so logs and rate limits work correctly.

## Logs

- `logs/api.log`, `logs/api.err.log`
- `logs/worker.log`, `logs/worker.err.log`

Rotate with a stock logrotate snippet:

```
/var/www/secretvoip-smtp/logs/*.log {
    weekly
    rotate 8
    compress
    missingok
    notifempty
    create 0640 www-data www-data
    postrotate
        systemctl reload secretvoip-smtp-api  >/dev/null 2>&1 || true
        systemctl reload secretvoip-smtp-worker >/dev/null 2>&1 || true
    endscript
}
```

## Backups

Daily Postgres dump:

```bash
sudo -u www-data bash -c '
  PGPASSWORD="$(grep DATABASE_URL /var/www/secretvoip-smtp/backend/.env | sed -E "s|.*://[^:]+:([^@]+)@.*|\1|")" \
    pg_dump -h 127.0.0.1 -U secretvoip_smtp secretvoip_smtp \
    | gzip > /var/www/secretvoip-smtp/backups/db-$(date +%F).sql.gz
'
```

Add a cron line for `www-data`:
```
30 3 * * * /var/www/secretvoip-smtp/scripts/backup-db.sh
```

Also back up `backend/.env` (it contains `ENCRYPTION_KEY` — without it stored SMTP passwords cannot be decrypted).

## Health checks

- `GET /smtp/api/health` → `{ "ok": true }` — used by uptime monitors.
- `systemctl status secretvoip-smtp-api secretvoip-smtp-worker`
- `journalctl -u secretvoip-smtp-api -f`

## Coexistence guarantees

The application:
- binds only to `127.0.0.1:4010`
- adds **one** `Alias` and **one** `<Location /smtp/api/>` to your vhost
- does not touch `/etc/apache2/sites-enabled/*` outside that snippet
- writes only inside `/var/www/secretvoip-smtp`

`https://secretvoip.com/`, `/mail/`, `/sms/` and MagnusBilling continue to be served by the same vhost without changes.
