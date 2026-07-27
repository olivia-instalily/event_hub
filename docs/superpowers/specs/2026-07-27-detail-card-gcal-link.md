# "View in Google Calendar" link on event detail cards

**Date:** 2026-07-27
**Status:** Approved

## Problem

The Events-page event card already turns its date-pill calendar icon into a "View in
Google Calendar" link when the event is synced (`gcalEventId && gcalHtmlLink`). But the
**detail popups** shown when you click an event on the Calendar page (and external events
on the Events page) render a plain, non-clickable calendar icon + date range — no way to
jump to the Google Calendar instance. This affects:

- `ExternalDetail` — the external-conference detail card (`src/components/externalEvents.tsx`)
- `InternalEventPeek` — the internal-event peek popup (`src/components/CalendarPage.tsx`)

## Goal

Give both detail cards the same "View in Google Calendar" affordance the Events-page card
already has, so external and internal detail cards behave identically.

## Design

In each component's date row, when `item.gcalEventId && item.gcalHtmlLink`, wrap the
calendar icon in an anchor:

```tsx
<a href={item.gcalHtmlLink!} target="_blank" rel="noreferrer" title="View in Google Calendar" className="inline-flex shrink-0">
  <CalendarDays className="w-4 h-4 text-emerald-600 hover:text-emerald-700" />
</a>
```

When not synced, keep the current plain gray icon (`text-gray-400`). The date-range text
is unchanged. This mirrors the existing internal card pattern in `EventsPage.tsx`
(emerald icon, `title="View in Google Calendar"`, new tab).

## Constraints & non-goals

- Pure UI. No backend, no new data — `EventListItem` already carries `gcalEventId` /
  `gcalHtmlLink` for both internal and external events (all 7 prod external events have both).
- Ships with the normal frontend build (no cloud-function/migration/deploy-parity concern).
- Destination is Google Calendar (per decision), NOT the in-app Calendar page.
- No change to the Events-page card (already has the link).

## Verification

- `npx tsc -b` clean; `npm run build` succeeds.
- Visual: open an external event's detail card and an internal event's peek on the
  Calendar page → emerald calendar icon links to the Google Calendar event in a new tab;
  an unsynced event shows the plain gray icon.
