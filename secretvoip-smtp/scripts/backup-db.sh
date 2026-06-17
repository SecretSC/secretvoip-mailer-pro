#!/usr/bin/env bash
set -euo pipefail
ROOT=/var/www/secretvoip-smtp
DEST="$ROOT/backups"
mkdir -p "$DEST"
ENV_FILE="$ROOT/backend/.env"
if [[ ! -f "$ENV_FILE" ]]; then echo "missing .env"; exit 1; fi

DB_URL=$(grep -E '^DATABASE_URL=' "$ENV_FILE" | cut -d= -f2-)
TS=$(date +%F-%H%M)
pg_dump "$DB_URL" | gzip > "$DEST/db-$TS.sql.gz"
echo "✓ wrote $DEST/db-$TS.sql.gz"

# keep last 30 daily snapshots
ls -1t "$DEST"/db-*.sql.gz | tail -n +31 | xargs -r rm -f
