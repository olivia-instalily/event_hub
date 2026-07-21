# Series Budget Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the series Budget tab as a line-item budget: a read of member events' committed spend (Paid), blue Estimated lines (manual + rate-generated), rate helpers, and a pending list — estimate-only, never touching committed spend.

**Architecture:** Campaign budget fields (currency, manual estimated lines, pending items) live in `event_series.extras.campaign` (jsonb, no migration). Travel/hotel "auto" estimate lines are derived live from the rates × People-tab data (never stored). Paid is read per member event from `budget_line` committed amounts. Pure derivations in `src/lib/campaign.ts` (unit-tested); the committed read in `src/lib/db.ts`; UI in `src/components/SeriesBudget.tsx`.

**Tech Stack:** React 18 + TypeScript, Tailwind, supabase-js (PostgREST as `authenticated`), vitest (node env).

## Global Constraints

- Estimate-only: nothing on this tab writes to any event's committed/assigned budget — only to `event_series.extras.campaign` via the existing `save`/`saveCampaign` path.
- Paid is a READ of member events' committed spend (per-event total of non-`estimate` budget lines); never entered/committed at the series level.
- Auto lines (travel, hotel) are DERIVED live from rates × People data and rendered marked "auto" — NOT stored. `campaign.estimatedLines` holds only hand-set lines.
- Total = Paid subtotal + Estimated subtotal, shown with the split ("$X committed · $Y estimated"). Pending items are NEVER in the total.
- Per-series `currency`, default `"CAD"`. A member event whose budget currency ≠ the series currency is flagged, not silently summed (conversion deferred).
- Empty state shows "—", not "$0". Rate 0 / no travelers → auto line $0 or omitted, no error.
- Committed = `normBudgetStatus(payment_status) !== 'estimate'`.

---

### Task 1: Campaign budget model + derivations (TDD)

**Files:**
- Modify: `src/lib/campaign.ts` (add fields to `Campaign` + `normalizeCampaign` + `emptyCampaign`; add derivations)
- Test: `src/lib/campaign.test.ts` (append)

**Interfaces:**
- Consumes: existing `travelEstimate(c)`, `accommodationEstimate(c, eventDates)`, `Campaign`.
- Produces:
  - `interface EstimatedLine { id: string; item: string; detail: string; amount: number; }`
  - `Campaign` gains `currency: string; estimatedLines: EstimatedLine[]; pendingItems: string[];`
  - `interface AutoEstimateLine { key: "travel" | "hotel"; item: string; detail: string; amount: number; }`
  - `formatMoney(amount: number, currency?: string): string`
  - `manualEstimatedTotal(c: Campaign): number`
  - `autoEstimateLines(c: Campaign, eventDates?: Record<string, string | null>): AutoEstimateLine[]`
  - `estimatedSubtotal(c: Campaign, eventDates?: Record<string, string | null>): number`

- [ ] **Step 1: Write the failing tests** — append to `src/lib/campaign.test.ts`:

```ts
import {
  normalizeCampaign, manualEstimatedTotal, autoEstimateLines, estimatedSubtotal, formatMoney,
} from "./campaign";

describe("budget: normalizeCampaign defaults", () => {
  it("defaults currency to CAD and budget arrays to empty", () => {
    const c = normalizeCampaign({});
    expect(c.currency).toBe("CAD");
    expect(c.estimatedLines).toEqual([]);
    expect(c.pendingItems).toEqual([]);
  });
  it("preserves provided budget fields", () => {
    const c = normalizeCampaign({ currency: "USD", estimatedLines: [{ id: "l1", item: "Merch", detail: "tees", amount: 300 }], pendingItems: ["videographer TBD"] });
    expect(c.currency).toBe("USD");
    expect(c.estimatedLines).toEqual([{ id: "l1", item: "Merch", detail: "tees", amount: 300 }]);
    expect(c.pendingItems).toEqual(["videographer TBD"]);
  });
});

describe("budget: estimated totals", () => {
  const base = normalizeCampaign({
    currency: "CAD",
    travelRatePerWave: 500,
    accommodationRatePerNight: null,
    estimatedLines: [{ id: "l1", item: "Merch", detail: "tees", amount: 300 }, { id: "l2", item: "Signage", detail: "banner", amount: 200 }],
    waves: [{ id: "w1", name: "W1", start: "2026-09-01", end: "2026-09-03", eventIds: [] }],
    people: [{ id: "p1", waveIds: ["w1"], travel: "flying" }, { id: "p2", waveIds: ["w1"], travel: "local" }],
  });
  it("sums manual estimated lines", () => {
    expect(manualEstimatedTotal(base)).toBe(500);
  });
  it("derives a travel auto line (1 flyer × 1 wave × 500)", () => {
    const autos = autoEstimateLines(base);
    const travel = autos.find((a) => a.key === "travel");
    expect(travel?.amount).toBe(500);
  });
  it("omits the hotel auto line when the rate is null", () => {
    expect(autoEstimateLines(base).some((a) => a.key === "hotel")).toBe(false);
  });
  it("estimated subtotal = manual + autos (500 manual + 500 travel)", () => {
    expect(estimatedSubtotal(base)).toBe(1000);
  });
  it("no travel auto line when the travel rate is null", () => {
    const c = normalizeCampaign({ ...base, travelRatePerWave: null });
    expect(autoEstimateLines(c).some((a) => a.key === "travel")).toBe(false);
    expect(estimatedSubtotal(c)).toBe(500); // just the manual lines
  });
});

describe("budget: formatMoney", () => {
  it("formats with the given currency, no cents", () => {
    expect(formatMoney(1500, "CAD")).toMatch(/1,500/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/campaign.test.ts`
Expected: FAIL — `manualEstimatedTotal`/`autoEstimateLines`/`estimatedSubtotal`/`formatMoney` not exported; `currency` missing on normalized campaign.

- [ ] **Step 3: Extend the `Campaign` interface + `EstimatedLine`**

In `src/lib/campaign.ts`, add above the `Campaign` interface:
```ts
export interface EstimatedLine { id: string; item: string; detail: string; amount: number; }
```
Add these three fields to the `Campaign` interface (after `anchorEventIds`):
```ts
  currency: string;              // per-series, default "CAD"
  estimatedLines: EstimatedLine[]; // MANUAL estimated lines only (auto lines are derived, not stored)
  pendingItems: string[];        // known-but-unsized costs, excluded from the total
```

- [ ] **Step 4: Update `emptyCampaign` and `normalizeCampaign`**

In `emptyCampaign()`, add to the returned object: `currency: "CAD", estimatedLines: [], pendingItems: []`.

In `normalizeCampaign`, add these to the returned object (after `anchorEventIds`):
```ts
    currency: typeof c.currency === "string" && c.currency.trim() ? c.currency : "CAD",
    estimatedLines: Array.isArray(c.estimatedLines)
      ? c.estimatedLines.map((l: any) => ({ id: String(l.id), item: l.item ?? "", detail: l.detail ?? "", amount: typeof l.amount === "number" ? l.amount : 0 }))
      : [],
    pendingItems: Array.isArray(c.pendingItems) ? c.pendingItems.filter((s: any) => typeof s === "string") : [],
```

- [ ] **Step 5: Add the derivations** (near the other budget derivations, after `accommodationEstimate`):

```ts
// Currency-aware money formatter (no cents). Falls back to a plain $ if the code is unknown.
export function formatMoney(amount: number, currency = "CAD"): string {
  try { return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 0 }).format(amount); }
  catch { return `$${Math.round(amount).toLocaleString()}`; }
}

export function manualEstimatedTotal(c: Campaign): number {
  return c.estimatedLines.reduce((s, l) => s + (l.amount || 0), 0);
}

export interface AutoEstimateLine { key: "travel" | "hotel"; item: string; detail: string; amount: number; }
// Travel + hotel estimate lines DERIVED from the rate helpers × People data. Present only when their
// rate is set. Never stored — recomputed each render so they can't drift.
export function autoEstimateLines(c: Campaign, eventDates: Record<string, string | null> = {}): AutoEstimateLine[] {
  const out: AutoEstimateLine[] = [];
  if (c.travelRatePerWave != null) {
    const travelers = c.people.filter((p) => p.travel === "flying").length;
    out.push({ key: "travel", item: "Flights / travel", detail: `${travelers} traveler${travelers === 1 ? "" : "s"} × wave × ${formatMoney(c.travelRatePerWave, c.currency)}`, amount: travelEstimate(c) });
  }
  if (c.accommodationRatePerNight != null) {
    const acc = accommodationEstimate(c, eventDates);
    out.push({ key: "hotel", item: "Accommodation", detail: `${acc.nights} traveler-night${acc.nights === 1 ? "" : "s"} × ${formatMoney(c.accommodationRatePerNight, c.currency)}`, amount: acc.cost });
  }
  return out;
}

export function estimatedSubtotal(c: Campaign, eventDates: Record<string, string | null> = {}): number {
  return manualEstimatedTotal(c) + autoEstimateLines(c, eventDates).reduce((s, l) => s + l.amount, 0);
}
```

- [ ] **Step 6: Run to verify pass**

Run: `npx vitest run src/lib/campaign.test.ts`
Expected: PASS (all).

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no new errors. (Note: adding required fields to `Campaign` — `emptyCampaign`/`normalizeCampaign` are the only constructors, both updated above, so existing call sites stay valid.)

- [ ] **Step 8: Commit**

```bash
git add src/lib/campaign.ts src/lib/campaign.test.ts
git commit -m "feat(series): campaign budget model + estimated/auto-line derivations"
```

---

### Task 2: Member-event committed totals (db.ts)

**Files:**
- Modify: `src/lib/db.ts` (add near `getSeriesEvents`; uses existing `normBudgetStatus`)

**Interfaces:**
- Consumes: `supabase`, `normBudgetStatus` (existing in db.ts).
- Produces: `getSeriesCommittedTotals(seriesId: string): Promise<SeriesCommitted[]>` where
  `interface SeriesCommitted { eventId: string; name: string; currency: string; committed: number; }`.

- [ ] **Step 1: Add the interface + function** (after `getSeriesEvents`):

```ts
export interface SeriesCommitted { eventId: string; name: string; currency: string; committed: number; }
// Per member event: the sum of its COMMITTED budget lines (payment_status not 'estimate') + that
// event's budget currency. A read for the Budget tab's Paid block — the series never commits money.
export async function getSeriesCommittedTotals(seriesId: string): Promise<SeriesCommitted[]> {
  const { data: evs, error } = await supabase.from("event").select("id, name").eq("series_id", seriesId).eq("is_template", false);
  if (error) throw error;
  const events = (evs ?? []) as { id: string; name: string }[];
  if (!events.length) return [];
  const ids = events.map((e) => e.id);
  const { data: budgets, error: bErr } = await supabase.from("budget").select("event_id, currency, lines:budget_line ( confirmed_amount, payment_status )").in("event_id", ids);
  if (bErr) throw bErr;
  const byEvent = new Map<string, { currency: string; committed: number }>();
  for (const b of (budgets ?? []) as any[]) {
    const cur = byEvent.get(b.event_id) ?? { currency: b.currency ?? "USD", committed: 0 };
    for (const l of b.lines ?? []) {
      if (normBudgetStatus(l.payment_status) !== "estimate") cur.committed += Number(l.confirmed_amount) || 0;
    }
    byEvent.set(b.event_id, cur);
  }
  return events.map((e) => ({ eventId: e.id, name: e.name, currency: byEvent.get(e.id)?.currency ?? "USD", committed: byEvent.get(e.id)?.committed ?? 0 }));
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/db.ts
git commit -m "feat(series): getSeriesCommittedTotals — per-event committed spend read"
```

---

### Task 3: Budget tab UI (four blocks)

**Files:**
- Rewrite: `src/components/SeriesBudget.tsx`

**Interfaces:**
- Consumes: `TabProps` (`{ seriesId, campaign, events, save }`), `formatMoney`, `manualEstimatedTotal`, `autoEstimateLines`, `estimatedSubtotal`, `memberBudgetTotal`, `type EstimatedLine` from `../lib/campaign`; `getSeriesCommittedTotals`, `type SeriesCommitted` from `../lib/db`.

- [ ] **Step 1: Rewrite `src/components/SeriesBudget.tsx`**

```tsx
import { useEffect, useState } from "react";
import { Plus, X, AlertTriangle } from "lucide-react";
import type { TabProps } from "./SeriesDashboard";
import { formatMoney, manualEstimatedTotal, autoEstimateLines, estimatedSubtotal, type EstimatedLine } from "../lib/campaign";
import { getSeriesCommittedTotals, type SeriesCommitted } from "../lib/db";

const newLineId = () => "el-" + (globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2));

export function SeriesBudget({ seriesId, campaign, events, save }: TabProps) {
  const cur = campaign.currency || "CAD";
  const [paid, setPaid] = useState<SeriesCommitted[] | null>(null);
  const [addingLine, setAddingLine] = useState(false);
  const [lineItem, setLineItem] = useState("");
  const [lineDetail, setLineDetail] = useState("");
  const [lineAmount, setLineAmount] = useState("");
  const [pendingText, setPendingText] = useState("");

  useEffect(() => { getSeriesCommittedTotals(seriesId).then(setPaid).catch(() => setPaid([])); }, [seriesId]);

  const eventDates: Record<string, string | null> = {};
  for (const e of events) eventDates[e.id] = e.date;

  // Paid: only rows with committed spend; mismatched-currency rows flagged (not summed).
  const paidRows = (paid ?? []).filter((r) => r.committed > 0);
  const paidSameCur = paidRows.filter((r) => r.currency === cur);
  const paidMismatch = paidRows.filter((r) => r.currency !== cur);
  const paidSubtotal = paidSameCur.reduce((s, r) => s + r.committed, 0);

  const autos = autoEstimateLines(campaign, eventDates);
  const estTotal = estimatedSubtotal(campaign, eventDates);
  const combined = paidSubtotal + estTotal;
  const isEmpty = paidRows.length === 0 && campaign.estimatedLines.length === 0 && autos.length === 0;

  const setRate = (field: "travelRatePerWave" | "accommodationRatePerNight", v: string) =>
    save({ ...campaign, [field]: v === "" ? null : Number(v) });
  const patchLine = (id: string, patch: Partial<EstimatedLine>) =>
    save({ ...campaign, estimatedLines: campaign.estimatedLines.map((l) => (l.id === id ? { ...l, ...patch } : l)) });
  const removeLine = (id: string) => save({ ...campaign, estimatedLines: campaign.estimatedLines.filter((l) => l.id !== id) });
  const addLine = () => {
    if (!lineItem.trim()) return;
    save({ ...campaign, estimatedLines: [...campaign.estimatedLines, { id: newLineId(), item: lineItem.trim(), detail: lineDetail.trim(), amount: Number(lineAmount) || 0 }] });
    setLineItem(""); setLineDetail(""); setLineAmount(""); setAddingLine(false);
  };
  const addPending = () => { const t = pendingText.trim(); if (!t) return; save({ ...campaign, pendingItems: [...campaign.pendingItems, t] }); setPendingText(""); };
  const removePending = (i: number) => save({ ...campaign, pendingItems: campaign.pendingItems.filter((_, j) => j !== i) });

  return (
    <div className="max-w-2xl space-y-6">
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-[13px] text-amber-800">
        Estimate only — this never flows into committed spend. Paid is read from each event's own budget; nothing here changes it. Currency: {cur}.
      </div>

      {/* 1. Paid / committed (read) */}
      <section className="rounded-xl border border-border divide-y divide-gray-100">
        <div className="px-4 py-2 text-[13px] font-medium text-gray-500">Paid / committed <span className="font-normal text-gray-400">· read from member events</span></div>
        {paid === null && <div className="px-4 py-3 text-sm text-gray-400">Loading…</div>}
        {paid !== null && paidRows.length === 0 && <div className="px-4 py-3 text-sm text-gray-400">No committed spend on member events yet.</div>}
        {paidSameCur.map((r) => (
          <div key={r.eventId} className="flex items-center justify-between px-4 py-2 text-sm">
            <span className="truncate">{r.name}</span>
            <span>{formatMoney(r.committed, cur)}</span>
          </div>
        ))}
        {paidMismatch.map((r) => (
          <div key={r.eventId} className="flex items-center justify-between px-4 py-2 text-sm text-amber-700">
            <span className="truncate inline-flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5 shrink-0" />{r.name}</span>
            <span title="Different currency — not added to the series total">{formatMoney(r.committed, r.currency)} <span className="text-[12px]">({r.currency})</span></span>
          </div>
        ))}
        {paidSameCur.length > 0 && <div className="flex items-center justify-between px-4 py-2 text-sm font-medium"><span>Subtotal</span><span>{formatMoney(paidSubtotal, cur)}</span></div>}
      </section>

      {/* 2. Estimated (blue): manual lines + derived auto lines */}
      <section className="rounded-xl border border-border divide-y divide-gray-100">
        <div className="px-4 py-2 text-[13px] font-medium text-gray-500">Estimated <span className="font-normal text-gray-400">· to refine</span></div>
        {campaign.estimatedLines.map((l) => (
          <div key={l.id} className="flex items-center gap-2 px-4 py-2 text-sm">
            <div className="flex-1 min-w-0">
              <input value={l.item} onChange={(e) => patchLine(l.id, { item: e.target.value })} placeholder="Item" className="block w-full font-medium text-blue-700 bg-transparent focus:outline-none" />
              <input value={l.detail} onChange={(e) => patchLine(l.id, { detail: e.target.value })} placeholder="detail (the reasoning)" className="block w-full text-[12px] text-gray-400 bg-transparent focus:outline-none" />
            </div>
            <input type="number" value={l.amount || ""} onChange={(e) => patchLine(l.id, { amount: Number(e.target.value) || 0 })} className="w-24 px-2 py-1 border border-gray-200 rounded text-right text-blue-700" />
            <button onClick={() => removeLine(l.id)} className="text-gray-300 hover:text-red-600 shrink-0"><X className="w-4 h-4" /></button>
          </div>
        ))}
        {autos.map((a) => (
          <div key={a.key} className="flex items-center justify-between px-4 py-2 text-sm">
            <div className="min-w-0">
              <span className="font-medium text-blue-700">{a.item} <span className="text-[11px] font-normal text-blue-400 border border-blue-200 rounded px-1">auto</span></span>
              <span className="block text-[12px] text-gray-400">{a.detail}</span>
            </div>
            <span className="text-blue-700">{formatMoney(a.amount, cur)}</span>
          </div>
        ))}
        {addingLine ? (
          <div className="flex items-center gap-2 px-4 py-2">
            <input autoFocus value={lineItem} onChange={(e) => setLineItem(e.target.value)} placeholder="Item" className="flex-1 min-w-0 px-2 py-1 border border-border rounded text-sm" />
            <input value={lineDetail} onChange={(e) => setLineDetail(e.target.value)} placeholder="detail" className="flex-1 min-w-0 px-2 py-1 border border-border rounded text-sm" />
            <input type="number" value={lineAmount} onChange={(e) => setLineAmount(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addLine(); }} placeholder="0" className="w-24 px-2 py-1 border border-border rounded text-right text-sm" />
            <button onClick={addLine} disabled={!lineItem.trim()} className="px-2 py-1 bg-gray-900 text-white rounded text-sm disabled:opacity-50">Add</button>
            <button onClick={() => setAddingLine(false)} className="text-gray-400 hover:text-gray-700"><X className="w-4 h-4" /></button>
          </div>
        ) : (
          <button onClick={() => setAddingLine(true)} className="flex items-center gap-1 px-4 py-2 text-[13px] text-gray-500 hover:text-gray-900"><Plus className="w-3.5 h-3.5" /> add estimated line</button>
        )}
        {(campaign.estimatedLines.length > 0 || autos.length > 0) && <div className="flex items-center justify-between px-4 py-2 text-sm font-medium"><span>Subtotal</span><span>{formatMoney(manualEstimatedTotal(campaign) + autos.reduce((s, a) => s + a.amount, 0), cur)}</span></div>}
      </section>

      {/* 3. Rate helpers */}
      <section className="rounded-xl border border-border p-4 space-y-2">
        <div className="text-[13px] font-medium text-gray-500 mb-1">Rate helpers <span className="font-normal text-gray-400">· generate the auto lines above from the People tab</span></div>
        <div className="flex items-center justify-between text-sm">
          <span>Travel rate / traveler (per wave)</span>
          <input type="number" value={campaign.travelRatePerWave ?? ""} onChange={(e) => setRate("travelRatePerWave", e.target.value)} placeholder="—" className="w-28 px-2 py-1 border border-gray-300 rounded text-right" />
        </div>
        <div className="flex items-center justify-between text-sm">
          <span>Accommodation rate / night (per person)</span>
          <input type="number" value={campaign.accommodationRatePerNight ?? ""} onChange={(e) => setRate("accommodationRatePerNight", e.target.value)} placeholder="—" className="w-28 px-2 py-1 border border-gray-300 rounded text-right" />
        </div>
      </section>

      {/* 4. Not yet included (pending) */}
      <section className="rounded-xl border border-border p-4">
        <div className="text-[13px] font-medium text-gray-500 mb-2">Not yet included <span className="font-normal text-gray-400">· known but unsized — excluded from the total</span></div>
        <ul className="space-y-1 mb-2">
          {campaign.pendingItems.map((p, i) => (
            <li key={i} className="flex items-center justify-between gap-2 text-sm text-gray-700">
              <span className="truncate">• {p}</span>
              <button onClick={() => removePending(i)} className="text-gray-300 hover:text-red-600 shrink-0"><X className="w-4 h-4" /></button>
            </li>
          ))}
          {campaign.pendingItems.length === 0 && <li className="text-[13px] text-gray-400">Nothing pending.</li>}
        </ul>
        <div className="flex items-center gap-2">
          <input value={pendingText} onChange={(e) => setPendingText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addPending(); }} placeholder="e.g. videographer TBD" className="flex-1 min-w-0 px-2 py-1 border border-border rounded text-sm" />
          <button onClick={addPending} disabled={!pendingText.trim()} className="inline-flex items-center gap-1 px-2 py-1 text-[13px] text-gray-500 hover:text-gray-900 disabled:opacity-50"><Plus className="w-3.5 h-3.5" /> add pending item</button>
        </div>
      </section>

      {/* Total with split */}
      <div className="flex items-center justify-between rounded-xl border border-border bg-muted px-4 py-3">
        <div>
          <span className="font-medium">Total estimate</span>
          {!isEmpty && <span className="block text-[12px] text-gray-500">{formatMoney(paidSubtotal, cur)} committed · {formatMoney(estTotal, cur)} estimated</span>}
        </div>
        <span className="text-lg font-medium">{isEmpty ? "—" : formatMoney(combined, cur)}</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + full test suite**

Run: `npx tsc --noEmit -p tsconfig.json && npx vitest run`
Expected: no type errors; all tests pass (incl. Task 1's new budget tests).

- [ ] **Step 3: Commit**

```bash
git add src/components/SeriesBudget.tsx
git commit -m "feat(series): Budget tab — paid read, estimated lines + rate autos, pending, split total"
```

---

## Self-Review

**Spec coverage:**
- Paid read (per-event committed totals, subtotal, currency-mismatch flag) → Task 2 + Task 3 ✓
- Estimated block (manual lines with detail, blue; auto lines derived + "auto" tag; subtotal) → Task 1 + Task 3 ✓
- Rate helpers feed auto lines live → Task 1 (`autoEstimateLines`) + Task 3 ✓
- Pending list excluded from total → Task 3 ✓
- Total with split → Task 3 ✓
- Per-series currency (default CAD) → Task 1 (model/normalize) + Task 3 (`formatMoney`) ✓
- Estimate-only (writes only to `extras.campaign` via `save`; Paid is read) → Task 3 ✓
- Auto lines derived-not-stored → Task 1 (`autoEstimateLines`, not in model) ✓
- Empty state "—", rate 0 → no error → Task 3 (`isEmpty`) + Task 1 (rate-null omits auto) ✓

**Placeholder scan:** none — every step has real code/commands.

**Type consistency:** `EstimatedLine`/`AutoEstimateLine`/`SeriesCommitted` defined in Tasks 1–2, consumed in Task 3; `formatMoney`/`manualEstimatedTotal`/`autoEstimateLines`/`estimatedSubtotal` names consistent across tasks; `Campaign` fields (`currency`/`estimatedLines`/`pendingItems`) added in Task 1 and read in Task 3.

**Deploy parity:** frontend + `db.ts` only (campaign in `extras` on the already-granted `event_series`; committed read from already-granted `budget`/`budget_line`). No migration, no cloud function. Ships via the SPA build on push.
