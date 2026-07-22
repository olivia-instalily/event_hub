# Google Calendar auto-sync (dual calendar) — Design

**Date:** 2026-07-22
**Status:** Approved (design), pending implementation plan

## Goal

Every dated EventHub event automatically appears on **`calendar@instalily.ai`** (the primary
calendar most people at Instalily already keep in their Google Calendar sidebar) so that people who
don't actively seek out events still see them — passive discovery, zero action required from viewers.
Each event is **also** written to the **Instalily Events Coordination** calendar (the events team's
dedicated calendar). Both copies stay in sync on edit and are removed on delete.

## Background — current state (verified live 2026-07-22)

- The app has a **manual, per-event** Google Calendar button (`GCalSync` component →
  `syncEventToGoogleCalendar` in `db.ts` → `supabase.functions.invoke('gcal-sync')` → the
  `/gcal-sync` cloud function). It writes to an unused secondary calendar named "EventHub Events".
- It is effectively **unused**: 0 of 49 events in prod have a `gcal_event_id`; the target calendar
  holds a single orphan event that matches no DB record. Nothing to "fix" — we replace the trigger
  and the target.
- **Auth:** the sync authenticates as `calendar@instalily.ai` via `GCAL_REFRESH_TOKEN` +
  `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` (OAuth refresh-token flow already in the function).
- **Calendars (write access confirmed for the sync account):**
  - Primary: `calendar@instalily.ai` (owner) — API id `primary`.
  - Coordination: `c_fad28a2710da5efc5126158eae561ee3107d4afc395bbc595f051f0117a1d0fd@group.calendar.google.com`
    ("Instalily Events Coordination", **writer** access).
- **Syncable set today:** 45 dated events (40 internal + 5 external). `event` has columns
  `event_date`, `start_time`, `end_time`, `is_template`, `is_external`, `lightweight`,
  `gcal_event_id`, `gcal_html_link`.
- **Cruft to remove:** two duplicate "EventHub Events" secondary calendars
  (`c_ca1fb3df…`, `c_d7690704…`) and a stray calendarList subscription named after the app's
  `run.app` URL.

### Why not the "invite calendar as a guest" approach

Tested live: creating the event on the primary and adding the coordination calendar as an **attendee**
leaves the invite in `needsAction` and it **never appears** on the coordination calendar (that
calendar does not auto-accept invitations, and we only have writer — not owner — access, so we can't
change that). The reverse (own on coordination, invite primary) would show on the primary as a
*pending invite* with RSVP styling — wrong look for passive visibility. Direct write to each calendar
was tested and works cleanly (create + delete), so **dual-write is the chosen approach**.

## Design

### What syncs

An event is pushed when **all** of these hold:
- `event_date` is set (dated), AND
- `is_template = false` (templates never sync).

Both internal (`is_external=false`) and external (`is_external=true`) dated events sync. When an event
that previously synced becomes ineligible (date cleared, or deleted), its calendar copies are removed.

### Target calendars

Write the same event to **both**:
1. `primary` (`calendar@instalily.ai`)
2. the coordination calendar id (above)

Calendar ids are configuration, not hardcoded magic strings buried in logic: the primary is `primary`;
the coordination id comes from an env var (e.g. `GCAL_COORDINATION_CALENDAR_ID`) with the known id as
the default, so it can be changed without a code edit. The old auto-create-"EventHub Events"-secondary
behavior is removed.

### Data model — tracking two copies

One EventHub event now has a Google event id **per calendar**. Add:

```sql
ALTER TABLE event ADD COLUMN IF NOT EXISTS gcal_event_ids jsonb NOT NULL DEFAULT '{}'::jsonb;
GRANT UPDATE (gcal_event_ids) ON event TO anon, authenticated;
```

`gcal_event_ids` maps `calendarId → googleEventId`, e.g.
`{"primary":"abc123","c_fad28…@group.calendar.google.com":"def456"}`.

- Keep the existing `gcal_html_link` column, now pointing at the **primary** copy's `htmlLink` (used
  for the app's "view on calendar" deep link).
- Keep the legacy `gcal_event_id` column populated with the **primary** copy's id for backward
  compatibility with existing UI reads (`plan.gcalEventId`), so the "synced" state still renders.

### Sync operation (per event)

For each target calendar:
- If `gcal_event_ids[calId]` exists → **PATCH** that event (update in place).
- Else → **POST** a new event, then store the returned id into `gcal_event_ids[calId]`.

Event body (unchanged from today, plus color): `summary` = event name; `location`; `description`
combining the event description + Luma link + an EventHub deep link; `start`/`end` as timed
(`dateTime` + tz) when `start_time` is present, else all-day (`date`). Add a fixed `colorId` so
EventHub events read as a set within each calendar.

Write-back to the DB after a successful sync: update `gcal_event_ids`, `gcal_event_id` (primary),
`gcal_html_link` (primary).

### Delete / un-sync

When an event is deleted, or becomes ineligible (date cleared), issue a **DELETE** for each stored
`gcal_event_ids[calId]` on its calendar, then clear `gcal_event_ids`, `gcal_event_id`,
`gcal_html_link`. A `404`/`410` from Google (already gone) is treated as success (idempotent).

The `/gcal-sync` cloud function gains an `action` discriminator in its body: `{ eventId }` (default
= upsert) vs `{ eventId, action: "delete" }`.

### Trigger — automatic

Retire manual-only behavior. The frontend fires the sync (fire-and-forget, non-blocking, errors
swallowed to a console warn — never block the user's save) from the event mutation paths in `db.ts`:
- after an event is **created** with a date (internal create + external-conference create),
- after an event's **date** is set/changed,
- after **calendar-relevant details** change (name, location, start/end time, description).
- On **delete**, call the delete action.

Only fire when the event is eligible (dated, non-template). The existing manual `GCalSync` button is
kept as an explicit "re-sync now" affordance (harmless — it calls the same upsert), but is no longer
the only path.

### Backfill

A one-time script (`scripts/gcal-backfill.mjs`, run manually) iterates all dated, non-template events
and performs the upsert against both calendars, writing ids back. Idempotent — safe to re-run (it
PATCHes anything already synced). Logs a summary (pushed / updated / skipped / failed).

### Cleanup (manual/controller, one-time)

Delete via the Calendar API (owner access): the two duplicate "EventHub Events" secondary calendars
and the stray `run.app` calendarList subscription. Remove the now-unused
`app_setting.gcal_calendar_id` row.

## Known trade-offs (accepted)

1. **Two copies, not a live-shared single event.** Google can't mirror one event onto two calendars
   here; each event is written twice and kept in sync together. Functionally equivalent to sharing.
2. **Double appearance for anyone following *both* calendars.** A person subscribed to both the
   primary and the coordination calendar sees each event twice. Most people watch only the primary, so
   this affects the events team only. Accepted.
3. **No per-group toggle.** Because events live on the primary calendar (which people already watch),
   they can't be toggled off as a group there. Accepted — passive visibility was the priority, and no
   Workspace admin access exists to push a separate toggleable calendar org-wide.

## Non-goals

- Two-way sync (Google → EventHub). Push-only.
- Importing external events from Google into EventHub.
- iCal/.ics feed or CalDAV.
- Per-drive / per-series calendars (possible later; out of scope now).
- Any Workspace-admin org-wide calendar push.

## Deploy / parity notes

- The sync function is **dual-maintained**: `cloud-functions/src/functions/gcal-sync.ts` (what prod
  runs, mounted at `/gcal-sync` in `cloud-functions/src/index.ts`) **and**
  `supabase/functions/gcal-sync/index.ts` (local). Changes must land in both.
- The `gcal_event_ids` **migration** must be applied to **both** prod (Cloud SQL) and the local
  Supabase DB, with a PostgREST schema reload (`NOTIFY pgrst, 'reload schema'`) each.
- `GCAL_COORDINATION_CALENDAR_ID` must be present in the cloud function's environment/secrets (prod),
  defaulting to the known id if unset.
- Backfill + Google-calendar cleanup are **manual** steps run once after deploy.

## Testing

- **Unit:** the eligibility predicate (dated && !template) and the upsert-vs-patch body builder are
  pure and unit-tested (vitest), following the existing `campaign.test.ts` style.
- **Live smoke (manual, throwaway event):** create → verify it appears on both calendars → edit →
  verify both update → delete → verify both removed. (The create/delete round-trip was already
  validated live against both calendars during design.)
