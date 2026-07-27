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
