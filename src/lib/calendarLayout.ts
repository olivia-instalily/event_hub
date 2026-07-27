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
