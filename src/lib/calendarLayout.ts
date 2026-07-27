import type { EventListItem } from "./db";

// One (event × week-row) slice of a multi-day span. `isStart`/`isEnd` are load-bearing: a
// fragment clipped by the visible month gets neither, so a chip wrapping across weeks still
// reads as one event (rounded/labelled on the true start, plain in the middle).
export interface Fragment {
  eventId: string;
  event: EventListItem;
  rowIndex: number;   // which week row (0-based)
  lane: number;       // vertical slot, stable across rows for a given event
  startCol: number;   // 0..6 (Sun..Sat)
  colSpan: number;    // 1..7
  isStart: boolean;   // contains the event's real first day
  isEnd: boolean;     // contains the event's real last day
}
export interface MonthLayout { weekCount: number; fragments: Fragment[]; }

// Parse an ISO calendar date at local noon so comparisons are by calendar day, not UTC instant.
const parse = (iso: string) => new Date(iso + "T12:00:00");

// Sort → month-wide greedy lane assignment (keeps a wrapping event on one lane) → split into
// per-week fragments. `month` is 0-indexed (JS Date convention). No lane cap — rows grow to fit.
export function layoutMonth(events: EventListItem[], year: number, month: number): MonthLayout {
  const startDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const weekCount = Math.ceil((startDow + daysInMonth) / 7);
  const monthStart = new Date(year, month, 1, 12).getTime();
  const monthEnd = new Date(year, month, daysInMonth, 12).getTime();

  interface Item { event: EventListItem; startT: number; endT: number; clipStartDom: number; clipEndDom: number; realStart: boolean; realEnd: boolean; }
  const items: Item[] = [];
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

  // Sort by start asc, duration desc, id — longer spans take the upper lanes.
  items.sort((a, b) =>
    a.startT - b.startT || (b.endT - b.startT) - (a.endT - a.startT) || String(a.event.id).localeCompare(String(b.event.id)));

  // Greedy month-wide lanes (adjacent days are not an overlap).
  const laneEnds: Array<Array<[number, number]>> = [];
  const placed = items.map((it) => {
    let lane = 0;
    for (;;) {
      const occ = laneEnds[lane] ?? [];
      const clash = occ.some(([s, e]) => it.clipStartDom <= e && s <= it.clipEndDom);
      if (!clash) { (laneEnds[lane] ??= []).push([it.clipStartDom, it.clipEndDom]); break; }
      lane++;
    }
    return { it, lane };
  });

  const fragments: Fragment[] = [];
  for (const { it, lane } of placed) {
    const startCell = startDow + it.clipStartDom - 1;
    const endCell = startDow + it.clipEndDom - 1;
    for (let w = Math.floor(startCell / 7); w <= Math.floor(endCell / 7); w++) {
      const weekFirst = w * 7, weekLast = w * 7 + 6;
      const segFirst = Math.max(startCell, weekFirst);
      const segLast = Math.min(endCell, weekLast);
      fragments.push({
        eventId: String(it.event.id), event: it.event, rowIndex: w, lane,
        startCol: segFirst - weekFirst, colSpan: segLast - segFirst + 1,
        isStart: segFirst === startCell && it.realStart,
        isEnd: segLast === endCell && it.realEnd,
      });
    }
  }

  return { weekCount, fragments };
}
