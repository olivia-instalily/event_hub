import type { BudgetStatus } from "./db";

// A budget category: the optional grouping/need (Venue, Catering…) with an optional header estimate.
// Stored as JSONB on `budget.categories` — mirrors `event.benchmarks`.
export type BudgetCategory = { id: string; name: string; estimate: number | null; order: number };

export type HeaderKind = "actual" | "range" | "empty";
export type CategoryHeader = {
  kind: HeaderKind;
  value: number | null; // actual: paid sum · range: min · empty: null
  rangeHigh: number | null; // range: max, else null
  pendingCount: number; // still-quoted rows when the category also has paid rows
};

type Row = { status: BudgetStatus; amount: number | null };
const amt = (n: number | null | undefined) => (typeof n === "number" && !Number.isNaN(n) ? n : 0);

// The category header is the REAL number for the category — the estimate is a separate goal (shown
// as an editable "est" field and measured against this, like a mini vs-target). Ladder:
//   1) any paid → sum of paid rows (actual)
//   2) else quotes → the range of quotes (spread, not a synthesized average)
//   3) else empty
// The estimate never fills the header (that's what conflated goal-vs-actual before).
export function categoryHeader(lines: Row[]): CategoryHeader {
  const paid = lines.filter((l) => l.status === "paid" && l.amount != null);
  const quotes = lines.filter((l) => l.status === "quoted" && l.amount != null).map((l) => amt(l.amount));

  if (paid.length > 0) {
    const value = paid.reduce((s, l) => s + amt(l.amount), 0);
    // Partial-paid: some rows still quoted → surface a pending hint so it doesn't read as finished.
    const pendingCount = lines.filter((l) => l.status === "quoted" && l.amount != null).length;
    return { kind: "actual", value, rangeHigh: null, pendingCount };
  }
  if (quotes.length > 0) {
    return { kind: "range", value: Math.min(...quotes), rangeHigh: Math.max(...quotes), pendingCount: 0 };
  }
  return { kind: "empty", value: null, rangeHigh: null, pendingCount: 0 };
}

export type Rollup = { estimate: number; quoted: number; paid: number; committed: number };

// Top-level rollup: sum across all rows (categories + loose lines), bucketed per row by its own
// status so a partially-paid category splits correctly. committed = quoted + paid.
export function budgetRollup(lines: Row[]): Rollup {
  const r: Rollup = { estimate: 0, quoted: 0, paid: 0, committed: 0 };
  for (const l of lines) {
    const a = amt(l.amount);
    if (l.status === "paid") { r.paid += a; r.committed += a; }
    else if (l.status === "quoted") { r.quoted += a; r.committed += a; }
    else r.estimate += a;
  }
  return r;
}
