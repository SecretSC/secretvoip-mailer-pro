# Update Guide — SecretVoIP SMTP Platform

Standard upgrade procedure. Always run as `www-data` from the project root.

```bash
cd /var/www/secretvoip-smtp

# 1. Snapshot first (rollback insurance)
sudo /var/www/secretvoip-smtp/scripts/backup-db.sh
sudo cp backend/.env backups/env-$(date +%F-%H%M).bak

# 2. Pull latest code
sudo -u www-data git pull

# 3. Backend
cd backend
sudo -u www-data npm install --omit=dev=false
sudo -u www-data npm run build
sudo -u www-data npm run migrate          # idempotent; safe to re-run

# 4. Frontend
cd ../frontend
sudo -u www-data npm install
sudo -u www-data npm run build

# 5. Restart services (worker first so it finishes drains, API last)
sudo systemctl restart secretvoip-smtp-worker
sudo systemctl restart secretvoip-smtp-api
sudo systemctl reload  apache2

# 6. Verify
curl -fsS https://secretvoip.com/smtp/api/health
curl -fsSI https://secretvoip.com/        | head -1
curl -fsSI https://secretvoip.com/mail/   | head -1
curl -fsSI https://secretvoip.com/sms/    | head -1
curl -fsSI https://secretvoip.com/smtp/   | head -1
```

## Zero-downtime tips

- Running campaigns are state-driven from Postgres. Restarting the worker mid-campaign is safe: jobs are picked back up on boot, and any in-flight job that didn't acknowledge is retried by BullMQ.
- Restarting the API drops only in-flight HTTP requests (sub-second). Browsers re-issue them automatically.
- Schema migrations in `backend/migrations/` MUST be additive (no destructive `DROP`/`ALTER`) — see the convention header at the top of `001_init.sql`.

## What NOT to do

- Don't edit files in `/etc/apache2/sites-enabled/` other than the SecretVoIP SMTP block.
- Don't change `ENCRYPTION_KEY` after deploy — existing stored SMTP passwords would become unreadable.
- Don't run `npm install` as root; use `www-data` so file ownership stays correct.
