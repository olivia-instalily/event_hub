import type { BudgetStatus } from "./db";

// A budget category: the optional grouping/need (Venue, Catering…). Stored as JSONB on
// `budget.categories` — mirrors `event.benchmarks`.
export type BudgetCategory = { id: string; name: string; order: number };

export type HeaderKind = "paid" | "quoted" | "estimate" | "empty";
export type CategoryHeader = { kind: HeaderKind; value: number | null };

type Row = { status: BudgetStatus; amount: number | null };
const amt = (n: number | null | undefined) => (typeof n === "number" && !Number.isNaN(n) ? n : 0);

// The category header is the sum of its rows at the MOST ADVANCED stage present: paid, else quoted,
// else estimate, else empty. Its kind (color) is that stage — the number hardens green as rows get
// paid.
export function categoryHeader(lines: Row[]): CategoryHeader {
  const sumAt = (st: BudgetStatus) =>
    lines.filter((l) => l.status === st && l.amount != null).reduce((s, l) => s + amt(l.amount), 0);
  const has = (st: BudgetStatus) => lines.some((l) => l.status === st && l.amount != null);
  if (has("paid")) return { kind: "paid", value: sumAt("paid") };
  if (has("quoted")) return { kind: "quoted", value: sumAt("quoted") };
  if (has("estimate")) return { kind: "estimate", value: sumAt("estimate") };
  return { kind: "empty", value: null };
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
