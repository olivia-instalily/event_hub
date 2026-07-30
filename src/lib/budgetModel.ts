import type { BudgetStatus } from "./db";

// A budget category: the optional grouping/need (Venue, Catering…) with an optional header estimate.
// Stored as JSONB on `budget.categories` — mirrors `event.benchmarks`.
export type BudgetCategory = { id: string; name: string; estimate: number | null; order: number };

export type HeaderKind = "actual" | "estimate" | "range" | "empty";
export type CategoryHeader = {
  kind: HeaderKind;
  value: number | null; // actual: paid sum · estimate: the estimate · range: min · empty: null
  rangeHigh: number | null; // range: max, else null
  estWas: number | null; // original estimate, only when kind === 'actual' and an estimate existed
  pendingCount: number; // still-quoted rows when the category also has paid rows
};

type Row = { status: BudgetStatus; amount: number | null };
const amt = (n: number | null | undefined) => (typeof n === "number" && !Number.isNaN(n) ? n : 0);

// The category header resolves to ONE number by a precedence ladder (top match wins). Its KIND
// encodes how real the number is — the certainty story: estimate/range (soft) hardens to actual as
// vendors get paid.
export function categoryHeader(lines: Row[], estimate: number | null): CategoryHeader {
  const paid = lines.filter((l) => l.status === "paid" && l.amount != null);
  const quotes = lines.filter((l) => l.status === "quoted" && l.amount != null).map((l) => amt(l.amount));
  const hasEstimate = estimate != null;

  // 1) Any paid → sum of paid (actual). Multiple paid rows sum together.
  if (paid.length > 0) {
    const value = paid.reduce((s, l) => s + amt(l.amount), 0);
    // Partial-paid: some rows still quoted → surface a pending hint so it doesn't read as finished.
    const pendingCount = lines.filter((l) => l.status === "quoted" && l.amount != null).length;
    return { kind: "actual", value, rangeHigh: null, estWas: hasEstimate ? estimate! : null, pendingCount };
  }
  // 2) No paid, typed estimate → the estimate. A quote is information, not a commitment: it does NOT
  //    move a header that has an estimate.
  if (hasEstimate) {
    return { kind: "estimate", value: estimate!, rangeHigh: null, estWas: null, pendingCount: 0 };
  }
  // 3) No paid, no estimate, quotes exist → the range of quotes (spread, not a synthesized average).
  if (quotes.length > 0) {
    return { kind: "range", value: Math.min(...quotes), rangeHigh: Math.max(...quotes), estWas: null, pendingCount: 0 };
  }
  // 4) Nothing.
  return { kind: "empty", value: null, rangeHigh: null, estWas: null, pendingCount: 0 };
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
