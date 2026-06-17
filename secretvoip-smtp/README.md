# SecretVoIP SMTP Platform

Premium Email Infrastructure — self-hosted SMTP campaign platform for the SecretVoIP brand.

Target deployment URL: `https://secretvoip.com/smtp/`

## Stack
- **Frontend:** React 18 + TypeScript + Vite (SPA) + TailwindCSS, built with `base="/smtp/"`.
- **Backend API:** Node.js 20 + Express + TypeScript + JWT auth, mounted under `/smtp/api/`.
- **Worker:** Node.js BullMQ worker process — sends mail through Nodemailer using each user's saved SMTP credentials.
- **Database:** PostgreSQL 14+.
- **Queue/cache:** Redis 6+.
- **Reverse proxy:** Apache 2.4, integrated as `Alias` + `ProxyPass` blocks inside your **existing** `secretvoip.com` SSL vhost. The included config never replaces or owns the root vhost.

## Layout
```
secretvoip-smtp/
├── frontend/            # Vite SPA
├── backend/             # Express API + BullMQ worker
│   └── migrations/      # SQL schema migrations
├── systemd/             # Systemd unit files for API + worker
├── scripts/             # Helper scripts (migrate, create-admin, backup)
├── apache-example.conf  # Drop-in Apache snippet
├── installation.md
├── deployment.md
├── update-guide.md
└── rollback-guide.md
```

## Quick start (development)
See `installation.md`.

## Production deployment
See `deployment.md`. The default install location is `/var/www/secretvoip-smtp`.

## Default admin
- Username: `admin`
- Password: `ChangeMe123!`

The first successful login forces a password change.

## Safety promise for the existing vhost
The Apache snippet only adds:
- `Alias /smtp /var/www/secretvoip-smtp/frontend/dist`
- `ProxyPass /smtp/api/ http://127.0.0.1:4010/api/`

It does **not** touch `DocumentRoot`, the `/` location, the `/mail/` alias, or the `/sms/` alias.
