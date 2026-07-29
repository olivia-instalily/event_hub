# Vendors: category · supplier · description (editable, reusable)

Date: 2026-07-29
Sub-project **A** of the "settled events + vendors" work (B = unify settled record; C = cross-event vendor browse).

## Problem / goal

A vendor decision today shows its `engagement.category` as a read-only heading, and that field
often ends up holding the wrong thing — e.g. a vendor titled **"Eli Zabar (bagels etc.)"** when it
should be the reusable category **"Catering"**, with the specific supplier and context recorded
separately. There's also no way to rename a vendor's title after creation.

Give every vendor decision a clean three-part shape and make it editable, so the same category is
reused across events (setting up cross-event browse in sub-project C):

- **Category** — "Catering". The grouping key, reused across events.
- **Supplier** — "Eli Zabar". The specific provider.
- **Description** — "breakfast". Optional context, so future breakfast planning can scan the
  Catering category for suppliers used for that.

## Data model (no migration — reuse existing columns)

| Field | Column | Notes |
|---|---|---|
| Category | `engagement.category` | already the heading; becomes editable |
| Supplier | selected `engagement_candidate.vendor_name` | the candidate with `is_selected = true` |
| Description | `engagement.note` | per-use context (this event's use of this supplier) |

**Description scope = per-engagement** (this event's use), not attached to the global vendor. Eli
Zabar might be "breakfast" at one event and "dinner" at another; per-use keeps that accurate. C will
aggregate these across events for browsing.

## New db helpers (`src/lib/db.ts`)

- `setEngagementCategory(id: string, category: string): Promise<void>` — updates
  `engagement.category`. **Side effect:** if this engagement has a mirrored budget line (matched by
  `budget_line.linked_engagement = id`, or failing that by the prior category label — resolve exact
  mechanism in the plan), re-label that line to the new category so the Budget tab stays consistent.
  Renames **only this engagement** (not a global rename of every engagement sharing the old category).
- `setEngagementNote(id: string, note: string | null): Promise<void>` — updates `engagement.note`
  (the description).
- `listEngagementCategories(): Promise<string[]>` — distinct, non-null, trimmed `engagement.category`
  values across all engagements, case-insensitively de-duplicated, sorted alphabetically. Feeds the
  combobox. (Supplier editing reuses the existing `updateCandidate`.)

## UX — `DecisionCard` (src/components/EventPlanningPage.tsx:496)

- **Category** heading (currently `<p>{eng.category ?? "Uncategorized"}</p>`) becomes an inline
  **combobox**: click to edit → a text input filters a dropdown of `listEngagementCategories()`
  results; existing categories listed first; a "Create '<typed>'" row creates a new category.
  Selecting/creating calls `setEngagementCategory`. This is the "consider them together" mechanism —
  it steers toward reusing "Catering" instead of fragmenting into "catering" / "Eli Zabar catering".
- **Supplier** — the selected candidate's name renders inline-editable; commit calls
  `updateCandidate(candidateId, { vendorName })`. (If no candidate is selected yet, this row is the
  existing candidate UI — unchanged.)
- **Description** — a small line under the supplier. When empty, a subtle **"+ add description"**;
  when present, the text with click-to-edit. Commit calls `setEngagementNote`. Optional; empty
  recedes (no hollow field).

## Scope boundaries (explicitly NOT in A)

- **Cross-event vendor browse** ("find past caterers used for breakfast") — sub-project **C**. A only
  makes the data clean/editable so C has good inputs (`getVendorUsage` already exists for C).
- **Global category rename** (rename "Catering" everywhere at once) — out; A renames per-engagement.
- **Slack vendor-extraction field mapping** (emitting category/supplier/description directly from a
  pin) — related follow-up; A lets the user correct any mis-titling in-app regardless.
- **Supplier-as-reusable-combobox** (past-supplier autocomplete) — considered, deferred; supplier
  stays free-text edit for now.

## Testing

- Unit: `listEngagementCategories` — de-dupes case-insensitively, trims, sorts, drops nulls/blanks.
- Manual: rename a category via the combobox → heading updates AND the mirrored budget line re-labels;
  pick an existing category from the dropdown; create a new category; edit a supplier name; add and
  later clear a description; confirm an empty description shows only the "+ add description" affordance.

## Deploy parity

No migration — frontend (`DecisionCard`) + `db.ts` only, which auto-deploys on push to `main`. Per
the standing "no auto-deploy" rule, nothing ships until explicitly approved.
