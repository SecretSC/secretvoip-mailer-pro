# Rollback Guide — SecretVoIP SMTP Platform

If a deploy goes wrong, roll back to the previous known-good state.

## Fast rollback (code only — no DB schema change in the bad deploy)

```bash
cd /var/www/secretvoip-smtp
sudo -u www-data git log --oneline -n 10     # find the previous good SHA
sudo -u www-data git checkout <PREV_SHA>

cd backend && sudo -u www-data npm install && sudo -u www-data npm run build
cd ../frontend && sudo -u www-data npm install && sudo -u www-data npm run build

sudo systemctl restart secretvoip-smtp-worker secretvoip-smtp-api
sudo systemctl reload apache2
```

## Full rollback (schema change is broken too)

```bash
# 1. Stop services so nothing writes during restore
sudo systemctl stop secretvoip-smtp-worker secretvoip-smtp-api

# 2. Restore the most recent DB snapshot
LATEST=$(ls -1t /var/www/secretvoip-smtp/backups/db-*.sql.gz | head -1)
gunzip -c "$LATEST" | sudo -u postgres psql secretvoip_smtp

# 3. Restore .env if needed
sudo cp /var/www/secretvoip-smtp/backups/env-<timestamp>.bak \
        /var/www/secretvoip-smtp/backend/.env

# 4. Check out the previous code SHA and rebuild (see Fast rollback above)

# 5. Start services
sudo systemctl start secretvoip-smtp-api secretvoip-smtp-worker
sudo systemctl status secretvoip-smtp-api secretvoip-smtp-worker
```

## Apache rollback

If the Apache snippet broke other services:

```bash
sudo apachectl configtest          # shows the exact line that's broken
# Open your vhost, remove or comment the SecretVoIP SMTP block
sudo systemctl reload apache2
```

`secretvoip.com`, `/mail/`, `/sms/` will be back online immediately — they were never modified.

## Disaster recovery checklist

- ☐ Postgres dumps in `/var/www/secretvoip-smtp/backups/` are current.
- ☐ `backend/.env` is backed up off-host (contains `ENCRYPTION_KEY`).
- ☐ You know the previous git SHA that was running.
- ☐ Your Apache vhost is under version control or has a `.bak` copy.
