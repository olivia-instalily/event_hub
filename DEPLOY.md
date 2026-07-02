# EventHub — Deployment Brief (for GCP)

Context for an engineer standing this up outside local dev. Today it runs **entirely
locally** against a local Supabase stack; nothing is deployed yet.

## 0. What EventHub is / what it's for

EventHub is InstaLILY's **internal event operations tool** — one place to plan, run, and
learn from company events (client summits, community/brand events, hackathons, run clubs,
sponsorships, internal socials, etc.). It's used by the events team internally; it is **not a
public/customer-facing product**.

**One-liner:** it turns ad-hoc event planning into a repeatable, self-improving system with a
single source of truth for every event's plan, budget, people, and post-mortem.

### The core idea (why it's shaped the way it is)
Events repeat with variations. EventHub treats every event as an instance of a reusable
**pattern (template)**, and every finished event feeds knowledge back into that pattern and
forward into comparable future events. So the app is built around a loop:

**Template → spin up an event → plan/run it → wrap it up → learnings flow back to the
template and forward to similar events.**

That loop is why you'll see "templates," "carried learnings," "settle" (carry back), and
"comparable events" all through the code — they're the mechanics of the compounding loop, not
incidental features.

### The lifecycle it covers
- **Templates → events.** A template ("Event Type") is a date-less reusable pattern: phases,
  deliverables (as **T-offsets**, e.g. T-14/T-0), roles, vendor categories, outreach copy,
  guardrails. You **spin up** a template into a concrete, dated event; offsets resolve to real
  due dates.
- **Intake.** Create by dropping a brief/CSV/folder (or pasting) → an extractor (Claude when
  keyed, deterministic heuristic otherwise) proposes fields → you review → it creates a
  planning event, a template, or (for a past date) a **backfilled** record.
- **Planning.** A phased **timeline** of deliverables with due dates + statuses; **budget**
  (line items with lifecycle: estimate → quoted → in_review → paid); **vendors**
  (engagements + candidate quotes); **staffing** roles; **guardrails/learnings**.
- **People.** Attendees per event + a "**who mattered**" tagging workspace — event-scoped tags
  in lenses (candidate / prospect / partner), propose-then-confirm, that roll up per person
  across events. Optional **Greenhouse** (application status by email) and **Luma** (RSVPs)
  enrichment.
- **Wrap-up & learning.** After the event: a **completeness** panel ("what would make this a
  complete record"), a **debrief** → extracted learnings/follow-ups/actuals, mark the record
  complete (green check on cards), then **settle** to carry confirmed learnings back to the
  template. **Carried learnings** surface a source event's learnings on it and on anything
  spawned from it / comparable to it.
- **Event pages (optional).** A no-code page builder for a public event landing page
  (data-bound content + theme), with a dev round-trip ("eject" to a repo).

### Key domain objects (maps to the DB)
`event` (concrete or `is_template`) · `event_series` (groups events; **learnings live here** in
the `reflection` table) · `deliverable` (tasks; `linear_issue_id`) · `budget` / `budget_line`
· `engagement` / `engagement_candidate` (vendors) · `attendee` / `attendee_event` /
`person_tag` (people + who-mattered tagging) · `label` (+ `event_label`, `attendee_label`) ·
`profile` (team members) · `reflection` (series-level learnings, now with source `event_id`) ·
`app_setting` (cached integration ids). Events also carry JSON columns: `phases`,
`reflections` (event-level learnings — note this is **separate** from the `reflection` table),
`source_materials` (tagged files), `page_draft`, `role_assignments`, plus lifecycle fields
`macro_stage`, `settle_state` (just_wrapped → debriefed → settled), `setup_complete`, and the
integration ids (`gcal_*`, `linear_*`, `luma_*`).

### Integrations (all optional; degrade gracefully if unconfigured)
- **Anthropic** — extraction (briefs/debriefs), template/page generation, summaries, and the
  "@Linear-in-Slack"-style update triage. Without a key, code falls back to heuristics.
- **Luma** — attach/create event pages, import RSVPs.
- **Google Calendar** — push events to one shared company calendar (`calendar@instalily.ai`).
- **Linear** — mirror deliverables ↔ issues (EventHub → Linear on demand/edit; Linear →
  EventHub pull on load).
- **Gmail** — pull vendor-domain correspondence into an event's activity feed.
- **Slack** — post messages. **Greenhouse** — read-only application status by email.

### ⚠️ Engineering realities to know before deploying
- **No authentication gate.** There is **no login**. `profile` is a lightweight *profile
  switcher* (current profile id in `localStorage`), not auth. Anyone who can load the app can
  use it.
- **RLS is OFF.** Tables grant full CRUD to `anon`/`authenticated` (32 migrations do this).
  The Supabase **anon key therefore grants full read/write to the whole DB.** Combined with
  no login, **this must not be exposed on the public internet as-is.** Put it behind network
  controls (VPN / IAP / Cloud Armor / an auth proxy), and/or add real Supabase Auth + RLS
  before any untrusted exposure. Treat this as the #1 pre-prod task.
- **Secrets live only in edge functions**, never the client (client holds just the anon key +
  Supabase URL). All third-party API calls and LLM calls happen server-side in Deno functions.
- **Two learnings stores.** `event.reflections` (JSON, event-level) and the `reflection` table
  (series-level, used for carried learnings + settle). They're related but distinct — don't
  assume one.
- **IDs are app-generated text** (prefixed: `evt-`, `del-`, `ref-`, …), not DB UUIDs.
- **Some state is client-only.** Scoping/budget-assignment data is kept in `localStorage`
  (not the DB) — it won't move between browsers/users.
- **State-based navigation, no router.** One `index.html`; deep links aren't a concern, but do
  configure SPA fallback anyway.

## 1. What this app is (stack)

- **Frontend:** React 19 + Vite 6 + TypeScript + Tailwind v4. A single-page app with
  **state-based navigation (no router)** — one `index.html`, no server-side routing needed.
  Build: `npm run build` → static assets in `dist/`.
- **Backend: Supabase.** Postgres **17**, Supabase Auth, Supabase Storage, and **17 Deno
  edge functions** (`supabase/functions/*`). DB schema is **54 SQL migrations**
  (`supabase/migrations/`). Two storage buckets, both created by migrations: **`attachments`**
  (`20260612000900_…`; **public-read**, low-sensitivity — cover images / avatars) and
  **`documents`** (`20260702000000_…`; **private**, sensitive dropped docs — briefs / budgets /
  debriefs / vendor sheets — served only via short-lived **signed URLs**).
- **Private dependency:** `@instalily/ui@^2.2.0` is pulled from **GitHub Packages**
  (`.npmrc`: `@instalily:registry=https://npm.pkg.github.com`). CI needs a GitHub token
  with `read:packages` to `npm install` (see §5).

> ⚠️ **Architectural note:** the entire backend is Supabase-shaped — it calls the Supabase
> JS client, RLS-is-off tables, the Storage API, and Deno edge functions. There is **no
> GCP-native backend**. The low-effort path is **managed Supabase Cloud for the backend +
> host the static frontend on GCP**. Rebuilding onto Cloud SQL / Cloud Functions / GCS
> would be a large port. Self-hosting Supabase on GKE/Compute is possible but heavy ops.
> Recommendation below assumes **Supabase Cloud + GCP-hosted frontend**.

## 2. Backend — Supabase Cloud

1. Create a Supabase project (Postgres 17). Grab its URL, `anon` key, and `service_role` key.
2. Link + push schema and functions from this repo:
   ```
   supabase login
   supabase link --project-ref <ref>
   supabase db push                 # applies all migrations
   supabase functions deploy        # deploys all 17 functions
   ```
3. **Storage:** both buckets are created by migrations, so `db push` handles them. Verify
   **`attachments`** exists (public-read) and **`documents`** exists (private) after push.
4. **Function secrets** — set via `supabase secrets set KEY=value` (see §4). Note:
   `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are **auto-injected** into cloud edge
   functions — do **not** set those manually.
5. **Auth:** set `site_url` (and redirect URLs) to the deployed frontend origin (config
   currently points at `http://127.0.0.1:3000`).

## 3. Frontend — GCP hosting

Static SPA. Any of these work; pick one:
- **Cloud Storage bucket + Cloud CDN + HTTPS LB** (cheapest for static). Upload `dist/`,
  set `index.html` as main + 404 fallback → `index.html` (SPA fallback).
- **Cloud Run** (container serving `dist/` via nginx/caddy) — simplest CI story.
- **Firebase Hosting** (GCP-adjacent, trivial for SPAs).

Client env vars are **baked at build time** (Vite), so they must be set in the build step,
not at runtime:
- `VITE_SUPABASE_URL` = the Supabase project URL
- `VITE_SUPABASE_ANON_KEY` = the Supabase anon key

Build command: `npm ci && npm run build` (needs the GitHub Packages token, §5).

## 4. Environment variables / secrets

### Client (build-time, Vite) — required
| Var | Notes |
|---|---|
| `VITE_SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon key (safe to ship) |

### Edge-function secrets (`supabase secrets set`)
Auto-injected by Supabase (do NOT set): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.

| Var | Used by | Required? | How to obtain |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | detect-update, comparable-lessons, extract-brief/debrief, generate-*, planning-summary, summarize-correspondence | Recommended (features degrade to heuristics without it) | Anthropic console |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | gmail-sync (and gcal fallback) | Only if Gmail sync used | Google Cloud OAuth client |
| `GMAIL_REFRESH_TOKEN` | gmail-sync | Only if Gmail sync used | `node scripts/gmail-auth.mjs` (one-time consent) |
| `GCAL_CLIENT_ID` / `GCAL_CLIENT_SECRET` | gcal-sync | Google Calendar sync | OAuth client in **calendar@instalily.ai's own GCP project** (Calendar API enabled there) |
| `GCAL_REFRESH_TOKEN` | gcal-sync | Google Calendar sync | `node scripts/gcal-auth.mjs`, signed in as calendar@instalily.ai |
| `GCAL_TIMEZONE` | gcal-sync | Optional (default `America/New_York`) | — |
| `GCAL_CALENDAR_ID` | gcal-sync | Optional | Set to a specific calendar; omit to auto-create "EventHub Events" |
| `LINEAR_API_KEY` | linear-sync | Only if Linear sync used | Linear → Settings → API → personal key |
| `LINEAR_TEAM_ID` | linear-sync | Optional | Omit to auto-create/lookup the "EventHub" team |
| `LUMA_API_KEY` | attach-luma, create-luma, luma-import | Only if Luma used | Luma API |
| `SLACK_BOT_TOKEN` | slack-send | Only if Slack used | Slack app bot token |
| `GREENHOUSE_API_KEY` | greenhouse-sync | Only if Greenhouse used | Greenhouse Harvest (read-scoped) |
| `OPENAI_API_KEY` | referenced in `supabase/config.toml` (Studio helper) | Optional | — |

The one-time OAuth minting scripts live in `scripts/gmail-auth.mjs` and `scripts/gcal-auth.mjs`
(loopback OAuth on `http://localhost:53682` — add that redirect URI to the OAuth client).

### External enablement gotchas (learned the hard way)
- **Google Calendar API must be enabled on the SAME GCP project the OAuth client belongs
  to.** Calendar uses its own `GCAL_*` client (kept separate from Gmail's `GOOGLE_*`) so it
  can live in a project the calendar account owns.
- Org policy may block service-account key creation → we use the **user-OAuth refresh-token**
  flow (not service accounts) for Google.

## 5. Private package auth (CI)

`npm install` will 401 on `@instalily/ui` without a GitHub Packages token. In CI, write an
`.npmrc` (do not commit the token):
```
@instalily:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_PACKAGES_TOKEN}
```
Token needs `read:packages`. Provide it as a CI secret.

## 6. Build / runtime specifics

- No Node version is pinned; use **Node 20 LTS** (Vite 6 needs ≥18).
- `npm run build` runs `tsc -b && vite build`. TypeScript is strict — build fails on unused
  vars, etc.
- There's a dev-only `optimizeDeps.include` block in `vite.config.ts` for Base UI + a
  `use-sync-external-store/shim` CJS quirk. **Dev only** — not a production concern.
- Edge functions are **Deno** (deployed by the Supabase CLI, not bundled with the frontend).
- No existing CI/CD, Dockerfile, or cloud config in the repo — all to be created.

## 7. Post-deploy smoke checks

- App loads and lists events (Supabase reachable, anon key correct).
- Drop a CSV on an event → budget import works (Storage + functions reachable).
- If enabled: "Add to Google Calendar" on an event, "Sync to Linear" on the Deliverables tab.
- Confirm `attachments` serves cover/avatar files over its public URL, and that a dropped
  brief/budget lands in the private `documents` bucket and previews via a signed URL.

## 8. Pre-deploy: what to alter / add (in priority order)

### P0 — Security (blockers; today the app is open + full-access)
1. **Decide the access model — this is THE decision.** The client ships the Supabase **anon
   key**, and **RLS is off**, so that key = full read/write to the whole DB. There is also **no
   login**. On public Supabase Cloud, anyone who extracts the anon key from the bundle has full
   DB access — so gating only the frontend is **not** sufficient. Pick one:
   - **(a) Supabase Auth + RLS** — add a login and Row-Level-Security policies on every table.
     Most correct; most work (≈27 tables + the `anon` grants to revisit).
   - **(b) Self-host Supabase in a private GCP network** (no public Postgres/PostgREST) with the
     whole app behind **IAP/VPN**. Avoids rewriting RLS; heavier ops.
   - **(c) Interim for a tight internal rollout:** frontend behind **IAP** (restrict to the
     instalily.ai Workspace) **+ Supabase network/IP allowlist** so the Supabase API is only
     reachable from the app's egress. Mitigates the exposed-anon-key hole without an RLS rewrite.
   > Recommended: (c) to ship internally fast, with (a) as the durable follow-up.
2. **Storage sensitivity — largely addressed.** Sensitive dropped docs (briefs, budgets,
   debriefs, vendor sheets) now go to the **private `documents` bucket** and are served via
   short-lived **signed URLs** (`uploadDocument` + `signDocValues` in `src/lib/db.ts`), so they're
   **not** fetchable by raw URL. The **public `attachments`** bucket now holds only
   low-sensitivity assets (cover images, avatars). Remaining check: confirm nothing sensitive is
   still routed to `attachments`, and treat the public bucket's contents as world-readable.
3. **Secrets hygiene.** Move all keys out of the local `.env` / `supabase/functions/.env` into
   managed secrets (Supabase function secrets + GCP Secret Manager for CI). Confirm the
   **service_role key is never** in the client bundle (it isn't today — keep it that way).
   Rotate any refresh tokens / keys that were shared during local setup.

### P1 — Make it run on GCP
4. **Backend:** create the Supabase Cloud project → `supabase link` → `db push` (54 migrations,
   incl. the `attachments` + `documents` buckets) → `functions deploy` (17 functions). (Or
   self-host per P0-b.)
5. **Frontend:** build with `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` (baked at build),
   host on Cloud Run / GCS+LB / Firebase, with SPA fallback to `index.html`.
6. **CI:** provide the **GitHub Packages token** (`read:packages`) so `npm ci` can pull
   `@instalily/ui` (see §5). No pipeline exists yet — create build + deploy.
7. **Function secrets:** set every key the enabled integrations need (§4 table) via
   `supabase secrets set`. Leave `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` to Supabase.
8. **Auth/redirects & OAuth:** set `site_url` + redirect URLs to the deployed origin. If you
   mint fresh Google refresh tokens for prod, register the prod **redirect URIs** on the OAuth
   clients (local uses loopback `:53682`).

### P2 — Hardening
9. **Observability:** wire Cloud Logging / error reporting (edge functions already
   `console.error` structured JSON on failure) and a frontend error boundary / Sentry. None exists.
10. **Backups:** enable Supabase PITR/backups (paid tier).
11. **CORS:** edge functions currently allow `*` — scope to the frontend origin if desired.
12. **No local assumptions in prod config:** the client only reads `VITE_*`; the root `.env`
    `SUPABASE_URL=127.0.0.1` is for local scripts only — don't ship it. Double-check no
    `localhost`/`127.0.0.1` leaks into the built bundle.

### P3 — Product consistency (optional; non-blocking, from recent work)
- Have **settle** tick off the reflections deliverable so the "final record" green check and
  the completeness panel never disagree.
- Backfill the "Post-event reflections & insights" deliverable onto legacy events that lack it.
- The two learnings stores (`event.reflections` JSON vs the `reflection` table) could be unified.
These are polish, not deploy blockers.

## 9. Access model (c) — Cloud Run behind IAP + reverse-proxied Supabase

This is the interim secure setup (chosen over naive "IAP + IP allowlist", which doesn't work
for a browser SPA that calls Supabase directly with a full-access key). Artifacts are in the
repo: **`Dockerfile`**, **`Caddyfile`**, **`.dockerignore`**, and `src/lib/supabase.ts` now
falls back to same-origin when `VITE_SUPABASE_*` are unset.

**How it closes the hole:** the app is served from Cloud Run and talks to its **own origin**;
Caddy proxies `/rest`, `/storage`, `/functions` to Supabase and **injects the anon key
server-side**, so the key is never in the client bundle and the browser never hits Supabase
directly. **IAP** in front of Cloud Run restricts access to the instalily.ai Workspace.

### Steps
1. **Supabase Cloud** is set up per §2 (migrations + functions + secrets). Note the project ref.
2. **Build & push the image** (token for the private package is a build arg — keep it out of
   the image/layers history via `--secret` in Cloud Build, or a short-lived token):
   ```
   gcloud builds submit --tag REGION-docker.pkg.dev/PROJECT/eventhub/app \
     --build-arg GITHUB_PACKAGES_TOKEN=***     # (or wire as a Cloud Build secret)
   ```
   The frontend is built with **no** `VITE_SUPABASE_*` (same-origin proxy mode).
3. **Deploy to Cloud Run** with the proxy env (anon key as a secret):
   ```
   gcloud run deploy eventhub \
     --image REGION-docker.pkg.dev/PROJECT/eventhub/app \
     --region REGION --no-allow-unauthenticated \
     --set-env-vars SUPABASE_UPSTREAM=https://<ref>.supabase.co,SUPABASE_HOST=<ref>.supabase.co \
     --set-secrets SUPABASE_ANON_KEY=eventhub-anon-key:latest
   ```
   `--no-allow-unauthenticated` is important — IAP fronts it.
4. **Put IAP in front:** create an external HTTPS Load Balancer → Serverless NEG → the Cloud
   Run service, enable **Identity-Aware Proxy** on that backend, and grant
   **`IAP-secured Web App User`** to the `instalily.ai` domain (or a specific group). Now only
   Workspace users can load the app.
5. **(Defense in depth) Supabase network restrictions:** the anon key is no longer public, but
   you can also restrict the Supabase project's network access to the Cloud Run egress
   (reserve a static egress IP via a Serverless VPC connector + Cloud NAT, then allowlist it in
   Supabase → Settings → Network Restrictions). Optional for the interim.
6. **Custom domain (optional):** map a domain to the LB; no rebuild needed (same-origin means
   the app follows whatever host it's served on).

### What (c) does NOT do (know the residual risk)
- **RLS is still off** and the anon key still grants full DB CRUD — it's just no longer exposed
  and only reachable through the IAP-gated proxy. Anyone who *is* inside IAP has full data
  access (fine for an all-trusted internal team; revisit with real Auth + RLS = option (a) when
  you need per-user restrictions or wider access).
- **The public `attachments` bucket is still world-readable on Supabase's own domain** — but it
  now holds only low-sensitivity assets (cover images / avatars). Sensitive docs already live in
  the **private `documents` bucket** (signed URLs), so the earlier "budgets/debriefs are public"
  hole is closed; just don't route anything sensitive back into `attachments`.

### Local dev is unchanged
`.env.local` still sets `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` → the app talks to the
local stack directly (no proxy). The same-origin behavior only kicks in when those are unset
(i.e., the Docker build).
