# Fathom / Calendar Processing — design

**Goal:** When a Fathom-recorded meeting (planning call *or* post-event debrief) finishes,
automatically pull its transcript into the matching EventHub event and extract deliverables +
other important info as captures. If a matched meeting has no auto-transcript, prompt the team to
paste it in a Slack thread.

## Resolved requirements (from user)
- **Ingest mechanism:** Fathom **webhook** ("new meeting content ready"). Fathom signs requests
  Svix-style (`webhook-id`, `webhook-timestamp`, `webhook-signature`; HMAC-SHA256 over
  `${id}.${timestamp}.${body}`; secret is base64 after the `whsec_` prefix).
- **Output:** extract **deliverables + any other important info** — NOT only a post-event debrief.
  Fathom meetings are for planning too. Route to the existing capture homes (plan / person /
  budget / vendor / open) with planKind (deliverable / agenda / note).
- **Calendar role:** find the relevant event for the recording (title/time match, reusing the
  Upcoming-meetings logic). Auto-extract if the transcript is present; if not, post a Slack message
  prompting a paste of the transcript/summary in-thread.

## Architecture
Inbound external webhook → **Cloud Run only** (like `slack-events` / `slack-interactions`). No
Supabase twin (external services POST to the Cloud Run URL). Route registered with
`express.raw()` BEFORE the global `express.json()` so the raw body is available for HMAC.

`POST /fathom-webhook`:
1. **Verify** the Svix signature against `FATHOM_WEBHOOK_SECRET`. 401 on mismatch. Ack 200 fast.
2. **Normalize** the payload defensively (`normalizeFathomPayload`) → `{ recordingId, title,
   startTime, endTime, shareUrl, transcript, summary, actionItems[], invitees[] }`. Field names are
   under-documented, so accept snake_case + camelCase variants and **log the first raw payload** to
   pin the exact shape from a real delivery.
3. **Match** recording → event: `nameSimilar(title, event.name)` within a date window around
   `event_date` (reuse `gcal-helpers` + the `event-meetings` window logic). No confident match → log
   and 200 (nothing to do).
4. **If transcript present:** `extractTranscript(...)` → captures (home + planKind) + people, then
   `buildScrapeCaptures` → upsert `slack_capture`. Tag source = fathom (store `shareUrl` as the
   source_ref). Idempotent by capture id (recordingId in the key).
5. **If no transcript** (summary-only or nothing) on a matched event with a linked channel: post an
   in-thread Slack prompt to paste the transcript/summary (extends `transcriptNudgeText`).

## Reused code
- `gcal-helpers.nameSimilar`, `event-meetings` date-window matching.
- `slack-extract` extractor pattern + `slack-capture-lib.buildScrapeCaptures` + `slack_capture` upsert.
- `slack-api.postMessage` (extend with optional `thread_ts`).

## Deploy parity (must not forget)
- New secret **`FATHOM_WEBHOOK_SECRET`** → add to `scripts/deploy.sh` `--set-secrets` and create the
  Secret Manager entry. The webhook is dead until this exists in prod.
- Register the Cloud Run URL `https://<service>/fathom-webhook` in Fathom → Settings → API Access →
  Add Webhook (include transcript + summary + action items).
- No migration required if captures reuse `slack_capture` (home already permits our values); a
  nullable `source`/`fathom_recording_id` column is optional for dedup clarity (decide in build).

## Open items pinned by first real payload
- Exact Fathom field names (transcript entry shape, action-item fields, invitee fields).
- Whether Fathom sends the calendar event id (would make matching exact instead of fuzzy).
