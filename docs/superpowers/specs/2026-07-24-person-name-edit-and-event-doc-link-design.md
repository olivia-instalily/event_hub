# Person name editing + single Doc/Drive link in the event header

Date: 2026-07-24

Two small, independent features:

1. Let a user edit a person's name (some internal attendees have their name set to
   their email address because it was never set properly).
2. Add one prominent Google Doc/Drive link in the event page header, mirroring the
   folder link the series dashboard already has — distinct from the existing
   Resources list.

---

## Feature 1 — Edit a person's name

### Problem

`attendee.name` is nullable and, for some internal people, holds their email address.
The name is rendered read-only everywhere (`PeoplePage` cards, table, and the
PersonDetail slide-over). There is no way to correct it.

### Change

- **DB helper:** Extend `updateAttendee()` (`src/lib/db.ts:1298`) to accept an
  optional `name?: string`. No migration is required — `attendee.name` already
  exists and is granted.
- **UI:** In the PersonDetail slide-over header (`src/pages/PeoplePage.tsx`, name
  rendered at line ~233), make the name click-to-edit using the existing
  `EditableTitle` component (`src/components/EditableTitle.tsx`) — the same pattern
  used for event titles. Enter or blur commits; Escape cancels.
- **Commit flow:** On commit, trim the value and call
  `updateAttendee({ ..., name })`, then refresh the person view so all surfaces
  (cards, table, detail header) reflect the new name.
- **Guard:** A trimmed-empty value is a no-op — do not overwrite the stored name
  with a blank string. No other validation (the goal is fixing email-as-name).

### Scope

- Editing happens only in the PersonDetail slide-over. Cards and table remain
  read-only (they already read `p.name`, so they update after refresh).

### Deploy parity

Pure app code (client-side PostgREST write via `updateAttendee`). No cloud-function
twin writes attendees. **Auto-deploys with the Cloud Run app — no manual step.**

---

## Feature 2 — Single Doc/Drive link in the event header

### Problem

The event already has a Resources area (`event.reference_links`, a JSONB *list*).
The user wants a single, prominent Doc/Drive link in the event header — the same
affordance the series dashboard has for its folder — separate from that list.

### Reference: how the series does it

`SeriesDashboard.tsx` (lines ~36–84) stores `Campaign.folderUrl` (in the
`event_series.extras.campaign` JSONB) and renders a three-state control:

- **Empty:** dashed "Add folder" button with a Folder icon.
- **Filled:** button showing Folder icon + label + external-link icon, plus an
  "edit" affordance.
- **Editing:** URL input + Save / Cancel, with an X to clear.

### Change

- **Migration (new):** add `event.doc_link TEXT` (nullable) with SELECT/UPDATE
  grants to the `authenticated` role, mirroring the series `folderUrl`. Follows the
  existing migration + grant pattern (e.g. `20260721000000_event_reference_links.sql`).
- **DB helpers:**
  - Add `docLink: string | null` to the `EventPlanning` interface and populate it
    in `getEventPlanning()` (`src/lib/db.ts`).
  - Add a write path: `setEventDocLink(eventId, url | null)` (or extend
    `updateEvent`), writing to `event.doc_link`.
- **Shared component:** Extract the series folder-link three-state control into a
  reusable `DocLinkControl` component (props: current url, onSave(url|null), label,
  icon). Use it in both the event header and the series dashboard so they stay
  consistent. Validation: the URL must start with `http`.
- **Placement:** the event header control row in `EventPlanningPage.tsx` (~line
  4405), alongside the existing Luma / series attach controls.
- **Label:** "Doc" with a file/link icon (the series one keeps "Folder").
- **Resources area:** unchanged. The header link is a single, separate value; it is
  not derived from or written into `reference_links`.

### Scope

- Exactly one link per event. Not a list. No file picker / Drive API — it is a
  pasted URL, exactly like the series folder link.

### Deploy parity

App code auto-deploys with Cloud Run, but the **new `event.doc_link` column and its
grant must be applied to the live Cloud SQL database as a manual migration step.**
This is the only non-UI change and must be flagged in the implementation plan.

---

## Testing

- **Feature 1:** unit-test that `updateAttendee` includes `name` when provided and
  omits it when undefined; a trimmed-empty name is not persisted.
- **Feature 2:** unit-test `getEventPlanning` maps `doc_link` → `docLink`;
  `setEventDocLink` writes the column and clears it on null; `DocLinkControl`
  rejects a non-`http` URL.

## Out of scope

- Editing person name inline in cards/table.
- Multiple header links, Drive file picker, or link previews/metadata.
