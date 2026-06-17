# Installation — SecretVoIP SMTP Platform

Target server: Debian 12, running Apache + MagnusBilling + `secretvoip.com/mail/` + `secretvoip.com/sms/`. **None of these will be touched.**

Install location: `/var/www/secretvoip-smtp`.
Public URL: `https://secretvoip.com/smtp/`.

---

## 1. System prerequisites

```bash
sudo apt update
sudo apt install -y curl ca-certificates gnupg build-essential git

# Node.js 20.x
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# PostgreSQL 14+
sudo apt install -y postgresql postgresql-contrib

# Redis 6+
sudo apt install -y redis-server
sudo systemctl enable --now redis-server

# Apache modules (idempotent)
sudo a2enmod proxy proxy_http rewrite headers expires deflate
sudo systemctl reload apache2
```

## 2. PostgreSQL database

```bash
sudo -u postgres psql <<'SQL'
CREATE USER secretvoip_smtp WITH PASSWORD 'CHANGE_ME_STRONG_PG_PASSWORD';
CREATE DATABASE secretvoip_smtp OWNER secretvoip_smtp;
GRANT ALL PRIVILEGES ON DATABASE secretvoip_smtp TO secretvoip_smtp;
SQL
```

## 3. Pull the source

```bash
sudo mkdir -p /var/www/secretvoip-smtp
sudo chown -R www-data:www-data /var/www/secretvoip-smtp
sudo -u www-data git clone <YOUR_REPO_URL> /var/www/secretvoip-smtp
# or rsync the secretvoip-smtp/ folder you generated.

sudo -u www-data mkdir -p /var/www/secretvoip-smtp/{logs,uploads,exports,backups}
```

## 4. Backend setup

```bash
cd /var/www/secretvoip-smtp/backend
sudo -u www-data cp .env.example .env

# Generate strong secrets
openssl rand -hex 64    # use as JWT_SECRET
openssl rand -hex 32    # use as ENCRYPTION_KEY

sudo -u www-data nano .env   # fill DATABASE_URL, JWT_SECRET, ENCRYPTION_KEY, REDIS_URL

sudo -u www-data npm install
sudo -u www-data npm run build
sudo -u www-data npm run migrate
sudo -u www-data npm run create-admin
# → admin / ChangeMe123! (forced password change on first login)
```

## 5. Frontend build

```bash
cd /var/www/secretvoip-smtp/frontend
sudo -u www-data npm install
sudo -u www-data npm run build
# Output: /var/www/secretvoip-smtp/frontend/dist
```

## 6. Systemd services

```bash
sudo cp /var/www/secretvoip-smtp/systemd/secretvoip-smtp-api.service     /etc/systemd/system/
sudo cp /var/www/secretvoip-smtp/systemd/secretvoip-smtp-worker.service  /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now secretvoip-smtp-api secretvoip-smtp-worker
sudo systemctl status secretvoip-smtp-api secretvoip-smtp-worker
```

Quick health check:
```bash
curl http://127.0.0.1:4010/api/health
# {"ok":true,"ts":...}
```

## 7. Apache — add `/smtp/` to your existing vhost

Open your current SSL vhost (e.g. `/etc/apache2/sites-available/secretvoip.com-le-ssl.conf`).

Inside the existing `<VirtualHost *:443>` block — **do not create a new vhost** — paste the block from `apache-example.conf` (between the `BEGIN`/`END` markers).

```bash
sudo apachectl configtest
sudo systemctl reload apache2
```

Sanity check that nothing else broke:
```bash
curl -I https://secretvoip.com/
curl -I https://secretvoip.com/mail/
curl -I https://secretvoip.com/sms/
curl -I https://secretvoip.com/smtp/
curl -I https://secretvoip.com/smtp/api/health
```

## 8. First login

1. Open `https://secretvoip.com/smtp/`
2. Sign in as `admin` / `ChangeMe123!`
3. The app immediately forces a password change.
4. Create your first client account under **Admin → User Management**.
5. As that client, add an SMTP server, import a CSV list, build a campaign, hit **Start**.

---

## Notes
- The Apache block is **prefix-scoped**. It can only affect URLs starting with `/smtp/`. Existing `/`, `/mail/`, `/sms/` continue to be served exactly as before.
- The backend listens only on `127.0.0.1:4010` — it is **not** publicly reachable. All client traffic goes through Apache.
- All SMTP passwords are encrypted with AES-256-GCM using `ENCRYPTION_KEY`. Losing this key makes existing stored passwords unrecoverable — back it up.
