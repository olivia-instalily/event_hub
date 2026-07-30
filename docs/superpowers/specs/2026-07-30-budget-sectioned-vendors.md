# Budget — sectioned model, vendors demoted into rows

Date: 2026-07-30

## Problem / goal

The budget lived in two independent stores: a per-event **Vendors tab** (`engagement` →
`engagement_candidate`, categories with competing vendor quotes) and a separate flat **Budget tab**
(`budget` → `budget_line`), tied together only weakly by `budget_line.linked_engagement`. A single
cost could live in two places and the flow was unclear.

Collapse to **one store**: the budget. Vendors are demoted from a parallel concept to an optional
field on a budget row. The per-event Vendors tab is cut. The cross-event vendor **directory**
(`VendorsPage` over the global `vendor` table) stays, now fed from tagged budget rows.

## The structure — three levels, two optional

- **Category (section)** — the need / grouping (Venue, Catering, Bar). OPTIONAL. Carries an OPTIONAL
  header-level estimate. Groups vendor rows.
- **Vendor row** — a cost under a category. Fields: `label` (the cost item, e.g. "Bartender",
  "Bagels") · optional **vendor** (supplier name, links to the directory) · **status** (Estimate /
  Quoted / Paid) · optional **link** · **amount**.
- **Loose line** — a row with NO category, at the top level (e.g. "Marketing $400"). Same fields; can
  itself carry an optional vendor + status + amount.

A budget is a free mix of categorized groups and loose lines. Same optional-structure discipline as
deliverables (phase required, benchmark optional).

## Data model

Mirrors the shipped deliverables pattern (`event.benchmarks` JSONB + `deliverable.benchmark_id`).

- **`budget.categories`** — new JSONB, `[{ id, name, estimate: number|null, order }]`. The optional
  grouping + optional header estimate. Default `[]`.
- **`budget_line`** — new columns:
  - `category_id text` (nullable → a **loose line**). References a category id in `budget.categories`
    (not an FK — JSONB, like `deliverable.benchmark_id`).
  - `vendor_id text references vendor(id)` (nullable) — link to the global directory.
  - `vendor_name text` (nullable) — denormalized display when there is no directory row yet.
  - Reuse existing `doc_url` as the row's optional **link**.
  - Keeps: `label` (cost item), `confirmed_amount` (the amount), `payment_status`
    (`estimate` | `quoted` | `paid`).
  - Legacy `estimated_amount`, `linked_engagement`, `is_uncategorized` are left in place but unused by
    the new UI (`is_uncategorized` is subsumed by `category_id IS NULL`).
- The **category header number is computed, never stored** (the ladder below).

Status vocabulary already exists: `BUDGET_STATUSES = ['estimate', 'quoted', 'paid']` (`db.ts`).

## Category header — precedence ladder

Pure function `categoryHeader(lines, estimate) → { value, kind, estWas, pendingCount }`. Top match wins:

1. **Any Paid rows** → `value` = **sum of the paid rows**, `kind = 'actual'` (green). Multiple paid
   rows sum (bartender $300 + liquor $250 = $550).
2. **No paid, estimate typed** → `value` = **the estimate**, `kind = 'estimate'` (grey). A typed
   estimate HOLDS over existing quotes — a quote is information, not a commitment.
3. **No paid, no estimate, quotes exist** → `value` = **range of quoted amounts** (`$min–$max`, or a
   single value if equal), `kind = 'range'` (amber). Range, not average.
4. **Nothing** → `kind = 'empty'`, rendered `—`.

Two hints layered on the header:
- **`estWas`** — when a category is `actual`, its original typed estimate persists as a faint
  `· est was $X` hint (never silently vanishes). Feeds estimate-vs-actual compounding.
- **`pendingCount`** — when a category has SOME paid rows AND some still-quoted rows, surface
  `· +N still quoting` so a partially-paid category (whose header = paid sum only) doesn't read as
  finished.

## Rollup / tiles (extends the current per-event budget header)

Three status tiles — **Estimate / Quoted / Paid** — each summing across all categories AND loose
lines, bucketed **per row by its status** (so a partially-paid category splits correctly across
tiles). Plus **vs-target**: committed total (paid + still-committed, matching today's rollup
semantics) against the event budget target, with an over/under flag. Empty event → honest empty
budget, no zero-scaffold.

## Cross-event vendor directory (`VendorsPage` stays)

- A row's vendor field is a **combobox autocompleting against the global `vendor` directory** (reuse
  `suggestVendors`). Picking an existing vendor sets `vendor_id` directly.
- Typing a **new** name, on save:
  - **exact match** (case-insensitive) → link silently.
  - **near match** → reuse the existing near-match confirm dialog ("'X' looks similar to an existing
    vendor — use it, or create new?").
  - **no match** → create a `vendor` row, link it.
- **"Used at" = derived from `budget_line.vendor_id`** (distinct events whose budget rows reference
  the vendor). `getVendorUsage` is rewritten to read budget rows instead of engagements.
- Only rows WITH a vendor touch the directory; empty-vendor rows never create phantom entries.

## Slack captures

- Drop `'vendor'` from `CaptureHome`. A cost capture lands as a **proposed budget row** (home
  `'budget'`): amount is load-bearing; `vendor_name` fills the optional field if extraction caught it;
  `category` sets `category_id` if inferable (else loose line). Status defaults from language
  (paid/ordered → Paid, "getting a quote" → Quoted, a guess → Estimate). Lands proposed, editable in
  place. Existing `'vendor'`-home captures migrate to `'budget'`.

## Migration + backfill (deploy-parity: manual apply to Cloud SQL)

- Add `budget.categories jsonb default '[]'`; add `budget_line.category_id text`,
  `budget_line.vendor_id text references vendor(id)`, `budget_line.vendor_name text`. Grants mirror
  existing `budget_line` grants.
- **Backfill** each `engagement` on an event into that event's budget:
  - Ensure the event has a `budget` row (create if missing).
  - Add a category to `budget.categories` for the engagement's `category` name (dedupe by
    case-insensitive name; reuse an existing one).
  - Insert a `budget_line` for the engagement: `label` = selected vendor / category name,
    `confirmed_amount` = `engagement.confirmed_amount`, `payment_status` from `engagement.stage`
    (`Contracted`/paid → `paid`, else `quoted`), `vendor_id` = `engagement.vendor_id`,
    `category_id` = the category id.
  - Insert each `engagement_candidate` as a sibling **Quoted** `budget_line`
    (`payment_status = 'quoted'`, `confirmed_amount` = `quote_amount`, `vendor_id`/`vendor_name`).
- Existing `budget_line`s stay **loose** (untouched, `category_id` null).
- `engagement` / `engagement_candidate` tables are left **orphaned** (NOT dropped in this migration —
  a follow-up drops them once the new model is verified in prod).
- Migrate `slack_capture.home = 'vendor'` → `'budget'`.

## The cut

- Delete the per-event **Vendors tab** and its components: `VendorDecisions`, `DecisionCard`,
  `VendorCardModal` (`EventPlanningPage.tsx`), and the tab wiring / sub-tab entry.
- Rebuild `BudgetTracker` as the sectioned budget (categories + rows + loose lines + ladder + tiles).
- `AutoUpdates` (reads engagements) and the `getEventCardMeta` select's `engagement ( id )` are
  cleaned up to stop depending on engagements.
- `completenessFields` "vendors" gap re-derives from budget rows that carry a vendor (instead of
  `plan.engagements.length`).
- The other session's committed `engagement_candidate` status refactor (`CANDIDATE_STATUSES`,
  `contracted → paid`) is superseded by the cut and removed where it only served the deleted UI.

## Testing

- Pure helpers get unit tests (node env, `.test.ts`): `categoryHeader()` (all four ladder rungs +
  `estWas` + `pendingCount`), the status rollup (per-row bucketing across categories and loose
  lines), and near-match vendor resolution if extracted as a pure helper.
- Migration verified by applying locally and checking: new columns present; a seeded event's
  engagements became categorized rows; its candidates became sibling Quoted rows; existing lines
  remained loose.
- UI (sectioned layout, header colors, hints, drag/add/edit, directory dedup, Slack capture landing)
  verified manually.

## Sequencing (for the plan)

1. **Per-event sectioned budget + migration** — schema, `categoryHeader`, rollup, the rebuilt
   `BudgetTracker`, cutting the Vendors tab. Self-contained and testable.
2. **Directory feed + Slack rerouting** — `vendor_id` autocomplete/dedup on rows, `getVendorUsage`
   from budget rows, `CaptureHome` change. Builds on wave 1.

## Out of scope

- Dropping the `engagement` / `engagement_candidate` tables (a later cleanup once verified).
- Multi-currency changes; the currency stays per-budget as today.
- Series-level budget categories (this is per-event; `SeriesBudget` unchanged).
- Contracts (`contract` table) — untouched.
