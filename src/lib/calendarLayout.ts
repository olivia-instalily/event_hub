import type { EventListItem } from "./db";

// One (event × week-row) slice of a multi-day span. `isStart`/`isEnd` are load-bearing: a
// fragment clipped by the visible month gets neither, so cap/dot/radius stay correct on wraps.
export interface Fragment {
  eventId: string;
  event: EventListItem;
  rowIndex: number;   // which week row (0-based)
  lane: number;       // 0..MAX_LANES-1, stable across rows for a given event
  startCol: number;   // 0..6 (Sun..Sat)
  colSpan: number;    // 1..7
  isStart: boolean;   // contains the event's real first day
  isEnd: boolean;     // contains the event's real last day
}
// Days whose events spilled past the lane cap collapse to a "+N more" affordance.
export interface OverflowMarker { rowIndex: number; col: number; count: number; }
export interface MonthLayout { weekCount: number; fragments: Fragment[]; overflow: OverflowMarker[]; }

export const MAX_LANES = 3;

// Parse an ISO calendar date at local noon so comparisons are by calendar day, not UTC instant.
const parse = (iso: string) => new Date(iso + "T12:00:00");

interface Placed {
  event: EventListItem;
  startT: number; endT: number;          // real start/end (for sort)
  clipStartDom: number; clipEndDom: number; // day-of-month, clipped to the visible month
  realStart: boolean; realEnd: boolean;
  lane: number;
}

// Pure stages 1-4: sort → month-wide lane assignment → split into week fragments → cap.
// `month` is 0-indexed (JS Date convention). `narrowMode` is measured by the renderer, not here.
export function layoutMonth(events: EventListItem[], year: number, month: number): MonthLayout {
  const startDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const weekCount = Math.ceil((startDow + daysInMonth) / 7);
  const monthStart = new Date(year, month, 1, 12).getTime();
  const monthEnd = new Date(year, month, daysInMonth, 12).getTime();

  // Collect visible, dated, non-template events with their clipped ranges.
  const items: Omit<Placed, "lane">[] = [];
  for (const e of events) {
    if (!e.date || e.isTemplate) continue;
    const startT = parse(e.date).getTime();
    const endT = parse(e.endDate ?? e.date).getTime();
    if (endT < monthStart || startT > monthEnd) continue;
    const realStart = startT >= monthStart;
    const realEnd = endT <= monthEnd;
    items.push({
      event: e, startT, endT, realStart, realEnd,
      clipStartDom: realStart ? new Date(startT).getDate() : 1,
      clipEndDom: realEnd ? new Date(endT).getDate() : daysInMonth,
    });
  }

  // Stage 1: sort by start asc, then duration desc, then id — builds the descending staircase.
  items.sort((a, b) =>
    a.startT - b.startT || (b.endT - b.startT) - (a.endT - a.startT) || String(a.event.id).localeCompare(String(b.event.id)));

  // Stage 2: greedy month-wide lane assignment (adjacent days don't count as overlap).
  const laneOccupants: Placed[][] = [];
  const placed: Placed[] = items.map((it) => {
    let lane = 0;
    for (;;) {
      const occ = laneOccupants[lane] ?? [];
      const clash = occ.some((o) => it.clipStartDom <= o.clipEndDom && o.clipStartDom <= it.clipEndDom);
      if (!clash) { (laneOccupants[lane] ??= []).push({ ...it, lane }); break; }
      lane++;
    }
    return { ...it, lane };
  });

  // Stages 3 & 4: split each event into per-week fragments; cap at MAX_LANES, count overflow per day.
  const fragments: Fragment[] = [];
  const overflowMap = new Map<string, OverflowMarker>();
  for (const p of placed) {
    const startCell = startDow + p.clipStartDom - 1;
    const endCell = startDow + p.clipEndDom - 1;
    for (let w = Math.floor(startCell / 7); w <= Math.floor(endCell / 7); w++) {
      const weekFirst = w * 7, weekLast = w * 7 + 6;
      const segFirst = Math.max(startCell, weekFirst);
      const segLast = Math.min(endCell, weekLast);
      const startCol = segFirst - weekFirst;
      const colSpan = segLast - segFirst + 1;
      if (p.lane < MAX_LANES) {
        fragments.push({
          eventId: String(p.event.id), event: p.event, rowIndex: w, lane: p.lane,
          startCol, colSpan,
          isStart: segFirst === startCell && p.realStart,
          isEnd: segLast === endCell && p.realEnd,
        });
      } else {
        // Overflowed the cap: contribute to each day's "+N more" count.
        for (let c = startCol; c < startCol + colSpan; c++) {
          const key = `${w}:${c}`;
          const m = overflowMap.get(key) ?? { rowIndex: w, col: c, count: 0 };
          m.count++;
          overflowMap.set(key, m);
        }
      }
    }
  }

  return { weekCount, fragments, overflow: [...overflowMap.values()] };
}
