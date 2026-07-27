# Multi-day Calendar Spanning Bars Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render multi-day events as continuous, week-wrapping horizontal bars on the month calendar, with overlapping events stacked into lanes and a hover focus-plus-context interaction (expand the hovered event, minimize the rest).

**Architecture:** A pure, unit-tested `layoutMonth()` turns events into per-week, lane-assigned bar segments. `CalendarView` (in `EventsPage.tsx`, shared by the Events page and `CalendarPage`) renders 6 week-rows: a background grid of day cells plus a bar overlay positioned by CSS grid columns. Hover state lives in `CalendarView` and only changes each bar's height/opacity, never its lane slot.

**Tech Stack:** TypeScript, React 18, Vite, Tailwind, vitest.

## Global Constraints

- Pure UI + client-side layout. **No backend/schema change** — `date` and `endDate` already exist on `EventListItem`. Ships with the normal frontend build (auto-deploys on push to `main`).
- `layoutMonth`'s `month` argument is **0-indexed** (JS `Date` convention), matching `CalendarView`'s existing `cursor.m`.
- ISO dates are `'YYYY-MM-DD'`; parse as `new Date(iso + "T12:00:00")` to dodge timezone drift (matches the existing pattern in `CalendarPage.tsx` / `EventsPage.tsx`).
- Bar color by category reuses the existing rule: external → purple, `effectiveStatus === "past"` → gray, `"in-process"` → amber, else → blue.
- Exact bar heights / opacity / transition timing are **tuned live** after Task 3 — the plan uses reasonable starting values.
- Undated & template events are excluded from the grid (templates have no date; undated keep the existing "No date" footer).

---

### Task 1: Pure `layoutMonth` layout engine + tests

Build the pure function that converts events into positioned, lane-assigned bar segments. No React.

**Files:**
- Create: `src/lib/calendarLayout.ts`
- Test: `tests/calendarLayout.test.ts`

**Interfaces:**
- Consumes: `EventListItem` from `../lib/db` (reads `id`, `date`, `endDate`, `isTemplate`).
- Produces:
  ```ts
  export interface BarSegment {
    event: EventListItem;
    weekIndex: number;   // 0-based week row
    startCol: number;    // 0..6 (Sun..Sat)
    span: number;        // 1..7
    isStart: boolean;    // segment contains the event's real start day
    isEnd: boolean;      // segment contains the event's real end day
    lane: number;        // vertical slot within the week row
  }
  export interface WeekRow { weekIndex: number; segments: BarSegment[]; laneCount: number; }
  export function layoutMonth(events: EventListItem[], year: number, month: number): WeekRow[];
  ```

- [ ] **Step 1: Write the failing tests**

Create `tests/calendarLayout.test.ts`:

```ts
import { describe, test, expect } from "vitest";
import { layoutMonth, type WeekRow } from "../src/lib/calendarLayout";
import type { EventListItem } from "../src/lib/db";

// Minimal EventListItem factory — layoutMonth only reads id/date/endDate/isTemplate.
function ev(id: string, date: string | null, endDate: string | null = null, isTemplate = false): EventListItem {
  return { id, date, endDate, isTemplate } as unknown as EventListItem;
}
// All segments across all weeks, for convenience.
const allSegs = (weeks: WeekRow[]) => weeks.flatMap((w) => w.segments);

// March 2026: March 1 is a Sunday (startCol 0), 31 days.
const Y = 2026, M = 2; // month is 0-indexed → 2 = March

describe("layoutMonth", () => {
  test("single-day event → one segment, span 1, isStart+isEnd, lane 0", () => {
    const segs = allSegs(layoutMonth([ev("a", "2026-03-04")], Y, M));
    expect(segs).toHaveLength(1);
    expect(segs[0]).toMatchObject({ span: 1, isStart: true, isEnd: true, lane: 0 });
    // March 4 (Wed) — March 1 is Sun, so col 3, week 0.
    expect(segs[0]).toMatchObject({ weekIndex: 0, startCol: 3 });
  });

  test("multi-day within one week → single segment spanning the range", () => {
    const segs = allSegs(layoutMonth([ev("a", "2026-03-02", "2026-03-05")], Y, M));
    expect(segs).toHaveLength(1);
    expect(segs[0]).toMatchObject({ weekIndex: 0, startCol: 1, span: 4, isStart: true, isEnd: true });
  });

  test("event crossing a week boundary → two segments, flat inner edges", () => {
    // Fri Mar 6 → Tue Mar 10: week 0 (Fri,Sat) + week 1 (Sun,Mon,Tue).
    const segs = allSegs(layoutMonth([ev("a", "2026-03-06", "2026-03-10")], Y, M));
    expect(segs).toHaveLength(2);
    const w0 = segs.find((s) => s.weekIndex === 0)!;
    const w1 = segs.find((s) => s.weekIndex === 1)!;
    expect(w0).toMatchObject({ startCol: 5, span: 2, isStart: true, isEnd: false });
    expect(w1).toMatchObject({ startCol: 0, span: 3, isStart: false, isEnd: true });
  });

  test("event starting in the previous month is clipped, first segment isStart=false", () => {
    const segs = allSegs(layoutMonth([ev("a", "2026-02-27", "2026-03-03")], Y, M));
    // Only March 1-3 visible: Sun-Tue of week 0.
    expect(segs).toHaveLength(1);
    expect(segs[0]).toMatchObject({ weekIndex: 0, startCol: 0, span: 3, isStart: false, isEnd: true });
  });

  test("event ending after the month is clipped, last segment isEnd=false", () => {
    const segs = allSegs(layoutMonth([ev("a", "2026-03-30", "2026-04-02")], Y, M));
    // March 30 (Mon) + 31 (Tue) visible in the last week.
    expect(segs).toHaveLength(1);
    expect(segs[0]).toMatchObject({ span: 2, isStart: true, isEnd: false });
  });

  test("non-overlapping same-week events share lane 0", () => {
    const segs = allSegs(layoutMonth([ev("a", "2026-03-02"), ev("b", "2026-03-05")], Y, M));
    expect(segs.every((s) => s.lane === 0)).toBe(true);
  });

  test("overlapping events stack into separate lanes", () => {
    const weeks = layoutMonth([ev("a", "2026-03-02", "2026-03-05"), ev("b", "2026-03-04", "2026-03-06")], Y, M);
    const lanes = weeks[0].segments.map((s) => s.lane).sort();
    expect(lanes).toEqual([0, 1]);
    expect(weeks[0].laneCount).toBe(2);
  });

  test("undated and template events are excluded", () => {
    const segs = allSegs(layoutMonth([ev("a", null), ev("b", "2026-03-04", null, true)], Y, M));
    expect(segs).toHaveLength(0);
  });

  test("events entirely outside the month are excluded", () => {
    const segs = allSegs(layoutMonth([ev("a", "2026-01-10", "2026-01-12")], Y, M));
    expect(segs).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/calendarLayout.test.ts`
Expected: FAIL — `layoutMonth` is not defined / module missing.

- [ ] **Step 3: Implement `layoutMonth`**

Create `src/lib/calendarLayout.ts`:

```ts
import type { EventListItem } from "./db";

export interface BarSegment {
  event: EventListItem;
  weekIndex: number;
  startCol: number;
  span: number;
  isStart: boolean;
  isEnd: boolean;
  lane: number;
}
export interface WeekRow { weekIndex: number; segments: BarSegment[]; laneCount: number; }

const parse = (iso: string) => new Date(iso + "T12:00:00");

// Convert events into per-week, lane-assigned bar segments for the given month.
// `month` is 0-indexed (JS Date convention).
export function layoutMonth(events: EventListItem[], year: number, month: number): WeekRow[] {
  const startDow = new Date(year, month, 1).getDay();        // 0=Sun
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const weekCount = Math.ceil((startDow + daysInMonth) / 7);
  const monthStart = new Date(year, month, 1, 12).getTime();
  const monthEnd = new Date(year, month, daysInMonth, 12).getTime();

  // 1. Build raw segments (no lanes yet).
  const raw: Omit<BarSegment, "lane">[] = [];
  for (const e of events) {
    if (!e.date || e.isTemplate) continue;
    const startT = parse(e.date).getTime();
    const endT = parse(e.endDate ?? e.date).getTime();
    if (endT < monthStart || startT > monthEnd) continue;       // entirely outside

    const realStart = startT >= monthStart;                     // real start visible?
    const realEnd = endT <= monthEnd;                           // real end visible?
    const clipStartDay = realStart ? new Date(startT).getDate() : 1;
    const clipEndDay = realEnd ? new Date(endT).getDate() : daysInMonth;

    const startCell = startDow + clipStartDay - 1;
    const endCell = startDow + clipEndDay - 1;
    for (let w = Math.floor(startCell / 7); w <= Math.floor(endCell / 7); w++) {
      const weekFirst = w * 7, weekLast = w * 7 + 6;
      const segFirst = Math.max(startCell, weekFirst);
      const segLast = Math.min(endCell, weekLast);
      raw.push({
        event: e,
        weekIndex: w,
        startCol: segFirst - weekFirst,
        span: segLast - segFirst + 1,
        isStart: segFirst === startCell && realStart,
        isEnd: segLast === endCell && realEnd,
      });
    }
  }

  // 2. Assign lanes per week (greedy: longest-first, lowest free lane).
  const weeks: WeekRow[] = [];
  for (let w = 0; w < weekCount; w++) {
    const segs = raw
      .filter((s) => s.weekIndex === w)
      .sort((a, b) => a.startCol - b.startCol || b.span - a.span);
    const laneEnds: number[] = []; // laneEnds[i] = last occupied col in lane i
    const placed: BarSegment[] = [];
    for (const s of segs) {
      let lane = 0;
      while (lane < laneEnds.length && laneEnds[lane] >= s.startCol) lane++;
      laneEnds[lane] = s.startCol + s.span - 1;
      placed.push({ ...s, lane });
    }
    weeks.push({ weekIndex: w, segments: placed, laneCount: laneEnds.length });
  }
  return weeks;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/calendarLayout.test.ts`
Expected: PASS — all tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/calendarLayout.ts tests/calendarLayout.test.ts
git commit -m "feat(calendar): pure layoutMonth engine for multi-day spanning bars"
```

---

### Task 2: Render week-rows with spanning bars (resting state)

Replace `CalendarView`'s flat-cell grid with 6 week-rows driven by `layoutMonth`. Resting state only — slim colored bars with the title at the start, rounded per `isStart`/`isEnd`. Click and hover-preview behavior preserved.

**Files:**
- Modify: `src/components/EventsPage.tsx` (`CalendarView`, roughly lines 500–590)

**Interfaces:**
- Consumes: `layoutMonth`, `BarSegment`, `WeekRow` from `../lib/calendarLayout` (Task 1); existing `effectiveStatus` (imported), `EventListItem`.
- Produces: unchanged `CalendarView` props/signature — internal rewrite only.

- [ ] **Step 1: Import the layout engine**

At the top of `src/components/EventsPage.tsx`, add after the existing `../lib/backfill` import (line ~7):

```ts
import { layoutMonth } from "../lib/calendarLayout";
```

- [ ] **Step 2: Add a `barColor` helper and compute weeks**

Inside `CalendarView`, replace the `byDay` `useMemo` (lines ~515-519) with the weeks layout, and add a bar-color helper next to `dotColor` (line ~529). Keep `dotColor` (still used by the hover-preview dot). Add:

```ts
  const weeks = useMemo(() => layoutMonth(events, cursor.y, cursor.m), [events, cursor.y, cursor.m]);

  // Whole-bar background + text color by category (mirrors dotColor's rule).
  const barColor = (e: EventListItem) => {
    if (e.isExternal) return "bg-purple-500 text-white";
    const s = effectiveStatus(e);
    return s === "past" ? "bg-gray-400 text-white" : s === "in-process" ? "bg-amber-500 text-white" : "bg-blue-500 text-white";
  };
```

(Delete the now-unused `byDay` memo. Keep `undated`, `preview`, `onChipEnter`, `dotColor`.)

- [ ] **Step 3: Replace the grid body with week-rows + bar overlay**

Replace the grid `<div className="grid grid-cols-7 ...">` block (the weekday header + `{cells.map(...)}`, lines ~552-573) with week-rows. Also delete the now-unused `cells` construction (lines ~534-537), keeping `first`, `startDow`, `daysInMonth`, `shift`, `monthLabel`.

Constants for tuning (declare just before the `return`):

```ts
  const NUM_H = 20;      // px reserved at top of each week row for date numbers
  const LANE_H = 20;     // px per lane (resting)
  const BAR_H = 16;      // resting bar height (slim, line-like)
```

Grid body JSX (replaces the old grid div):

```tsx
      <div className="rounded-xl overflow-hidden border border-border">
        <div className="grid grid-cols-7 bg-border gap-px">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
            <div key={d} className="bg-gray-50 text-[11px] text-gray-500 text-center py-1.5">{d}</div>
          ))}
        </div>
        {weeks.map((week) => {
          const rowH = NUM_H + Math.max(week.laneCount, 1) * LANE_H + 6;
          return (
            <div key={week.weekIndex} className="relative bg-border" style={{ minHeight: rowH }}>
              {/* background day cells */}
              <div className="grid grid-cols-7 gap-px absolute inset-0">
                {Array.from({ length: 7 }, (_, col) => {
                  const day = week.weekIndex * 7 + col - startDow + 1;
                  const inMonth = day >= 1 && day <= daysInMonth;
                  const iso = inMonth ? `${cursor.y}-${pad(cursor.m + 1)}-${pad(day)}` : null;
                  return (
                    <div key={col} className={`bg-white ${iso === todayIso ? "ring-2 ring-inset ring-gray-900/15" : ""}`}>
                      {inMonth && <div className={`text-[12px] p-1.5 ${iso === todayIso ? "font-semibold text-gray-900" : "text-gray-400"}`}>{day}</div>}
                    </div>
                  );
                })}
              </div>
              {/* bar overlay */}
              <div className="absolute inset-x-0 grid grid-cols-7" style={{ top: NUM_H }}>
                {week.segments.map((seg) => (
                  <button
                    key={seg.event.id + "-" + seg.weekIndex}
                    onClick={() => onOpen(seg.event.id)}
                    onMouseEnter={(ev) => onChipEnter(ev, seg.event)}
                    onMouseLeave={() => setPreview(null)}
                    style={{ gridColumn: `${seg.startCol + 1} / span ${seg.span}`, marginTop: seg.lane * LANE_H, height: BAR_H }}
                    className={`flex items-center text-left text-[11px] px-1.5 mx-0.5 truncate transition-all ${barColor(seg.event)} ${seg.isStart ? "rounded-l" : ""} ${seg.isEnd ? "rounded-r" : ""}`}
                  >
                    <span className="truncate">{seg.isStart && seg.event.startTime ? `${seg.event.startTime} ` : ""}{seg.event.title}</span>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
```

- [ ] **Step 4: Type-check and build**

Run: `npx tsc -b 2>&1 | head -20 && npm run build 2>&1 | tail -5`
Expected: no type errors; build succeeds. (If `cells`/`byDay` leftovers cause "unused" noise, remove them.)

- [ ] **Step 5: Commit**

```bash
git add src/components/EventsPage.tsx
git commit -m "feat(calendar): render multi-day events as week-wrapping spanning bars"
```

---

### Task 3: Hover focus-plus-context (expand focused, minimize others)

Add hover state so hovering a bar expands that event across its whole span and minimizes/fades the others. Lane offsets stay fixed so bars don't jump.

**Files:**
- Modify: `src/components/EventsPage.tsx` (`CalendarView`)

**Interfaces:**
- Consumes: the week-row renderer from Task 2.
- Produces: no signature change.

- [ ] **Step 1: Add hover state**

Inside `CalendarView`, near the other `useState`s (by `preview`, line ~524), add:

```ts
  const [hoveredId, setHoveredId] = useState<string | null>(null);
```

- [ ] **Step 2: Drive the hovered id from bar mouse events**

In the bar `<button>` from Task 2, extend the handlers and make height/opacity depend on hover state. Replace the bar `<button>` with:

```tsx
                  <button
                    key={seg.event.id + "-" + seg.weekIndex}
                    onClick={() => onOpen(seg.event.id)}
                    onMouseEnter={(ev) => { setHoveredId(seg.event.id); onChipEnter(ev, seg.event); }}
                    onMouseLeave={() => { setHoveredId(null); setPreview(null); }}
                    style={{
                      gridColumn: `${seg.startCol + 1} / span ${seg.span}`,
                      marginTop: seg.lane * LANE_H,
                      height: hoveredId === seg.event.id ? LANE_H : BAR_H,
                      opacity: hoveredId && hoveredId !== seg.event.id ? 0.35 : 1,
                      zIndex: hoveredId === seg.event.id ? 10 : 1,
                    }}
                    className={`relative flex items-center text-left text-[11px] px-1.5 mx-0.5 truncate transition-all duration-150 ${barColor(seg.event)} ${seg.isStart ? "rounded-l" : ""} ${seg.isEnd ? "rounded-r" : ""} ${hoveredId === seg.event.id ? "shadow-md" : ""}`}
                  >
                    <span className="truncate">{seg.isStart && seg.event.startTime ? `${seg.event.startTime} ` : ""}{seg.event.title}</span>
                  </button>
```

(The resting `BAR_H` slim bar grows to a full `LANE_H` bar with a shadow when hovered; siblings fade to 0.35. Values are starting points for live tuning.)

- [ ] **Step 3: Type-check and build**

Run: `npx tsc -b 2>&1 | head -20 && npm run build 2>&1 | tail -5`
Expected: no type errors; build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/components/EventsPage.tsx
git commit -m "feat(calendar): hover focus-plus-context on spanning bars"
```

- [ ] **Step 5: Live verification**

Launch the app (`npm run dev`, or the project's run flow) and open the Calendar tab:
- A multi-day event shows one continuous bar across its days; verify a Fri→Tue event wraps across two week rows with flat inner edges.
- Overlapping events stack into separate lanes.
- Hovering a bar expands it and fades the others; mouse-out restores the compact view.
Note thickness/opacity/timing to tune together.

---

## Self-Review

**Spec coverage:** bucket-by-start-only problem → Task 2 replaces `byDay`; continuous week-wrapping bars → Task 1 (`layoutMonth` week split) + Task 2 (grid-column spans, `isStart`/`isEnd` rounding); lane stacking → Task 1 lane assignment + Task 2 `marginTop`; resting slim bars → Task 2 `BAR_H`; hover expand/minimize with fixed slots → Task 3; pure tested layout → Task 1 tests; category color → Task 2 `barColor`; shared across Events + Calendar pages → single `CalendarView` edit; no backend/undated handling → undated footer untouched, no schema change. All covered.

**Placeholder scan:** none — every code step is complete; tuning values are explicitly starting points, not placeholders.

**Type consistency:** `layoutMonth(events, year, month)` and `WeekRow { weekIndex, segments, laneCount }` / `BarSegment { event, weekIndex, startCol, span, isStart, isEnd, lane }` are used identically in Tasks 1–3. `barColor`/`dotColor`/`effectiveStatus` names consistent. `pad`, `todayIso`, `cursor`, `startDow`, `daysInMonth` are all pre-existing in `CalendarView`.
