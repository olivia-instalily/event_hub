# Multi-day events as spanning bars on the month calendar

**Date:** 2026-07-27
**Status:** Approved (design)

## Problem

On the month grid (`CalendarView` in `src/components/EventsPage.tsx`, shared by the Events
page and `CalendarPage`), events are bucketed by **start date only** (`byDay` keyed on
`e.date`). A multi-day event (`endDate` after `date`) shows only on its first day — you
can't see that it spans several days.

## Goal

Render a multi-day event as a **continuous horizontal bar** across every day it covers,
breaking cleanly at week boundaries, with overlapping events stacked into lanes. Keep the
resting view compact via a focus-plus-context hover interaction.

## Interaction

- **Resting:** each event is a **slim bar** (line-like) in its lane, spanning its days,
  with the title riding on the bar starting at its first day. Slim lanes let many events
  stack without growing the grid.
- **Hover an event:** that event's bar **expands** to a full, clearly-labeled bar across
  its whole span; the **other bars minimize** (shrink toward hairlines and fade) to reduce
  clutter and give the focused event room. Lane *slots* don't change on hover — only each
  lane's height/opacity — so bars never jump position.
- **Mouse-out:** everything returns to the compact resting state.

Exact bar heights, opacity, and transition timing are **tuned live** after the first build
(per decision), not fixed in this spec.

## Architecture

### 1. Pure layout function (new, isolated, unit-tested)

`src/lib/calendarLayout.ts`:

```ts
export interface BarSegment {
  event: EventListItem;
  weekIndex: number;   // 0..5 (which week row)
  startCol: number;    // 0..6 (Sun..Sat) within that week
  span: number;        // 1..7 columns
  isStart: boolean;    // this segment contains the event's real start day
  isEnd: boolean;      // this segment contains the event's real end day
  lane: number;        // vertical slot within the week row
}
export interface WeekRow { weekIndex: number; segments: BarSegment[]; laneCount: number; }
export function layoutMonth(events: EventListItem[], year: number, month: number): WeekRow[];
```

Behavior:
- Grid = 6 weeks (42 cells) starting on the Sunday on/before the 1st (matches current cell math).
- Each dated, non-template event has span `[date, endDate ?? date]`, **clipped** to the
  month's visible range. `isStart`/`isEnd` reflect whether the true start/end fall inside
  the clip (a clipped edge renders flat = "continues off-screen").
- Split the clipped span into one **segment per intersected week row**.
- **Lane assignment per week:** sort a week's segments (by `startCol`, then longer span
  first), greedily assign each to the lowest lane whose columns are free. `laneCount` =
  max lane + 1.
- Single-day events are just `span:1` segments and participate in the same lane system.

### 2. Rendering (`CalendarView`)

- Replace the flat 42-cell grid with **6 week rows**. Each week row is `position:relative`
  and contains:
  - a **background** `grid-cols-7` of day cells (date number, today ring) — unchanged look;
  - a **bar overlay** `grid-cols-7` where each segment is placed with
    `gridColumn: <startCol+1> / span <span>` and vertical offset by `lane`.
- Bar color by category via existing `dotColor` logic (external purple, past gray,
  in-process amber, future blue).
- Rounded **left** only when `isStart`, rounded **right** only when `isEnd`.
- Title shown starting at each segment's first column.
- Hover/click preserved: clicking a bar calls `onOpen(e.id)`; the existing hover preview
  card still appears.

### 3. Hover state

- `CalendarView` holds `hoveredId: string | null`.
- Per bar: `hoveredId === e.id` → expanded; `hoveredId && hoveredId !== e.id` → minimized;
  else resting. Implemented with Tailwind height/opacity classes + `transition`.

## Constraints & non-goals

- Pure UI + client layout. No backend/schema change — `date` and `endDate` already exist
  on `EventListItem`. Ships with the normal frontend build.
- Undated events keep the existing "No date" footer list.
- No "+N more" truncation — the hover focus model replaces the need to cap lanes.
- Applies everywhere `CalendarView` is used (Events page + Calendar page) automatically.

## Testing

- Vitest on `layoutMonth` (pure): single-day segment; two-day adjacent overlap → 2 lanes;
  Wed→next-Tue → two segments (week split); event starting in prior month → first segment
  `isStart:false`, flat left; event ending after month → last segment `isEnd:false`;
  non-overlapping same-week events share lane 0.
- Hover feel verified live in the running app.

## Verification

- `npx tsc -b` clean; `npm run build` succeeds; `npx vitest run tests/calendarLayout.test.ts` green.
- Live: a multi-day event renders as one bar across its days, wraps across week rows,
  stacks with overlaps; hovering expands it and minimizes the rest.
