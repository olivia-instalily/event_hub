# Budget — sectioned model, vendors demoted to rows — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse the per-event Vendors store into the budget: a budget of optional categories (with an optional estimate) containing vendor rows, plus loose lines, with a color-coded category-header ladder; keep the cross-event vendor directory, fed from tagged rows.

**Architecture:** Mirror the shipped deliverables pattern — `budget.categories` JSONB (like `event.benchmarks`) + a nullable `budget_line.category_id` (like `deliverable.benchmark_id`). Category header numbers are computed by a pure `categoryHeader()` helper, never stored. The rebuilt sectioned budget UI moves into its own `BudgetTracker.tsx`; the per-event Vendors tab is deleted.

**Tech Stack:** React 19 + TypeScript + Tailwind; self-hosted PostgREST + Cloud SQL Postgres (supabase-js client); vitest (node env) for pure helpers.

## Global Constraints

- Budget statuses are exactly `'estimate' | 'quoted' | 'paid'` (`BUDGET_STATUSES` in `db.ts`); use `normBudgetStatus()` for any stored value.
- `budget.categories` JSONB shape: `[{ id, name, estimate: number | null, order }]`. `budget_line.category_id = null` ⇒ a loose line.
- Category header ladder (top match wins): **any paid rows → sum of paid (actual/green)** › **no paid + typed estimate → estimate (grey)** › **no paid, no estimate, quotes exist → range of quotes (amber)** › **empty (—)**. A typed estimate is never overridden by quotes.
- `est was $X` hint persists once a category is actual; `+N still quoting` hint when a category mixes paid + quoted rows.
- Only budget rows WITH a vendor feed the global `vendor` directory. Empty-vendor rows are valid, complete costs.
- Deploy-parity: the migration must be manually applied to prod Cloud SQL. Do NOT push/deploy — commit locally only.
- `engagement` / `engagement_candidate` tables are NOT dropped in this work (orphaned, later cleanup).

---

## File Structure

- **Create** `src/lib/budgetModel.ts` — pure helpers + types (`BudgetCategory`, `CategoryHeader`, `categoryHeader()`, `budgetRollup()`). No DB imports.
- **Create** `src/lib/budgetModel.test.ts` — vitest tests for the helpers.
- **Create** `supabase/migrations/20260730000000_budget_sectioned.sql` — schema + backfill + capture-home migrate.
- **Create** `src/components/BudgetTracker.tsx` — the rebuilt sectioned budget (moved out of `EventPlanningPage.tsx`).
- **Modify** `src/lib/db.ts` — extend `PlanningBudget` / `BudgetLineTracker`; extend the `getEventPlanning` budget select + mapping; add category + line CRUD; vendor resolution; `getVendorUsage` rewrite; `CaptureHome` change; `getEventCardMeta` select cleanup.
- **Modify** `src/components/EventPlanningPage.tsx` — delete `VendorDecisions`/`DecisionCard`/`VendorCardModal` + old inline `BudgetTracker`; import the new one; remove the Vendors sub-tab; clean `AutoUpdates`; re-derive the `completenessFields` vendors gap.

---

## Task 1: Migration + backfill

**Files:**
- Create: `supabase/migrations/20260730000000_budget_sectioned.sql`

**Interfaces:**
- Produces: `budget.categories jsonb`, `budget_line.category_id text`, `budget_line.vendor_id text`, `budget_line.vendor_name text`; backfilled categorized rows from `engagement`/`engagement_candidate`; `slack_capture.home 'vendor' → 'budget'`.

- [ ] **Step 1: Write the migration**

```sql
-- Budget becomes the single cost store: optional categories (with an optional estimate) grouping
-- vendor rows, plus loose lines. Vendors demoted from the engagement store into an optional field
-- on a row. Mirrors the deliverables benchmarks pattern (JSONB list + nullable child id).

alter table budget add column if not exists categories jsonb not null default '[]';
alter table budget_line add column if not exists category_id  text;   -- null ⇒ loose line
alter table budget_line add column if not exists vendor_id    text references vendor(id);
alter table budget_line add column if not exists vendor_name  text;   -- denormalized when no vendor row

-- Grants mirror existing budget_line grants (full table-level insert/update/delete already granted;
-- the new columns are covered). categories column is covered by budget's existing grants.

-- ── Backfill: each engagement → a category on its event's budget + a vendor row; each candidate →
-- a sibling Quoted row. Existing budget_line rows stay loose (untouched).
do $$
declare
  e record;
  bid text;
  cat_id text;
  cats jsonb;
  cand record;
begin
  for e in
    select en.id, en.event_id, en.category, en.stage, en.confirmed_amount, en.vendor_id,
           v.name as vendor_name
    from engagement en
    left join vendor v on v.id = en.vendor_id
    where en.event_id is not null
  loop
    -- ensure a budget exists for the event
    select id into bid from budget where event_id = e.event_id limit 1;
    if bid is null then
      bid := 'bud_' || substr(md5(random()::text), 1, 12);
      insert into budget (id, event_id, currency, categories) values (bid, e.event_id, 'USD', '[]');
    end if;

    -- find or create a category (dedupe by case-insensitive name)
    select id from budget where id = bid; -- noop for clarity
    select cats.categories into cats from (select categories from budget where id = bid) cats;
    cat_id := null;
    if e.category is not null and length(trim(e.category)) > 0 then
      select c->>'id' into cat_id
      from jsonb_array_elements((select categories from budget where id = bid)) c
      where lower(c->>'name') = lower(trim(e.category))
      limit 1;
      if cat_id is null then
        cat_id := 'cat_' || substr(md5(random()::text), 1, 12);
        update budget
          set categories = categories || jsonb_build_array(jsonb_build_object(
            'id', cat_id, 'name', trim(e.category), 'estimate', null,
            'order', jsonb_array_length(categories)))
          where id = bid;
      end if;
    end if;

    -- the engagement itself → a vendor row (paid when Contracted/paid, else quoted)
    insert into budget_line (id, budget_id, label, confirmed_amount, payment_status,
                             category_id, vendor_id, vendor_name)
    values ('bl_' || substr(md5(random()::text), 1, 12), bid,
            coalesce(e.vendor_name, e.category, 'Vendor'),
            e.confirmed_amount,
            case when lower(coalesce(e.stage,'')) in ('contracted','paid','delivered') then 'paid' else 'quoted' end,
            cat_id, e.vendor_id, e.vendor_name);

    -- competing candidates → sibling Quoted rows
    for cand in
      select ec.quote_amount, ec.vendor_id, coalesce(vv.name, ec.vendor_name) as vname
      from engagement_candidate ec
      left join vendor vv on vv.id = ec.vendor_id
      where ec.engagement_id = e.id
    loop
      insert into budget_line (id, budget_id, label, confirmed_amount, payment_status,
                               category_id, vendor_id, vendor_name)
      values ('bl_' || substr(md5(random()::text), 1, 12), bid,
              coalesce(cand.vname, 'Quote'), cand.quote_amount, 'quoted',
              cat_id, cand.vendor_id, cand.vname);
    end loop;
  end loop;
end $$;

update slack_capture set home = 'budget' where home = 'vendor';
```

- [ ] **Step 2: Apply locally and verify**

```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -f supabase/migrations/20260730000000_budget_sectioned.sql
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c "\d budget_line" | grep -E "category_id|vendor_id|vendor_name"
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c "select categories from budget where jsonb_array_length(categories) > 0 limit 3;"
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c "select label, payment_status, category_id, vendor_name from budget_line where category_id is not null limit 5;"
```
Expected: the three columns exist; at least the seeded event's engagement categories/rows appear; existing lines still have `category_id = null`.

- [ ] **Step 3: Commit** — `git add supabase/migrations/20260730000000_budget_sectioned.sql && git commit -m "feat(budget): migration — categories JSONB + line category/vendor columns + backfill"`

> **Deploy-parity:** record this migration as needing a manual `psql` apply to prod Cloud SQL before the feature ships.

---

## Task 2: Pure model helpers (`budgetModel.ts`)

**Files:**
- Create: `src/lib/budgetModel.ts`
- Test: `src/lib/budgetModel.test.ts`

**Interfaces:**
- Consumes: `BudgetStatus` from `./db` (type-only import).
- Produces:
  - `type BudgetCategory = { id: string; name: string; estimate: number | null; order: number }`
  - `type HeaderKind = 'actual' | 'estimate' | 'range' | 'empty'`
  - `type CategoryHeader = { kind: HeaderKind; value: number | null; rangeHigh: number | null; estWas: number | null; pendingCount: number }`
  - `categoryHeader(lines: { status: BudgetStatus; amount: number | null }[], estimate: number | null): CategoryHeader`
  - `type Rollup = { estimate: number; quoted: number; paid: number; committed: number }`
  - `budgetRollup(lines: { status: BudgetStatus; amount: number | null }[]): Rollup` — per-row bucketing; `committed = quoted + paid`.

- [ ] **Step 1: Write failing tests** (`src/lib/budgetModel.test.ts`)

```ts
import { describe, it, expect } from "vitest";
import { categoryHeader, budgetRollup } from "./budgetModel";

const L = (status: any, amount: number | null) => ({ status, amount });

describe("categoryHeader ladder", () => {
  it("sums paid rows → actual (green)", () => {
    const h = categoryHeader([L("paid", 300), L("paid", 250), L("quoted", 999)], 500);
    expect(h.kind).toBe("actual");
    expect(h.value).toBe(550);
    expect(h.estWas).toBe(500);          // original estimate persists as a hint
    expect(h.pendingCount).toBe(1);      // the still-quoted row
  });
  it("typed estimate holds over quotes when nothing paid → estimate (grey)", () => {
    const h = categoryHeader([L("quoted", 60), L("quoted", 90)], 600);
    expect(h.kind).toBe("estimate");
    expect(h.value).toBe(600);
    expect(h.estWas).toBeNull();         // not superseded → no "was" hint
  });
  it("no paid, no estimate, quotes → range (amber)", () => {
    const h = categoryHeader([L("quoted", 60), L("quoted", 90)], null);
    expect(h.kind).toBe("range");
    expect(h.value).toBe(60);
    expect(h.rangeHigh).toBe(90);
  });
  it("single quote with no estimate → range collapses to one value", () => {
    const h = categoryHeader([L("quoted", 75)], null);
    expect(h.kind).toBe("range");
    expect(h.value).toBe(75);
    expect(h.rangeHigh).toBe(75);
  });
  it("nothing → empty", () => {
    expect(categoryHeader([], null).kind).toBe("empty");
    expect(categoryHeader([L("estimate", null)], null).kind).toBe("empty");
  });
});

describe("budgetRollup", () => {
  it("buckets each row by its own status; committed = quoted + paid", () => {
    const r = budgetRollup([L("paid", 300), L("quoted", 250), L("estimate", 100), L("paid", 50)]);
    expect(r).toEqual({ estimate: 100, quoted: 250, paid: 350, committed: 600 });
  });
});
```

- [ ] **Step 2: Run to verify fail** — `npx vitest run src/lib/budgetModel.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement `src/lib/budgetModel.ts`**

```ts
import type { BudgetStatus } from "./db";

export type BudgetCategory = { id: string; name: string; estimate: number | null; order: number };
export type HeaderKind = "actual" | "estimate" | "range" | "empty";
export type CategoryHeader = {
  kind: HeaderKind;
  value: number | null;      // actual: paid sum · estimate: the estimate · range: min · empty: null
  rangeHigh: number | null;  // range: max, else null
  estWas: number | null;     // original estimate, only when kind === 'actual' and an estimate existed
  pendingCount: number;      // still-quoted rows when the category also has paid rows
};

type Row = { status: BudgetStatus; amount: number | null };
const amt = (n: number | null | undefined) => (typeof n === "number" && !Number.isNaN(n) ? n : 0);

export function categoryHeader(lines: Row[], estimate: number | null): CategoryHeader {
  const paid = lines.filter((l) => l.status === "paid" && l.amount != null);
  const quotes = lines.filter((l) => l.status === "quoted" && l.amount != null).map((l) => amt(l.amount));
  const hasEstimate = estimate != null;

  if (paid.length > 0) {
    const value = paid.reduce((s, l) => s + amt(l.amount), 0);
    const pendingCount = lines.filter((l) => l.status === "quoted" && l.amount != null).length;
    return { kind: "actual", value, rangeHigh: null, estWas: hasEstimate ? estimate! : null, pendingCount };
  }
  if (hasEstimate) {
    return { kind: "estimate", value: estimate!, rangeHigh: null, estWas: null, pendingCount: 0 };
  }
  if (quotes.length > 0) {
    return { kind: "range", value: Math.min(...quotes), rangeHigh: Math.max(...quotes), estWas: null, pendingCount: 0 };
  }
  return { kind: "empty", value: null, rangeHigh: null, estWas: null, pendingCount: 0 };
}

export type Rollup = { estimate: number; quoted: number; paid: number; committed: number };

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
```

- [ ] **Step 4: Run to verify pass** — `npx vitest run src/lib/budgetModel.test.ts` → PASS.
- [ ] **Step 5: Commit** — `git add src/lib/budgetModel.ts src/lib/budgetModel.test.ts && git commit -m "feat(budget): categoryHeader ladder + status rollup helpers"`

---

## Task 3: db.ts — types, reads, category + line CRUD

**Files:**
- Modify: `src/lib/db.ts` (`BudgetLineTracker` ~2671, `PlanningBudget` ~2682, `getEventPlanning` budget select ~2869 + mapping ~2895, add CRUD near the other budget writers ~2084)

**Interfaces:**
- Consumes: `BudgetCategory` from `./budgetModel`; `BudgetStatus`.
- Produces:
  - `BudgetLineTracker` gains `categoryId: string | null`, `vendorId: string | null`, `vendorName: string | null`.
  - `PlanningBudget` gains `categories: BudgetCategory[]`.
  - `setBudgetCategories(budgetId: string, categories: BudgetCategory[]): Promise<void>`
  - `addBudgetRow(budgetId, input: { label: string; amount: number | null; status: BudgetStatus; categoryId: string | null; vendorId?: string | null; vendorName?: string | null; link?: string | null }): Promise<BudgetLineTracker>`
  - `updateBudgetRow(id, fields: { label?; amount?; status?; categoryId?; vendorId?; vendorName?; link?; note? }): Promise<void>`
  - `deleteBudgetLine(id)` already exists — reuse.

- [ ] **Step 1: Extend the types**

```ts
// BudgetLineTracker — add:
  categoryId: string | null;   // null ⇒ loose line
  vendorId: string | null;     // linked global vendor directory row
  vendorName: string | null;   // denormalized display when no vendor row yet
// PlanningBudget — add:
  categories: import("./budgetModel").BudgetCategory[];
```

- [ ] **Step 2: Extend the `getEventPlanning` budget select + mapping**

At `db.ts:2869`, add `category_id, vendor_id, vendor_name` and `categories` to the select:
```ts
.select('id, currency, target_amount, categories, lines:budget_line ( id, label, confirmed_amount, target, payment_status, sync_url, doc_url, note, linked_engagement, category_id, vendor_id, vendor_name )')
```
In the mapping (~2890) add to the budget object `categories: (b.categories ?? []) as BudgetCategory[]`, and to each line map `categoryId: l.category_id ?? null, vendorId: l.vendor_id ?? null, vendorName: l.vendor_name ?? null`.

- [ ] **Step 3: Add category + row CRUD** (near the existing budget writers, ~`db.ts:2084`)

```ts
export async function setBudgetCategories(budgetId: string, categories: import("./budgetModel").BudgetCategory[]): Promise<void> {
  const { error } = await supabase.from('budget').update({ categories }).eq('id', budgetId);
  if (error) throw error;
}

export async function addBudgetRow(budgetId: string, input: {
  label: string; amount: number | null; status: BudgetStatus;
  categoryId: string | null; vendorId?: string | null; vendorName?: string | null; link?: string | null;
}): Promise<BudgetLineTracker> {
  const id = genId('bl');
  const row = {
    id, budget_id: budgetId, label: input.label,
    confirmed_amount: input.amount, payment_status: input.status,
    category_id: input.categoryId, vendor_id: input.vendorId ?? null,
    vendor_name: input.vendorName ?? null, doc_url: input.link ?? null,
  };
  const { error } = await supabase.from('budget_line').insert(row);
  if (error) throw error;
  return { id, label: input.label, confirmedAmount: input.amount, target: null, status: input.status,
    syncUrl: null, docUrl: input.link ?? null, note: null, linkedEngagement: null,
    categoryId: input.categoryId, vendorId: input.vendorId ?? null, vendorName: input.vendorName ?? null };
}

export async function updateBudgetRow(id: string, fields: {
  label?: string; amount?: number | null; status?: BudgetStatus; categoryId?: string | null;
  vendorId?: string | null; vendorName?: string | null; link?: string | null; note?: string | null;
}): Promise<void> {
  const patch: Record<string, any> = {};
  if ('label' in fields) patch.label = fields.label;
  if ('amount' in fields) patch.confirmed_amount = fields.amount;
  if ('status' in fields) patch.payment_status = fields.status;
  if ('categoryId' in fields) patch.category_id = fields.categoryId;
  if ('vendorId' in fields) patch.vendor_id = fields.vendorId;
  if ('vendorName' in fields) patch.vendor_name = fields.vendorName;
  if ('link' in fields) patch.doc_url = fields.link;
  if ('note' in fields) patch.note = fields.note;
  const { error } = await supabase.from('budget_line').update(patch).eq('id', id);
  if (error) throw error;
}
```
(Use the id-generation helper already used by nearby writers — `genId`/`newId`; match the file's convention.)

- [ ] **Step 4: Typecheck** — `npx tsc --noEmit` → OK.
- [ ] **Step 5: Commit** — `git add src/lib/db.ts && git commit -m "feat(budget): db types + reads + category/row CRUD"`

---

## Task 4: Sectioned `BudgetTracker.tsx` + wiring

**Files:**
- Create: `src/components/BudgetTracker.tsx`
- Modify: `src/components/EventPlanningPage.tsx` (remove the inline `BudgetTracker` ~1056; import the new one; both call sites ~5010/5046 drop the `engagements` prop)

**Interfaces:**
- Consumes: `PlanningBudget`, `setBudgetCategories`, `addBudgetRow`, `updateBudgetRow`, `deleteBudgetLine`, `setEventBudgetTarget` from `../lib/db`; `categoryHeader`, `budgetRollup`, `BudgetCategory` from `../lib/budgetModel`.
- Produces: `export function BudgetTracker({ budget, eventId, eventBudgetTarget }: { budget: PlanningBudget; eventId: string; eventBudgetTarget?: number | null }): JSX.Element`

- [ ] **Step 1: Build the component.** Local `lines` + `categories` state seeded from `budget`, optimistic updates through the CRUD calls. Layout per the spec sketch:
  - **Top tiles**: `budgetRollup(allLines)` → Estimate / Quoted / Paid tiles (reuse `StatCard`), plus vs-target (`eventBudgetTarget ?? budget.targetAmount`) with over/under, editable target field (`id="budget-target-field"`, reuse `setEventBudgetTarget`; keep the id — the "Review budget" flag scrolls to it).
  - **Per category** (sorted by `order`): header row = category name + `categoryHeader(rowsInCat, cat.estimate)` rendered by kind — `actual` green (`$value` + `· est was $X` when `estWas`), `estimate` grey, `range` amber (`$value–$rangeHigh`), `empty` `—`; append `· +N still quoting` when `pendingCount > 0`. An editable estimate field on the header (writes `cat.estimate` via `setBudgetCategories`). Vendor rows beneath: `label` · vendor field (Task 6 upgrades this to the directory combobox; for now a plain text input bound to `vendorName`) · status `<select>` (estimate/quoted/paid) · optional link · amount input. `+ add vendor row` (adds a row with `categoryId = cat.id`).
  - **Loose lines**: rows with `categoryId == null`, same row renderer, under a "loose" divider; `+ add line`.
  - `+ add category` appends `{ id: genId, name, estimate: null, order: categories.length }` via `setBudgetCategories`.
  - Removing a category reassigns its rows to loose (`updateBudgetRow(id, { categoryId: null })`) then drops it from `categories` — never orphan rows.
  - Honest empty state when no categories and no lines.

- [ ] **Step 2: Wire it in.** In `EventPlanningPage.tsx`, delete the inline `BudgetTracker` (~1056–…), add `import { BudgetTracker } from "./BudgetTracker";`, and update both call sites to `<BudgetTracker budget={plan.budget} eventId={eventId} eventBudgetTarget={plan.eventBudgetTarget} />` (drop `engagements`).

- [ ] **Step 3: Typecheck + manual check** — `npx tsc --noEmit` → OK. Manually: a category with two paid rows shows green sum; a typed estimate holds over quotes; a quotes-only category shows an amber range; tiles sum correctly; target over/under works.
- [ ] **Step 4: Commit** — `git add src/components/BudgetTracker.tsx src/components/EventPlanningPage.tsx && git commit -m "feat(budget): sectioned BudgetTracker (categories + rows + loose lines + ladder + tiles)"`

---

## Task 5: Cut the per-event Vendors tab

**Files:**
- Modify: `src/components/EventPlanningPage.tsx` (delete `VendorCardModal` ~365, `DecisionCard` ~504, `VendorDecisions` ~813, `AutoUpdates` engagement use ~1960; remove the Vendors sub-tab entry + its render; `completenessFields` ~2372)
- Modify: `src/lib/db.ts` (`getEventCardMeta` select ~2163 — drop `engagement ( id )`; leave `EngagementView`/engagement fetchers for now since the migration reads them, but stop the UI importing them)

- [ ] **Step 1: Remove the Vendors sub-tab.** Delete the `"vendors"` entry from the event sub-tab list and its `{eventSubTab === "vendors" && …}` render; remove `<VendorDecisions>` usages. Delete the `VendorDecisions`, `DecisionCard`, `VendorCardModal` component definitions and now-unused imports (`suggestVendors` moves to Task 6's row combobox — keep the import if reused there, else drop).
- [ ] **Step 2: Clean `AutoUpdates`.** Remove the `engagements` prop/logic; if the component becomes empty, delete it and its usage.
- [ ] **Step 3: Re-derive the completeness vendors gap.** In `completenessFields` (`db.ts` — the exported helper), change the `vendors` field `present` from `plan.engagements.length > 0` to `plan.budget?.lines.some((l) => (l.vendorName ?? l.vendorId)) ?? false`.
- [ ] **Step 4: Drop `engagement ( id )`** from the `getEventCardMeta` select string.
- [ ] **Step 5: Typecheck** — `npx tsc --noEmit` → OK (fix any remaining references to removed symbols).
- [ ] **Step 6: Commit** — `git add -A && git commit -m "refactor(budget): cut the per-event Vendors tab; completeness reads budget rows"`

---

## Task 6: Vendor field → directory autocomplete + near-match dedup

**Files:**
- Modify: `src/components/BudgetTracker.tsx` (the row's vendor field)
- Modify: `src/lib/db.ts` (add `resolveVendor`)

**Interfaces:**
- Produces: `resolveVendor(name: string, category: string | null): Promise<{ kind: 'exact'; vendor: VendorRow } | { kind: 'near'; matches: VendorRow[] } | { kind: 'new' }>` — exact (case-insensitive name) / near (fuzzy, reuse the existing near-match logic behind `EventPlanningPage`'s `vendorConfirm`) / new. And `createVendor(name, category, link): Promise<VendorRow>`.

- [ ] **Step 1:** Row vendor field becomes a combobox over `suggestVendors(category, location)` results. Picking a suggestion sets `vendorId` + `vendorName` (via `updateBudgetRow`).
- [ ] **Step 2:** On a typed name (blur), call `resolveVendor`: `exact` → set `vendorId` silently; `near` → show a small inline confirm ("'X' looks similar — use it, or create new?") reusing the existing dialog copy; `new` → `createVendor` then set `vendorId`. Store `vendorName` regardless (denormalized display).
- [ ] **Step 3:** Typecheck + manual: typing an existing vendor's exact name links it; a near name prompts; a brand-new name creates a directory entry.
- [ ] **Step 4: Commit** — `git commit -m "feat(budget): row vendor field feeds the directory (autocomplete + near-match dedup)"`

---

## Task 7: `getVendorUsage` from budget rows

**Files:**
- Modify: `src/lib/db.ts` (`getVendorUsage` + `VendorUsage`)

- [ ] **Step 1:** Rewrite `getVendorUsage(vendorId)` to query `budget_line` where `vendor_id = vendorId`, join `budget → event`, return distinct events (name, date, amount, status) — the "used at" list. Drop the engagement-based query.
- [ ] **Step 2:** Verify `VendorsPage` renders usage from the new source (its `getVendorUsage`/`VendorUsage` consumer types unchanged, or adjust the type + the `VendorUsageList` render to match).
- [ ] **Step 3:** Typecheck + manual: a vendor tagged on an event's budget row shows that event under "used at".
- [ ] **Step 4: Commit** — `git commit -m "feat(vendors): directory 'used at' derives from budget rows"`

---

## Task 8: Slack captures → budget rows

**Files:**
- Modify: `src/lib/db.ts` (`CaptureHome` ~2037; capture-accept routing)
- Modify: `src/components/EventPlanningPage.tsx` (`capByHome('vendor')` usages)

- [ ] **Step 1:** Remove `'vendor'` from `CaptureHome`. Where a capture was accepted into a vendor engagement, accept it into a **budget row** instead (`addBudgetRow` with `vendorName`/`categoryId` if the capture carried them; status from the capture's inferred status, default `estimate`).
- [ ] **Step 2:** Remove the `capByHome('vendor')` card group from the Overview; budget captures already render via `capByHome('budget')`. (The migration already moved stored `'vendor'` captures to `'budget'`.)
- [ ] **Step 3:** Typecheck + manual: a proposed budget capture accepts into a budget row.
- [ ] **Step 4: Commit** — `git commit -m "feat(budget): Slack cost captures land as budget rows (drop vendor home)"`

---

## Self-Review notes

- **Spec coverage:** model+layout → T1–T4; ladder+rollup → T2/T4; migration+backfill → T1; directory feed+dedup → T6/T7; Slack → T8; the cut → T5. All spec sections mapped.
- **Type consistency:** `categoryHeader`/`budgetRollup` signatures in T2 match their use in T4; `addBudgetRow`/`updateBudgetRow`/`setBudgetCategories` defined in T3 and consumed in T4/T6/T8; `BudgetCategory` defined once in `budgetModel.ts` and imported everywhere.
- **Wave boundary:** T1–T5 (per-event budget + cut) ship independently of T6–T8 (directory feed + Slack).
