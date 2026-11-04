#!/usr/bin/env bash
# Nightly backup: one pg_dump per tenant schema + the platform schema, plus uploads.
# Usage: scripts/backup.sh [/var/backups/coop]      (reads DATABASE_URL from .env)
# Cron:  15 2 * * *  cd /opt/websitenextgen && scripts/backup.sh /var/backups/coop >> /var/log/coop-backup.log 2>&1
set -euo pipefail
cd "${APP_DIR:-$(dirname "$0")/..}"
DEST="${1:-./backups}"
KEEP_DAYS="${KEEP_DAYS:-14}"
if [ -z "${DATABASE_URL:-}" ] && [ -f .env ]; then DATABASE_URL="$(grep -E '^DATABASE_URL=' .env | head -1 | cut -d= -f2-)"; fi
: "${DATABASE_URL:?DATABASE_URL is not set}"
STAMP="$(date +%Y%m%d-%H%M)"
OUT="$DEST/$STAMP"
mkdir -p "$OUT"
umask 077

pg_dump "$DATABASE_URL" --schema=platform --format=custom --file="$OUT/platform.dump"
for s in $(psql "$DATABASE_URL" -tAc "SELECT schema_name FROM platform.tenants ORDER BY slug"); do
  pg_dump "$DATABASE_URL" --schema="$s" --format=custom --file="$OUT/$s.dump"
  echo "✓ $s"
done
if [ -d uploads ]; then tar -czf "$OUT/uploads.tar.gz" uploads; fi
sha256sum "$OUT"/* > "$OUT/SHA256SUMS"
find "$DEST" -mindepth 1 -maxdepth 1 -type d -mtime +"$KEEP_DAYS" -exec rm -rf {} +
echo "backup written to $OUT"
# Restore one tenant:  pg_restore --clean --if-exists -d "$DATABASE_URL" "$OUT/tenant_aakash.dump"
