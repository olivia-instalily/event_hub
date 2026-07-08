#!/bin/bash
# One-time GCP setup for EventHub.
# Run from the repo root: bash scripts/setup-gcp.sh
# Requires: gcloud CLI authenticated, .env present, Node.js 18+.
set -euo pipefail

PROJECT=event-499220
REGION=us-central1
SQL_INSTANCE=eventhub-db
DB_NAME=postgres
DB_USER=postgres
DB_PASS=password123

# Load API keys from .env
set -a; source .env; set +a

echo "==> Configuring project: $PROJECT"
gcloud config set project "$PROJECT"

echo "==> Enabling required APIs..."
gcloud services enable \
  sqladmin.googleapis.com \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  secretmanager.googleapis.com \
  --project="$PROJECT"

# ── Artifact Registry ─────────────────────────────────────────────────────────
echo "==> Creating Artifact Registry repo..."
gcloud artifacts repositories create eventhub \
  --repository-format=docker \
  --location="$REGION" \
  --description="EventHub images" \
  --project="$PROJECT" 2>/dev/null || echo "   (already exists)"

# ── Cloud SQL ─────────────────────────────────────────────────────────────────
echo "==> Creating Cloud SQL Postgres 16 instance (takes ~5 min)..."
if ! gcloud sql instances describe "$SQL_INSTANCE" --project="$PROJECT" &>/dev/null; then
  gcloud sql instances create "$SQL_INSTANCE" \
    --database-version=POSTGRES_16 \
    --tier=db-g1-small \
    --edition=ENTERPRISE \
    --region="$REGION" \
    --storage-size=20GB \
    --storage-auto-increase \
    --backup \
    --assign-ip \
    --project="$PROJECT"
else
  echo "   (already exists)"
fi

echo "==> Setting postgres user password..."
gcloud sql users set-password "$DB_USER" \
  --instance="$SQL_INSTANCE" \
  --password="$DB_PASS" \
  --project="$PROJECT"

# ── JWT tokens ────────────────────────────────────────────────────────────────
echo "==> Generating JWT secret and tokens..."
JWT_SECRET=$(node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))")
JWTS=$(node scripts/generate-jwts.mjs "$JWT_SECRET")
ANON_JWT=$(node -e "process.stdout.write(JSON.parse('$JWTS').anonJwt)")
SVC_JWT=$(node  -e "process.stdout.write(JSON.parse('$JWTS').serviceRoleJwt)")

# ── Secret Manager ────────────────────────────────────────────────────────────
put_secret() {
  local name=$1 value=$2
  if gcloud secrets describe "$name" --project="$PROJECT" &>/dev/null; then
    printf '%s' "$value" | gcloud secrets versions add "$name" --data-file=- --project="$PROJECT"
  else
    printf '%s' "$value" | gcloud secrets create "$name" --data-file=- \
      --replication-policy=user-managed --locations="$REGION" --project="$PROJECT"
  fi
  echo "   stored: $name"
}

echo "==> Storing secrets..."
put_secret eventhub-db-password          "$DB_PASS"
put_secret eventhub-jwt-secret           "$JWT_SECRET"
put_secret eventhub-anon-jwt             "$ANON_JWT"
put_secret eventhub-service-jwt          "$SVC_JWT"
put_secret eventhub-anthropic-key        "${ANTHROPIC_API_KEY}"
put_secret eventhub-luma-key             "${LUMA_API_KEY}"
put_secret eventhub-slack-token          "${SLACK_BOT_TOKEN}"
put_secret eventhub-google-client-id     "${GOOGLE_CLIENT_ID}"
put_secret eventhub-google-client-secret "${GOOGLE_CLIENT_SECRET}"
put_secret eventhub-gmail-refresh-token  "${GMAIL_REFRESH_TOKEN}"
put_secret eventhub-gcal-client-id       "${GCAL_CLIENT_ID}"
put_secret eventhub-gcal-client-secret   "${GCAL_CLIENT_SECRET}"
put_secret eventhub-gcal-refresh-token   "${GCAL_REFRESH_TOKEN}"
put_secret eventhub-linear-key           "${LINEAR_API_KEY}"
put_secret eventhub-google-refresh-token "${GOOGLE_REFRESH_TOKEN:-}"
put_secret eventhub-linear-team-id       "${LINEAR_TEAM_ID:-}"
[ -n "${GREENHOUSE_API_KEY:-}" ]  && put_secret eventhub-greenhouse-key    "${GREENHOUSE_API_KEY}"
[ -n "${GCAL_CALENDAR_ID:-}" ]    && put_secret eventhub-gcal-calendar-id  "${GCAL_CALENDAR_ID}"

# ── Grant Cloud Run SA access to secrets ──────────────────────────────────────
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')
SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
echo "==> Granting Secret Manager access to Cloud Run SA: $SA"
gcloud projects add-iam-policy-binding "$PROJECT" \
  --member="serviceAccount:$SA" \
  --role="roles/secretmanager.secretAccessor" \
  --quiet

# ── Grant Cloud Run SA access to Cloud SQL ────────────────────────────────────
gcloud projects add-iam-policy-binding "$PROJECT" \
  --member="serviceAccount:$SA" \
  --role="roles/cloudsql.client" \
  --quiet

echo ""
echo "==> Setup complete!"
echo ""
echo "Cloud SQL connection name: ${PROJECT}:${REGION}:${SQL_INSTANCE}"
echo ""
echo "Next steps:"
echo "  1. Run migrations:  bash scripts/run-migrations.sh"
echo "  2. Deploy:          bash scripts/deploy.sh"
