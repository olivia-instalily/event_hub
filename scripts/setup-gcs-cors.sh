#!/usr/bin/env bash
# One-time GCS CORS setup (MANUAL infra step — not applied by the app deploy).
#
# Why: in prod, source materials live in a private GCS bucket and are read in the browser via
# signed URLs. Text previews (.md/.csv/.txt/.json) use fetch(signedUrl), which the browser blocks
# cross-origin unless the bucket has a CORS policy. (Local dev uses Supabase Storage, which is
# already permissive — hence "works locally, not in prod".) Signed URLs remain the access gate;
# CORS only lets the browser expose the response to JS, so origin "*" is safe here.
#
# Run once per environment (already applied to event-499220 on 2026-07-13).
set -euo pipefail
PROJECT="${PROJECT:-event-499220}"
BUCKETS=("gs://${PROJECT}-eventhub-docs" "gs://${PROJECT}-eventhub-public")

CORS_JSON="$(mktemp)"
cat > "$CORS_JSON" <<'JSON'
[
  {
    "origin": ["*"],
    "method": ["GET", "HEAD"],
    "responseHeader": ["Content-Type", "Content-Length", "Content-Disposition"],
    "maxAgeSeconds": 3600
  }
]
JSON

for b in "${BUCKETS[@]}"; do
  echo "Applying CORS to $b"
  gcloud storage buckets update "$b" --cors-file="$CORS_JSON" --project "$PROJECT"
done
rm -f "$CORS_JSON"
echo "Done. Verify: curl -sI -H 'Origin: https://<app>' https://storage.googleapis.com/${PROJECT}-eventhub-docs/probe | grep -i access-control-allow-origin"
