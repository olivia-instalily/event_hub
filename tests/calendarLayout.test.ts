import { describe, test, expect } from "vitest";
import { layoutMonth, type Fragment, type MonthLayout } from "../src/lib/calendarLayout";
import type { EventListItem } from "../src/lib/db";

// Minimal EventListItem factory — the layout pipeline only reads id/date/endDate/isTemplate.
function ev(id: string, date: string | null, endDate: string | null = null, isTemplate = false): EventListItem {
  return { id, date, endDate, isTemplate } as unknown as EventListItem;
}
const fragsOf = (m: MonthLayout, id: string) => m.fragments.filter((f) => f.eventId === id);

// March 2026: March 1 is a Sunday (startCol 0), 31 days.
const Y = 2026, M = 2; // month is 0-indexed → 2 = March

describe("layoutMonth — fragments", () => {
  test("single day → one fragment, span 1, isStart & isEnd, lane 0", () => {
    const f = layoutMonth([ev("a", "2026-03-04")], Y, M).fragments;
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ rowIndex: 0, startCol: 3, colSpan: 1, isStart: true, isEnd: true, lane: 0 });
  });

  test("span inside one week → single fragment spanning the range", () => {
    const f = layoutMonth([ev("a", "2026-03-02", "2026-03-05")], Y, M).fragments;
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ rowIndex: 0, startCol: 1, colSpan: 4, isStart: true, isEnd: true });
  });

  test("span crossing one week boundary → two fragments with flat inner edges", () => {
    // Fri Mar 6 → Tue Mar 10.
    const f = layoutMonth([ev("a", "2026-03-06", "2026-03-10")], Y, M).fragments;
    expect(f).toHaveLength(2);
    expect(f.find((x) => x.rowIndex === 0)).toMatchObject({ startCol: 5, colSpan: 2, isStart: true, isEnd: false });
    expect(f.find((x) => x.rowIndex === 1)).toMatchObject({ startCol: 0, colSpan: 3, isStart: false, isEnd: true });
  });

  test("span > 7 days → three fragments; the middle has neither flag", () => {
    // Fri Mar 6 → Tue Mar 17 spans weeks 0,1,2.
    const f = layoutMonth([ev("a", "2026-03-06", "2026-03-17")], Y, M).fragments.sort((a, b) => a.rowIndex - b.rowIndex);
    expect(f).toHaveLength(3);
    expect(f[0]).toMatchObject({ isStart: true, isEnd: false });
    expect(f[1]).toMatchObject({ isStart: false, isEnd: false });
    expect(f[2]).toMatchObject({ isStart: false, isEnd: true });
  });

  test("span starting before the visible month → first fragment isStart=false", () => {
    const f = layoutMonth([ev("a", "2026-02-27", "2026-03-03")], Y, M).fragments;
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ startCol: 0, colSpan: 3, isStart: false, isEnd: true });
  });

  test("span ending after the visible month → last fragment isEnd=false", () => {
    const f = layoutMonth([ev("a", "2026-03-30", "2026-04-02")], Y, M).fragments;
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ colSpan: 2, isStart: true, isEnd: false });
  });

  test("two adjacent spans share a lane (adjacent is not overlap)", () => {
    // a ends Mar 4, b starts Mar 5.
    const f = layoutMonth([ev("a", "2026-03-02", "2026-03-04"), ev("b", "2026-03-05", "2026-03-07")], Y, M).fragments;
    expect(f.every((x) => x.lane === 0)).toBe(true);
  });

  test("two overlapping spans take different lanes", () => {
    const m = layoutMonth([ev("a", "2026-03-02", "2026-03-05"), ev("b", "2026-03-04", "2026-03-06")], Y, M);
    expect(new Set(m.fragments.map((f) => f.lane))).toEqual(new Set([0, 1]));
  });

  test("four overlapping → four stacked lanes (no cap)", () => {
    const m = layoutMonth([
      ev("a", "2026-03-03", "2026-03-04"), ev("b", "2026-03-03", "2026-03-04"),
      ev("c", "2026-03-03", "2026-03-04"), ev("d", "2026-03-03", "2026-03-04"),
    ], Y, M);
    expect(m.fragments).toHaveLength(4);
    expect(new Set(m.fragments.map((f) => f.lane))).toEqual(new Set([0, 1, 2, 3]));
  });

  test("wrapping event keeps one lane even when its 2nd week is crowded (not per-row)", () => {
    // A wraps weeks 0→1. Three single-day events crowd week 1 on days A also covers.
    const m = layoutMonth([
      ev("A", "2026-03-06", "2026-03-11"),  // Fri wk0 → Wed wk1
      ev("B", "2026-03-09"), ev("C", "2026-03-10"), ev("D", "2026-03-11"),
    ], Y, M);
    const a = fragsOf(m, "A");
    expect(a).toHaveLength(2);
    expect(new Set(a.map((f) => f.lane)).size).toBe(1);        // same lane across the wrap
  });
});

describe("layoutMonth — invariants", () => {
  const events = [
    ev("single", "2026-03-04"),
    ev("wrap", "2026-03-06", "2026-03-17"),
    ev("clippedStart", "2026-02-27", "2026-03-03"),
    ev("clippedEnd", "2026-03-30", "2026-04-02"),
    ev("overlapA", "2026-03-10", "2026-03-12"),
    ev("overlapB", "2026-03-11", "2026-03-13"),
  ];
  const m = layoutMonth(events, Y, M);

  test("exactly one fragment per unclipped event has isStart, one has isEnd", () => {
    for (const id of ["single", "wrap", "overlapA", "overlapB"]) {
      const f = fragsOf(m, id);
      expect(f.filter((x) => x.isStart)).toHaveLength(1);
      expect(f.filter((x) => x.isEnd)).toHaveLength(1);
    }
  });

  test("fragment colSpans sum to the event's visible duration", () => {
    expect(fragsOf(m, "wrap").reduce((s, f) => s + f.colSpan, 0)).toBe(12); // Mar 6..17
    expect(fragsOf(m, "clippedStart").reduce((s, f) => s + f.colSpan, 0)).toBe(3); // Mar 1..3 visible
  });

  test("no two fragments in the same (rowIndex, lane) overlap in columns", () => {
    const seen: Fragment[] = [];
    for (const f of m.fragments) {
      for (const g of seen) {
        if (f.rowIndex === g.rowIndex && f.lane === g.lane) {
          const overlap = f.startCol <= g.startCol + g.colSpan - 1 && g.startCol <= f.startCol + f.colSpan - 1;
          expect(overlap).toBe(false);
        }
      }
      seen.push(f);
    }
  });

  test("every fragment of a given event shares one lane", () => {
    for (const id of new Set(m.fragments.map((f) => f.eventId))) {
      expect(new Set(fragsOf(m, id).map((f) => f.lane)).size).toBe(1);
    }
  });
});
