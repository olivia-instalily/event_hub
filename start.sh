#!/bin/sh
# EventHub container startup — PostgREST, Node.js functions, Caddy.
# Cloud Run provides the Cloud SQL socket via --add-cloudsql-instances.
# All processes log to stdout; if any exits unexpectedly the container exits.

set -e

INSTANCE="${CLOUD_SQL_CONNECTION_NAME:-event-499220:us-central1:eventhub-db}"
SOCKET_DIR="/cloudsql"

# Wait for the Cloud Run-managed Cloud SQL socket (up to 15 s)
SOCKET="$SOCKET_DIR/$INSTANCE/.s.PGSQL.5432"
echo "[start] waiting for Cloud SQL socket at $SOCKET"
for i in $(seq 1 30); do
  [ -S "$SOCKET" ] && break
  sleep 0.5
done
if [ ! -S "$SOCKET" ]; then
  echo "[start] ERROR: Cloud SQL socket not ready after 15s" >&2
  exit 1
fi
echo "[start] Cloud SQL socket ready"

# ── 1. PostgREST ─────────────────────────────────────────────────────────────
export PGRST_DB_URI="postgresql://postgres:${DB_PASSWORD}@localhost/postgres?host=${SOCKET_DIR}/${INSTANCE}"
export PGRST_DB_SCHEMA="${PGRST_DB_SCHEMA:-public}"
export PGRST_DB_ANON_ROLE="${PGRST_DB_ANON_ROLE:-anon}"
export PGRST_JWT_SECRET="${POSTGREST_JWT_SECRET}"
export PGRST_SERVER_PORT=3000
export PGRST_LOG_LEVEL="${PGRST_LOG_LEVEL:-warn}"

echo "[start] launching postgrest on :3000"
postgrest &
PGRST_PID=$!

# ── 2. Node.js functions server ───────────────────────────────────────────────
export SUPABASE_URL="http://localhost:9000"
export SUPABASE_SERVICE_ROLE_KEY="${POSTGREST_SERVICE_JWT}"
export FUNCTIONS_PORT=3001

echo "[start] launching functions server on :3001"
node /functions/dist/index.js &
FUNCS_PID=$!

# ── 3. Caddy ──────────────────────────────────────────────────────────────────
echo "[start] launching caddy on :${PORT:-8080}"
caddy run --config /etc/caddy/Caddyfile --adapter caddyfile &
CADDY_PID=$!

# ── Wait — exit if any process dies ──────────────────────────────────────────
wait_any() {
  while true; do
    for pid in $PGRST_PID $FUNCS_PID $CADDY_PID; do
      if ! kill -0 "$pid" 2>/dev/null; then
        echo "[start] process $pid exited unexpectedly — shutting down" >&2
        kill $PGRST_PID $FUNCS_PID $CADDY_PID 2>/dev/null || true
        exit 1
      fi
    done
    sleep 2
  done
}

wait_any
