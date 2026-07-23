# "I'm attending" external-event flow — design

**Date:** 2026-07-22
**Status:** Approved for planning

## Problem

In the create-event flow's "How are you running this event?" chooser, the **"I'm attending"** card is
a disabled "Coming soon" placeholder. We want to build it out: a way to log an external event that a
third party runs and we attend (e.g. an industry conference or a private-equity event), captured with
a type so we can filter and color it.

The data layer and a form already exist — `addExternalConference` creates a minimal `is_external`
event row, and `ExternalConferenceForm` is a working modal (reachable today only from the Calendar
page's "+" button). This work wires that into the create flow, adds a type, and surfaces the type in
the calendar filter.

## Scope

Frontend + `tags.ts` only. **No DB migration** — reuses the existing `event.tag` and `event.is_external`
columns. Everything auto-deploys on push to `main`.

Out of scope (parked as a separate spec): the Google Calendar link/delink title-card control.

## Design

### 1. Taxonomy — new "External" tag group (`src/lib/tags.ts`)

Add a fourth category to `TAG_CATEGORIES`:

```
External → ["Ext. Industry", "Ext. PE"]
```

- Pin the "External" category to **purple**: `PRESET` index → purple (1), `BADGE_PRESET` → `'purple'`
  (matches the calendar's existing purple identity for external events).
- **Move "Internal" off purple** so purple reads as "external" only:
  - `PRESET` (Tailwind palette): Internal → **rose** (index 6).
  - `BADGE_PRESET` (fixed variant set — no rose exists): Internal → **`'red'`** (closest available;
    distinct from purple/green/yellow already in use). Confirm the exact badge variant during
    implementation if `'red'` reads wrong next to the others.
- `EVENT_TAGS` picks up the two new tags automatically (derived from `TAG_CATEGORIES`).

"Ext. Industry" / "Ext. PE" become first-class tags: colored chips, filterable, everywhere tags
already render.

### 2. Create-event chooser — enable "I'm attending" (`src/components/EventsPage.tsx`, `src/App.tsx`)

- Un-disable the "I'm attending" card. New copy:
  > "A third party runs it; we attend an external event — e.g. an industry conference or a PE event."
- Selecting it + **Continue** opens the external-event modal directly. **No PE/Industry pre-step** —
  the type is chosen inside the modal.
- Handoff avoids modal-in-modal: the create modal signals App (via a callback / App-level state) to
  close the create modal and open `ExternalConferenceForm`. App already owns sibling modals
  (`createOpen`, `pastChooserFiles`, `backfill`), so this follows the existing pattern.

### 3. External-event modal — type selector (`src/components/ExternalConferenceForm.tsx`)

- Add a **Type** row at the top: two pills, **Industry** / **PE**, one required (default none;
  save is blocked until picked, like the existing name/date validation).
- Selecting a type maps to the tag value `"Ext. Industry"` or `"Ext. PE"`.
- The rest of the form is unchanged (Name, Why relevant, Start/End dates, Quarter, Location, Info URL,
  attendee tagging).
- This one modal is used by **both** entry points — the Calendar "+" button and the create-flow
  "I'm attending" card. Single source of truth.

### 4. Persist the tag (`src/lib/db.ts`)

- Add `tag: string` to `ExternalConferenceInput`.
- In `addExternalConference`, write it to `event.tag` (alongside the existing `is_external: true`,
  `lightweight: true`). No schema change — `tag` already exists.

### 5. Calendar filter — reveal sub-types (`src/components/CalendarPage.tsx`)

- Keep the purple **External** toggle and the purple **+** button exactly as they are.
- Add sub-state for which external types are shown (a set of `{"Ext. Industry", "Ext. PE"}`), default
  **both on**.
- When **External is on**, render **Industry** / **PE** sub-toggles expanding to the right. Toggling
  one off isolates the other. When External is off, hide external events and collapse the sub-toggles.
- Filtering: an external event shows when `showExternal` **and** its tag is in the selected sub-set.
  **Legacy externals with no `Ext.*` tag show whenever External is on** (never silently dropped).
- Sub-toggle labels are the short **"Industry" / "PE"** (already nested under the purple *External*,
  so the "Ext." prefix would be noise); the stored tag remains the full `"Ext. Industry"` / `"Ext. PE"`.

## Data flow

1. User picks "I'm attending" → external modal opens.
2. User picks type (Industry/PE) + fills fields → `addExternalConference({ ..., tag })`.
3. One `is_external` event row is written with `tag = "Ext. Industry" | "Ext. PE"`.
4. Both the Calendar (`listExternalConferences`) and the Events page (already loads
   `listExternalConferences`) read that row — the event appears in both automatically, purple, with the
   right type. Edit/delete reflect in both (one row).

## Error handling

- Type required: save blocked with an inline message (mirrors existing name/date validation).
- `addExternalConference` errors surface inline in the modal (existing `err` state).
- Attendee-link failures are already swallowed per-attendee (one bad row doesn't fail the create).

## Testing

- `tags.ts`: unit-test that "External" resolves to purple, "Internal" no longer purple, and
  `EVENT_TAGS` includes both new tags.
- Manual: create via "I'm attending" → verify one purple row appears on both Calendar and Events;
  verify the calendar Industry/PE sub-toggles isolate correctly; verify a legacy untyped external
  still shows.

## Open items

None blocking. Exact rose hue for Internal is a one-line palette index and easily adjusted.
