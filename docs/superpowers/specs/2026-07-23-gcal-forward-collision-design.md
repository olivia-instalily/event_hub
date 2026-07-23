# Trustworthy forward Google Calendar sync — collision handling

**Date:** 2026-07-23
**Status:** Approved design, pending implementation plan

## Problem

After the one-time backfill (`scripts/backfill-gcal.mjs`, 47 events), the goal is to *trust* that every future EventHub event lands on Google Calendar without manual work. One hole remains.

Every create/date path calls `autoSyncGcal` (fire-and-forget) → `syncEventToGoogleCalendar` with `action: "auto"`. In the `gcal-sync` edge function, `auto`:

- if it finds **no** candidate on the window → creates on both calendars (works, green).
- if it finds **any** candidate (`findCandidate` = time overlap + `nameSimilar` + not already EventHub-owned) → stores `gcal_match_pending`, returns `status: "needs_confirmation"`, and **writes nothing**.

Nothing consumes `needs_confirmation`:
- `autoSyncGcal` ignores the resolved value → the event **silently never syncs**.
- `GCalSync.add()` sets `done = true` regardless → **falsely shows "synced"**.
- No component references `resolveGcalMatch` / `gcal_match_pending` → **no way to resolve** a pending match.

Post-backfill this only bites a future event that collides with a **non-EventHub** manual entry (owned events are skipped via `isOwned`), but it's a real gap in "trust future events," and the false-synced UI is a correctness bug.

## Desired behavior

When a newly-created EventHub event is auto-synced and collides with an existing unowned calendar entry:

| Situation (per calendar) | Action |
|---|---|
| No candidate | Create the event (unchanged) |
| **Confident** match | **Auto-adopt** — patch the existing event to EventHub's canonical title/color + `EventHub:` marker (today's `link` logic, run without a prompt). Mark synced. |
| **Ambiguous** match | Write nothing. Store `gcal_match_pending` with a per-candidate **reason**. Surface a review prompt. |

"Confident" reuses the backfill rule (already unit-tested in `tests/backfill-gcal.test.ts`): exactly one name-similar, unowned candidate with **full token containment** of the title AND **same calendar date** AND (for timed events) time overlap. Everything else is ambiguous: 2+ candidates, loose/Jaccard-only title, or a date off by a day.

Whole-event rule: if **every** calendar resolves to create/confident, the event syncs automatically (green, no prompt). If **any** calendar is ambiguous, the **entire event is held** (nothing written) and surfaced for review — the conservative, consistent choice.

## Architecture

### 1. Edge function `gcal-sync` (DUAL-MAINTAINED)

Both copies change identically:
- `supabase/functions/gcal-sync/index.ts`
- `cloud-functions/src/functions/gcal-sync.ts`

Changes, all inside the `action: "auto"` branch (the `link`, `create`, `delete` actions are unchanged):

1. Replace the single-candidate `findCandidate` scan with a **classifier** that gathers all window candidates per calendar and returns one of `{ kind: "create" } | { kind: "confident", candidate } | { kind: "ambiguous", candidates, reason }`. `reason` is a short human string: `"2 possible matches"`, `"title only loosely matches \"<summary>\""`, or `"\"<summary>\" is on <date>, a day off"`. Helper functions (`nameSimilar`, spans, `isOwned`, plus a new `nameContained`) already exist / are ported verbatim to keep parity with the backfill classifier.
2. Compute the per-calendar verdicts.
   - If any is `ambiguous`: store `gcal_match_pending` = `{ [calId]: { candidate…, reason } | null }` and return `{ status: "needs_confirmation", candidates }` (enriched with `reason`). Write no calendar events.
   - Else: for each calendar, adopt confident candidates (existing patch-to-canonical path) and create where none, then write back `gcal_event_ids` and clear `gcal_match_pending`. Return `{ status: "synced", … }`.

`gcal_match_pending` column already exists — **no migration**.

### 2. `src/lib/db.ts`

- `syncEventToGoogleCalendar` already returns `status`/`candidates` — no change needed beyond types (surface `reason`).
- `resolveGcalMatch(eventId, 'link' | 'create')` already exists — no change.
- `getEventPlanning` **already** selects `gcal_match_pending` and hydrates it to `plan.gcalMatchPending` (`db.ts:2719`, `db.ts:2834`) — no plumbing needed there. Add an optional `reason` field to the `gcalMatchPending` candidate type (`db.ts:2627`).

### 3. Frontend — third "needs review" state

Driven by `plan.gcalMatchPending` being non-null while `gcalEventId` is null.

- **`GcalLinkControl`** (event title card) gains a `matchPending` prop and a third render branch:
  - **red** `Calendar` icon (vs emerald synced / gray unsynced),
  - a short reason line from the pending candidates,
  - two buttons: **Link** → `resolveGcalMatch(eventId, 'link')`; **Create new** → `resolveGcalMatch(eventId, 'create')`; both call `onChange()` to refetch.
- **`GCalSync`** (setup/action card): `add()` inspects the response — on `needs_confirmation` it does **not** set `done`; it shows the same review affordance (red state + Link / Create new). Fixes the false-synced bug.
- Thread `matchPending` from `EventPlanningPage` (and `EventSetup` where `GCalSync` is mounted) into the components.

## Data flow

```
create/date change → autoSyncGcal → gcal-sync(auto)
  ├─ all create/confident → adopt+create, write ids, clear pending → status:"synced" → green
  └─ any ambiguous → store gcal_match_pending(+reason), write nothing → status:"needs_confirmation"
        → UI (GcalLinkControl / GCalSync) shows RED icon + reason + [Link] [Create new]
             ├─ Link   → resolveGcalMatch('link')   → adopt candidates + create where none → synced
             └─ Create → resolveGcalMatch('create') → force create on both → synced
```

## Error handling

- `autoSyncGcal` stays fire-and-forget; a `needs_confirmation` result is a normal (non-error) outcome that leaves the pending state for the UI to resolve. No throw.
- The existing `allSettled` partial-failure handling in `link`/`create` is retained.
- If `resolveGcalMatch` fails, the component surfaces the error inline (existing `err` pattern) and stays in review state.

## Testing

- Confident/ambiguous classification is already covered by `tests/backfill-gcal.test.ts`. Extract the confident predicate into a shared, importable pure helper if practical so the edge-function port is tested directly; otherwise keep the port byte-faithful to the tested logic and add a table-driven test for the new `auto` verdict mapping (create / confident / ambiguous → action).
- Manual verification: create a local event that matches a seeded unowned local-calendar entry → confirm red state + reason + both resolve paths.

## Deploy parity (per user rule)

- **`gcal-sync` is dual-maintained** — change both files identically. **Needs a redeploy** of the cloud function to reach prod.
- UI + `db.ts` changes ride the normal app build/deploy.
- No secrets, no migrations, no GCS.

## Out of scope

- Bulk/backfill (already done).
- Changing the confident-collision semantics to soft-link (user chose: adopt when confident).
- A dedicated "pending matches" inbox/dashboard — the per-event red icon is the only surface for now.
