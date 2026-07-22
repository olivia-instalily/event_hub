# Google Calendar dual-calendar auto-sync — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every dated, non-template EventHub event auto-syncs to the primary `calendar@instalily.ai` calendar AND the *Instalily Events Coordination* calendar, with a match-and-adopt confirmation to avoid duplicates, consistent titles, and bidirectional links.

**Architecture:** The sync runs server-side in the `/gcal-sync` cloud function (dual-maintained in `cloud-functions/src/functions/gcal-sync.ts` for prod and `supabase/functions/gcal-sync/index.ts` for local). Pure logic (title, time-overlap, name-similarity, owned-marker, eligibility) lives in a testable helper module used by the cloud function. The frontend (`db.ts`) fires the sync fire-and-forget from event mutation paths and renders a match-confirmation prompt from a new `gcal_match_pending` column.

**Tech Stack:** React 18 + TS, Tailwind, supabase-js (PostgREST as `authenticated`), Express (cloud-functions, Node) + Deno (supabase functions), vitest, Google Calendar REST v3.

## Global Constraints

- **Target calendars:** primary = the API id `primary` (resolves to `calendar@instalily.ai`); coordination = `process.env.GCAL_COORDINATION_CALENDAR_ID` defaulting to `c_fad28a2710da5efc5126158eae561ee3107d4afc395bbc595f051f0117a1d0fd@group.calendar.google.com`. Write to BOTH.
- **Eligibility:** sync only when `event_date` is set AND `is_template = false`. External (`is_external=true`) dated events DO sync.
- **Canonical title:** `gcalTitle(name, location)` → `"{name} · {location}"` (middle dot `·`, U+00B7) when a location exists, else `"{name}"`. Applied on every create and patch.
- **Owned marker:** the EventHub deep-link line in a Google event's description marks it EventHub-owned. Format: `EventHub: <url>`. Match candidates carrying this marker are excluded.
- **Identity:** `gcal_event_ids` jsonb maps `calendarId → googleEventId`. `gcal_event_id` (legacy) + `gcal_html_link` always mirror the **primary** copy.
- **Match gate (first sync only):** search BOTH calendars in a date ±1 day window; a candidate qualifies on time-overlap AND name-similarity AND not-owned. Any candidate → persist to `gcal_match_pending`, create nothing. None → create silently.
- **Actions:** `auto` (default), `link`, `create`, `delete`.
- **Dual-maintenance:** every change to `cloud-functions/src/functions/gcal-sync.ts` is mirrored in `supabase/functions/gcal-sync/index.ts`.
- **Migration parity:** the migration is applied to BOTH prod (Cloud SQL) and local Supabase, each followed by `NOTIFY pgrst, 'reload schema'`.
- **Non-blocking:** auto-trigger failures never block the user's save (swallow to a console warn).

---

### Task 1: Migration — `gcal_event_ids` + `gcal_match_pending`

**Files:**
- Create: `supabase/migrations/20260722010000_gcal_dual_calendar.sql`

- [ ] **Step 1: Write the migration**
```sql
-- Track the Google Calendar copy of an event per calendar (we write to two calendars now), plus a
-- pending match awaiting user confirmation. See docs/superpowers/specs/2026-07-22-gcal-auto-sync-design.md.
ALTER TABLE event ADD COLUMN IF NOT EXISTS gcal_event_ids jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE event ADD COLUMN IF NOT EXISTS gcal_match_pending jsonb;  -- nullable: candidate matches awaiting a decision
GRANT UPDATE (gcal_event_ids, gcal_match_pending) ON event TO anon, authenticated;
```

- [ ] **Step 2: Apply to LOCAL + reload schema** (controller step)
```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -f supabase/migrations/20260722010000_gcal_dual_calendar.sql
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -tAc "NOTIFY pgrst, 'reload schema';"
```

- [ ] **Step 3: Apply to PROD + reload schema** (controller step — cloud-sql-proxy on :9470, PGPASSWORD from .env DB_PASSWORD). Verify both columns exist. **This must land before Task 5's `getEventPlanning` select ships**, or event pages 400.

- [ ] **Step 4: Commit** `git add supabase/migrations/20260722010000_gcal_dual_calendar.sql && git commit -m "migration: gcal_event_ids + gcal_match_pending on event"`

---

### Task 2: Pure sync helpers + tests (server-side, in cloud-functions)

**Files:**
- Create: `cloud-functions/src/functions/gcal-helpers.ts`, `cloud-functions/src/functions/gcal-helpers.test.ts`

**Interfaces:**
- Produces:
  - `gcalTitle(name: string | null, location: string | null): string`
  - `isEligible(ev: { event_date: string | null; is_template: boolean }): boolean`
  - `timeOverlap(a: Span, b: Span): boolean` where `Span = { start: string; end: string; allDay: boolean }` (ISO strings; all-day uses `YYYY-MM-DD`)
  - `nameSimilar(a: string, b: string): boolean`
  - `isOwned(description: string | null | undefined): boolean`
  - `EVENTHUB_MARKER = "EventHub:"`

- [ ] **Step 1: Failing test** — `cloud-functions/src/functions/gcal-helpers.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { gcalTitle, isEligible, timeOverlap, nameSimilar, isOwned } from "./gcal-helpers.js";

describe("gcalTitle", () => {
  it("joins name and location with a middle dot", () => { expect(gcalTitle("Hackathon", "Waterloo")).toBe("Hackathon · Waterloo"); });
  it("drops the separator with no location", () => { expect(gcalTitle("Hackathon", null)).toBe("Hackathon"); expect(gcalTitle("Hackathon", "  ")).toBe("Hackathon"); });
});
describe("isEligible", () => {
  it("dated non-template → true", () => { expect(isEligible({ event_date: "2026-09-01", is_template: false })).toBe(true); });
  it("undated → false; template → false", () => {
    expect(isEligible({ event_date: null, is_template: false })).toBe(false);
    expect(isEligible({ event_date: "2026-09-01", is_template: true })).toBe(false);
  });
});
describe("timeOverlap", () => {
  it("all-day same day overlaps", () => { expect(timeOverlap({ start: "2026-09-01", end: "2026-09-02", allDay: true }, { start: "2026-09-01", end: "2026-09-02", allDay: true })).toBe(true); });
  it("timed overlap vs disjoint", () => {
    expect(timeOverlap({ start: "2026-09-01T09:00:00", end: "2026-09-01T11:00:00", allDay: false }, { start: "2026-09-01T10:00:00", end: "2026-09-01T12:00:00", allDay: false })).toBe(true);
    expect(timeOverlap({ start: "2026-09-01T09:00:00", end: "2026-09-01T10:00:00", allDay: false }, { start: "2026-09-01T11:00:00", end: "2026-09-01T12:00:00", allDay: false })).toBe(false);
  });
});
describe("nameSimilar", () => {
  it("matches near-identical / contained titles", () => {
    expect(nameSimilar("NYC Run Club", "nyc run club")).toBe(true);
    expect(nameSimilar("Waterloo Hackathon 2026", "Waterloo Hackathon")).toBe(true);
  });
  it("rejects unrelated titles", () => { expect(nameSimilar("NYC Run Club", "Toronto Investor Dinner")).toBe(false); });
});
describe("isOwned", () => {
  it("true when the EventHub marker is present", () => { expect(isOwned("Fun\n\nEventHub: https://app/?event=e1")).toBe(true); });
  it("false otherwise", () => { expect(isOwned("just a normal event")).toBe(false); expect(isOwned(null)).toBe(false); });
});
```

- [ ] **Step 2: Run — fails** (`cd cloud-functions && npx vitest run src/functions/gcal-helpers.test.ts`).

- [ ] **Step 3: Implement** — `cloud-functions/src/functions/gcal-helpers.ts`:
```ts
export const EVENTHUB_MARKER = "EventHub:";
export interface Span { start: string; end: string; allDay: boolean }

export function gcalTitle(name: string | null, location: string | null): string {
  const n = (name ?? "Untitled event").trim();
  const loc = (location ?? "").trim();
  return loc ? `${n} · ${loc}` : n;
}

export function isEligible(ev: { event_date: string | null; is_template: boolean }): boolean {
  return !!ev.event_date && !ev.is_template;
}

export function isOwned(description: string | null | undefined): boolean {
  return !!description && description.includes(EVENTHUB_MARKER);
}

// Millisecond bounds; all-day dates parse at local midnight. Overlap is half-open [start,end).
function ms(iso: string): number { return new Date(iso.length === 10 ? iso + "T00:00:00" : iso).getTime(); }
export function timeOverlap(a: Span, b: Span): boolean {
  return ms(a.start) < ms(b.end) && ms(b.start) < ms(a.end);
}

// Normalized token-set similarity: lowercased, punctuation stripped. Match when one is contained in
// the other, or Jaccard overlap of word sets ≥ 0.5.
function tokens(s: string): Set<string> {
  return new Set(s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean));
}
export function nameSimilar(a: string, b: string): boolean {
  const na = a.toLowerCase().replace(/[^a-z0-9]/g, ""), nb = b.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!na || !nb) return false;
  if (na.includes(nb) || nb.includes(na)) return true;
  const ta = tokens(a), tb = tokens(b);
  if (!ta.size || !tb.size) return false;
  let inter = 0; for (const t of ta) if (tb.has(t)) inter++;
  const union = ta.size + tb.size - inter;
  return union > 0 && inter / union >= 0.5;
}
```

- [ ] **Step 4: Run — passes.**
- [ ] **Step 5: Typecheck** (`cd cloud-functions && npx tsc --noEmit`) — clean.
- [ ] **Step 6: Commit** `git add cloud-functions/src/functions/gcal-helpers.ts cloud-functions/src/functions/gcal-helpers.test.ts && git commit -m "feat(gcal): pure sync helpers (title, eligibility, overlap, similarity, owned)"`

---

### Task 3: Rewrite the prod cloud function (`gcal-sync.ts`)

**Files:** Modify `cloud-functions/src/functions/gcal-sync.ts`

**Interfaces:**
- Consumes: `gcal-helpers.js` (Task 2), `getServiceClient` (existing), Google Calendar REST.
- Request body: `{ eventId: string; action?: "auto" | "link" | "create" | "delete"; appOrigin?: string }`.
- Responses: `{ ok, status: "synced" | "needs_confirmation" | "deleted", gcalEventIds?, htmlLink?, candidates? }`.

- [ ] **Step 1: Calendar-id constants + token/appLink (reuse existing `accessToken`, `appLinkFor`).** Replace `ensureCalendar` with:
```ts
const PRIMARY = "primary";
const COORD = () => process.env.GCAL_COORDINATION_CALENDAR_ID
  ?? "c_fad28a2710da5efc5126158eae561ee3107d4afc395bbc595f051f0117a1d0fd@group.calendar.google.com";
const CALENDARS = () => [PRIMARY, COORD()];
const EVENT_COLOR_ID = "9"; // a distinct hue so EventHub events read as a set
```

- [ ] **Step 2: `buildBody`** — set `summary: gcalTitle(ev.name, ev.location)`, keep the description (with the `EventHub: <appLink>` line = the owned marker), add `colorId: EVENT_COLOR_ID`, keep timed/all-day start-end logic.

- [ ] **Step 3: Google REST helpers** (fetch wrappers): `gcalInsert(token, calId, body)`, `gcalPatch(token, calId, gid, body)`, `gcalDelete(token, calId, gid)` (treat 404/410 as success), `gcalListWindow(token, calId, dateFrom, dateTo)` → returns candidate `{ id, summary, description, start, end, htmlLink }[]`.

- [ ] **Step 4: Upsert one calendar** — `upsertOn(token, calId, ev, ids)`: if `ids[calId]` → PATCH else POST; return `{ calId, gid, htmlLink }`.

- [ ] **Step 5: Match search** — `findCandidate(token, calId, ev)`: window = `event_date` ±1 day; for each returned event build a `Span` and test `timeOverlap` AND `nameSimilar(gcalTitle-less name vs candidate.summary)` AND `!isOwned(candidate.description)`; return the first qualifying `{ gcalEventId, summary, start, htmlLink }` or null.

- [ ] **Step 6: Handler control flow:**
  - Load event (`id, name, event_date, start_time, end_time, location, description, luma_url, is_template, gcal_event_ids, gcal_match_pending`).
  - `action === "delete"` → for each `[calId,gid]` in `gcal_event_ids`, `gcalDelete`; clear `gcal_event_ids`, `gcal_event_id`, `gcal_html_link`, `gcal_match_pending`; respond `status:"deleted"`.
  - Guard `isEligible(ev)` (else 400 "event has no date / is a template").
  - `action === "auto"` and `gcal_event_ids` empty:
    - for each calendar run `findCandidate`; if ANY found → write `gcal_match_pending = { [calId]: candidate|null }`, respond `status:"needs_confirmation", candidates`. Create nothing.
  - `action === "link"` → for each calendar: if `gcal_match_pending[calId]` has a candidate, PATCH it (title=`gcalTitle`, inject the `EventHub:` line into its description if absent, set colorId) and record its id; else `upsertOn`. Clear `gcal_match_pending`.
  - `action === "create"` → `upsertOn` on both, clear `gcal_match_pending`.
  - default `auto` with existing ids → `upsertOn` on both (patch).
  - After any write path: persist `gcal_event_ids` (map), `gcal_event_id` = primary id, `gcal_html_link` = primary htmlLink; respond `status:"synced"`.

- [ ] **Step 7: Typecheck** (`cd cloud-functions && npx tsc --noEmit`) — clean.
- [ ] **Step 8: Commit** `git add cloud-functions/src/functions/gcal-sync.ts && git commit -m "feat(gcal): dual-calendar sync with match-adopt, actions, title, color"`

---

### Task 4: Mirror into the Deno function (`supabase/functions/gcal-sync/index.ts`)

**Files:** Modify `supabase/functions/gcal-sync/index.ts`

- [ ] **Step 1:** Port the Task 2 helpers inline (Deno can't import the Node `.ts`; copy `gcalTitle`/`isEligible`/`timeOverlap`/`nameSimilar`/`isOwned` verbatim into the file) and the Task 3 control flow, using the Deno request/response + service client already in the file. Keep the `DUAL-MAINTAINED` header note in both files pointing at each other.
- [ ] **Step 2:** Sanity-check by running the local Supabase function (or `deno check`). 
- [ ] **Step 3: Commit** `git add supabase/functions/gcal-sync/index.ts && git commit -m "feat(gcal): mirror dual-calendar sync into the Deno function"`

---

### Task 5: db.ts — reads, action param, resolve/delete fns, auto-triggers

**Files:** Modify `src/lib/db.ts`

**Interfaces:**
- Produces: `EventPlanning.gcalEventIds: Record<string,string>`, `EventPlanning.gcalMatchPending: GcalMatch | null` where `GcalMatch = Record<string, { gcalEventId: string; summary: string; start: string; htmlLink: string } | null>`; `resolveGcalMatch(eventId, decision: "link" | "create"): Promise<void>`; `deleteEventFromGoogleCalendar(eventId): Promise<void>`; `syncEventToGoogleCalendar(eventId, action?)`.

- [ ] **Step 1:** Extend `syncEventToGoogleCalendar` to accept `action?: "auto"|"link"|"create"|"delete"` (default omitted) and pass it + `appOrigin: location.origin` in the invoke body. Return the parsed `{ status, candidates?, htmlLink? }`.
- [ ] **Step 2:** Add `resolveGcalMatch(eventId, decision)` → `supabase.functions.invoke('gcal-sync', { body: { eventId, action: decision } })`. Add `deleteEventFromGoogleCalendar(eventId)` → invoke with `action:"delete"`.
- [ ] **Step 3:** In `getEventPlanning`, add `gcal_event_ids, gcal_match_pending` to the select and map `gcalEventIds` / `gcalMatchPending` onto `EventPlanning`.
- [ ] **Step 4: Auto-triggers (fire-and-forget, swallow errors).** Add a private `autoSyncGcal(eventId)` = `syncEventToGoogleCalendar(eventId).catch((e) => console.warn('gcal auto-sync', e))`. Call it after: event create with a date, `setEventDate`, and calendar-relevant detail updates (name/location/time/description). On event delete, call `deleteEventFromGoogleCalendar(eventId)` (awaited before the row delete, or fire-and-forget after — pick one; document it). Only fire when the event is eligible (dated, non-template) — reuse a small local `dated && !template` check on the known fields.
- [ ] **Step 5: Typecheck** (`npx tsc --noEmit -p tsconfig.json`) — clean.
- [ ] **Step 6: Commit** `git add src/lib/db.ts && git commit -m "feat(gcal): db reads, action param, resolve/delete, auto-triggers"`

---

### Task 6: Event-page UI — match prompt + calendar link

**Files:** Modify `src/components/EventPlanningPage.tsx`

- [ ] **Step 1:** When `plan.gcalMatchPending` has any non-null candidate, render a confirmation card near the top of the Overview/setup: *"Found a matching calendar event 'X' on <date> — link to it, or create a new one?"* showing candidate summary(ies). Two buttons: **Link** → `resolveGcalMatch(eventId,"link")`; **Create new** → `resolveGcalMatch(eventId,"create")`. On success, clear locally / reload the plan.
- [ ] **Step 2:** Show a "View on Google Calendar" link built from `plan.gcalHtmlLink` when present (reverse-direction link). Keep the existing `GCalSync` button as a manual "re-sync now".
- [ ] **Step 3: Typecheck** — clean.
- [ ] **Step 4: Commit** `git add src/components/EventPlanningPage.tsx && git commit -m "feat(gcal): match-confirmation prompt + calendar link on the event page"`

---

### Task 7: Backfill script

**Files:** Create `scripts/gcal-backfill.mjs`

- [ ] **Step 1:** A Node script that reads all dated, non-template events (via the prod PostgREST or cloud-sql-proxy) and POSTs `{ eventId }` (action `auto`) to the deployed `/gcal-sync` for each. Idempotent (re-run patches). Prints a summary: created / updated / pending-match / skipped / failed. Reads config from `.env` (base URL + auth). Log any events left pending a match (they surface in-app).
- [ ] **Step 2: Commit** `git add scripts/gcal-backfill.mjs && git commit -m "chore(gcal): one-time backfill script"`

---

## Manual / controller steps (post-merge, one-time)

- Set `GCAL_COORDINATION_CALENDAR_ID` in the cloud function's prod env/secrets (or accept the default).
- **Deploy** the cloud function (prod runs `cloud-functions`; not auto-deployed).
- Run `scripts/gcal-backfill.mjs` once; resolve any in-app match prompts.
- Google cleanup: delete the two duplicate "EventHub Events" secondary calendars + the stray `run.app` calendarList subscription; drop the unused `app_setting.gcal_calendar_id` row.

## Self-Review

**Spec coverage:** dual-calendar write → Tasks 3/4; migration/columns → Task 1; helpers+tests → Task 2; match-adopt gate → Task 3 (+ Deno mirror 4); actions → Task 3; db reads/triggers → Task 5; match prompt + links → Task 6; backfill → Task 7; cleanup/deploy → Manual steps. ✓
**Placeholders:** none — helper code and control flow are concrete; REST wrappers specified by signature + behavior.
**Type consistency:** `gcal_event_ids`/`gcalEventIds`, `gcal_match_pending`/`gcalMatchPending`, action union, and `Span` shape are consistent across tasks.
**Deploy parity:** dual-maintained function (3/4), migration to both DBs (1), cloud-function deploy + secret + backfill are called out as manual.
