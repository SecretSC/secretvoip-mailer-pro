# SecretVoIP SMTP Platform — Update Plan

All changes are **additive**. No existing tables, columns, routes, service names, ports, paths or auth flows are removed or renamed. Production data is preserved.

## 1. Database — `migrations/002_update.sql` (additive)

- New table `email_templates(id, user_id, name, subject, html, text, created_at, updated_at)`.
- Add nullable columns to `campaigns`: `from_name TEXT`, `accepted INTEGER NOT NULL DEFAULT 0`.
- Add nullable columns to `campaign_recipients`: `smtp_response TEXT`, `message_id TEXT`.
- Add nullable columns to `email_logs`: `smtp_response TEXT`, `rt_ms INTEGER`.
- Backfill `campaigns.accepted = delivered` (idempotent).
- Existing `delivered`/`status='delivered'` values are preserved; new code treats them as "Accepted" in UI.

## 2. Backend

- **users.ts** — `daily_limit` and `monthly_limit` become optional; defaults raised to 1,000,000 / 30,000,000 (env `DEFAULT_DAILY_LIMIT` / `DEFAULT_MONTHLY_LIMIT` updated in `.env.example` and `env.ts`).
- **campaigns.ts** —
  - Accept `from_name` and inline `recipients: string[]` on create/update.
  - New `POST /campaigns/:id/recipients` (bulk insert, validates + dedupes, returns counts).
  - `start` no longer requires `list_id`; works if `campaign_recipients` already populated. Quota check uses recipient count, but never blocks above limit — only warns (still enforced per-send in worker via quota for protection, kept).
  - Map response `delivered` → expose both `delivered` and `accepted` for UI compatibility.
- **worker.ts** — uses `campaigns.from_name` if set, else SMTP from_name. Writes `smtp_response`, `message_id`, increments new `accepted` column alongside existing `delivered`.
- **logs.ts** — returns extra fields (`smtp_response`, `message_id`, `rt_ms`, `attempts`). New `GET /logs/transmission/summary` returns status counts.
- **smtp.ts** — `/test` returns `{ ok, error, rt_ms, secure, starttls, response }`.
- **New routes/templates.ts** — full CRUD for `email_templates`; mounted at `/api/templates`.
- **index.ts** — register templates router.

## 3. Frontend

- **AdminUsers.tsx** — create form requires only username + password; collapsible "Advanced" reveals daily/monthly. Defaults 1,000,000 / 30,000,000.
- **CampaignEditor.tsx** — new workflow: Campaign Name, From Name, Subject, Recipients (paste / CSV / TXT upload with live valid/invalid/duplicate counters + recommendation banner), HTML, Plain text, SMTP selection. No contact-list dependency. Template save/load/rename/delete controls.
- **CampaignDetails.tsx** — large progress bar, percentage, live counters (Total/Accepted/Failed/Queued/Processing/Rejected), Start/Pause/Resume/Stop. Auto-refresh 2s.
- **TransmissionLog.tsx** — summary cards (Total/Accepted/Failed/Queued/Processing/Rejected), filters (status, campaign, date, SMTP, recipient search), columns (Time, Recipient, Campaign, SMTP, Status, SMTP Response, Error, Message ID, Retry). Auto-refresh 5s. "Delivered" labeled "Accepted".
- **New Templates.tsx** + nav link.
- **Smtp.tsx** — test shows connection / auth / TLS / response / RTT cleanly (not just alert).

## 4. Out of scope (kept intact)
- Apache config, systemd units, ports, deployment path, encryption keys, JWT auth, contacts table, existing routes.

## 5. Deployment
Only these commands at the end:
```
cd /var/www/secretvoip-smtp/secretvoip-smtp/frontend && npm install && npm run build
cd ../backend && npm install && npm run build
sudo systemctl restart secretvoip-smtp-api
sudo systemctl restart secretvoip-smtp-worker
sudo systemctl reload apache2
```
Then run `npm run migrate` in `backend/` to apply `002_update.sql` (idempotent).
