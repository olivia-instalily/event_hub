#!/usr/bin/env bash
# EventHub — full GCP deploy
# Usage: ./scripts/deploy.sh [--skip-build]
#
# Prerequisites:
#   - gcloud auth login && gcloud config set project event-499220
#   - scripts/setup-gcp.sh already run (secrets + Cloud SQL exist)
#   - scripts/run-migrations.sh already run

set -euo pipefail

PROJECT="event-499220"
REGION="us-central1"
REPO="eventhub"
SERVICE="eventhub"
IMAGE="$REGION-docker.pkg.dev/$PROJECT/$REPO/app"
SQL_INSTANCE="$PROJECT:$REGION:eventhub-db"

# ── Resolve GITHUB_PACKAGES_TOKEN ────────────────────────────────────────────
if [ -z "${GITHUB_PACKAGES_TOKEN:-}" ]; then
  # Try to pull from .env in the repo root
  ENV_FILE="$(dirname "$0")/../.env"
  if [ -f "$ENV_FILE" ]; then
    GITHUB_PACKAGES_TOKEN="$(grep -E '^GITHUB_TOKEN=' "$ENV_FILE" | cut -d= -f2- | tr -d '\"' | head -1)"
  fi
fi
if [ -z "${GITHUB_PACKAGES_TOKEN:-}" ]; then
  echo "ERROR: GITHUB_PACKAGES_TOKEN not set and not found in .env" >&2
  exit 1
fi

SKIP_BUILD="${1:-}"

# ── Build & push via Cloud Build ─────────────────────────────────────────────
if [ "$SKIP_BUILD" != "--skip-build" ]; then
  echo "==> Building image via Cloud Build..."
  gcloud builds submit \
    --project "$PROJECT" \
    --region "$REGION" \
    --substitutions "_GITHUB_PACKAGES_TOKEN=$GITHUB_PACKAGES_TOKEN" \
    --config cloudbuild.yaml \
    .
else
  echo "==> Skipping build (--skip-build)"
fi

# ── Read secrets from Secret Manager (just their names — Cloud Run refs them) ─
# We reference them by name in --set-secrets below; no local values needed.

echo "==> Deploying to Cloud Run..."
gcloud run deploy "$SERVICE" \
  --project "$PROJECT" \
  --region "$REGION" \
  --image "$IMAGE:latest" \
  --platform managed \
  --no-allow-unauthenticated \
  --add-cloudsql-instances "$SQL_INSTANCE" \
  --memory 512Mi \
  --cpu 1 \
  --min-instances 0 \
  --max-instances 4 \
  --timeout 60 \
  --set-env-vars "CLOUD_SQL_CONNECTION_NAME=$SQL_INSTANCE" \
  --set-secrets "\
DB_PASSWORD=eventhub-db-password:latest,\
POSTGREST_JWT_SECRET=eventhub-jwt-secret:latest,\
POSTGREST_ANON_JWT=eventhub-anon-jwt:latest,\
POSTGREST_SERVICE_JWT=eventhub-service-jwt:latest,\
ANTHROPIC_API_KEY=eventhub-anthropic-key:latest,\
LINEAR_API_KEY=eventhub-linear-key:latest,\
LUMA_API_KEY=eventhub-luma-key:latest,\
SLACK_BOT_TOKEN=eventhub-slack-token:latest,\
GREENHOUSE_API_KEY=eventhub-greenhouse-key:latest,\
GOOGLE_CLIENT_ID=eventhub-google-client-id:latest,\
GOOGLE_CLIENT_SECRET=eventhub-google-client-secret:latest,\
GOOGLE_REFRESH_TOKEN=eventhub-google-refresh-token:latest,\
GMAIL_REFRESH_TOKEN=eventhub-gmail-refresh-token:latest"

URL=$(gcloud run services describe "$SERVICE" \
  --project "$PROJECT" \
  --region "$REGION" \
  --format "value(status.url)")

echo ""
echo "==> Deployed: $URL"
echo "    (Service requires authentication — share via IAP or grant roles/run.invoker)"
