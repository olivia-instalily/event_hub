#!/bin/bash
# Run all DB migrations against Cloud SQL.
# Uses the Cloud SQL Auth Proxy (must be installed: https://cloud.google.com/sql/docs/postgres/connect-auth-proxy).
# Run from the repo root: bash scripts/run-migrations.sh
set -euo pipefail

PROJECT=event-499220
REGION=us-central1
SQL_INSTANCE=eventhub-db
DB_USER=postgres
DB_PASS=password123
DB_NAME=postgres
CONNECTION_NAME="${PROJECT}:${REGION}:${SQL_INSTANCE}"
PROXY_PORT=15432

# Start Cloud SQL Auth Proxy in the background
echo "==> Starting Cloud SQL Auth Proxy on localhost:${PROXY_PORT}..."
cloud-sql-proxy "${CONNECTION_NAME}" --port="${PROXY_PORT}" &
PROXY_PID=$!
trap "kill $PROXY_PID 2>/dev/null; exit" EXIT INT TERM

# Wait for proxy to be ready
sleep 3

export PGPASSWORD="$DB_PASS"
PSQL="psql -h 127.0.0.1 -p ${PROXY_PORT} -U ${DB_USER} -d ${DB_NAME}"

echo "==> Creating PostgREST roles..."
$PSQL -f scripts/init-db.sql

echo "==> Running migrations..."
# Sort migrations by filename (chronological) and run each.
# Skip the Supabase-specific storage bucket migration (uses storage.buckets which doesn't exist in Cloud SQL).
SKIPPED="supabase/migrations/20260612000900_attachments_bucket.sql"

for f in $(ls supabase/migrations/*.sql | sort); do
  if [ "$f" = "$SKIPPED" ]; then
    echo "   SKIP (Supabase Storage specific): $f"
    continue
  fi
  echo "   Applying: $f"
  $PSQL -f "$f"
done

echo ""
echo "==> Migrations complete!"
