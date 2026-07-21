# Series Budget tab — design

**Status:** Approved design (2026-07-21)
**Replaces:** the thin rate-only Budget tab (member-budget sum + travel/accommodation rate lines).
**Scope:** productize the real budget tracker as the series Budget tab — a line-item budget split into
Paid/committed and Estimated (each subtotaled), rate helpers that generate estimate lines, and a
pending-decisions list for known-but-unsized costs. Estimate-only; never touches committed spend.

## Goals

- Show **Paid/committed** as a read of member events' committed spend (the series aggregates money; it
  doesn't own it).
- Show **Estimated** as blue line items — manual lines plus rate-generated travel/hotel lines — each
  with a detail (the "why") and subtotaled.
- **Rate helpers** (travel/traveler, accommodation/night) generate the travel + hotel estimate lines
  live from People-tab data.
- **Not yet included** — an honest list of known-but-unsized costs, excluded from the total.
- **Total** = Paid + Estimated, shown with the split. Pending never counted.
- Per-series **currency** (default CAD).

## Non-goals (deferred)

Promote-pending-to-line, multi-currency conversion, budget-vs-actual variance (this is planning, not
tracking), export.

## Data model — `event_series.extras.campaign` (jsonb, no migration)

Extend `Campaign` (in `src/lib/campaign.ts`) and `normalizeCampaign`:

```ts
interface Campaign {
  // …existing (drive, waves, people, anchorEventIds, travelRatePerWave, accommodationRatePerNight)…
  currency: string;            // ISO-ish code, default "CAD"; per-series
  estimatedLines: EstimatedLine[];   // MANUAL lines only (see "auto lines" below)
  pendingItems: string[];      // free-text known-but-unsized costs
}
interface EstimatedLine { id: string; item: string; detail: string; amount: number; }
```

- `normalizeCampaign` defaults: `currency: "CAD"`, `estimatedLines: []`, `pendingItems: []`.
- **Auto lines are NOT stored.** The travel + hotel lines are derived live from `travelRatePerWave` /
  `accommodationRatePerNight` × People-tab data at render time and rendered inside the Estimated block
  marked "auto". Storing them would drift when travelers/nights change; deriving them keeps them
  honest. `estimatedLines` therefore holds only hand-set lines.

## The four blocks (`SeriesBudget.tsx`)

### 1. Paid / committed (read-only)
- New `db.ts` helper `getSeriesCommittedTotals(seriesId): Promise<{ eventId; name; currency; committed }[]>`
  — for each member event, the sum of its **non-`estimate`** `budget_line.confirmed_amount` (i.e.
  committed/paid), plus that event's budget currency.
- One row per member event with committed > 0: event name (detail) + committed amount. Subtotaled.
- **Currency-mismatch flag:** if a member event's budget currency ≠ the series currency, flag that row
  (e.g. a warning chip) and do NOT fold it into the series subtotal silently. Conversion deferred.
- Read-only: nothing here writes to any event budget.

### 2. Estimated (blue)
- **Manual lines** (`campaign.estimatedLines`): item · detail · amount, editable; "+ add estimated
  line"; delete per line. Rendered blue (the "estimate to refine" convention).
- **Auto lines** (derived, marked "auto"): a travel line and an accommodation line computed from the
  rate helpers × People data (see block 3). Amount not directly editable (edit the rate); can be
  effectively removed by clearing its rate. Rendered blue + an "auto" tag.
- Subtotal = manual amounts + auto amounts.

### 3. Rate helpers (feed the Estimated auto lines)
- Two compact inputs: **travel rate / traveler**, **accommodation rate / night**
  (`campaign.travelRatePerWave` — per-traveler-per-wave — and `campaign.accommodationRatePerNight`).
- Travel auto line = `travelEstimate(campaign)` (flyers per wave × rate; locals $0).
- Hotel auto line = `accommodationEstimate(campaign, eventDates).cost` (traveler-nights × rate; locals
  $0). Travelers/nights come from the People tab (`crewTravelCounts` / `personNights`) — same source
  as the presence viz.
- Editing a rate updates its auto line live (no refresh button). Rate 0 / no travelers → the auto line
  shows $0 (or is hidden), never an error.

### 4. Not yet included (pending decisions)
- Free-text list of `campaign.pendingItems`: "+ add pending item", remove per item.
- Surfaced so they aren't forgotten; **explicitly excluded from the total** (unsized by definition).
- Do not fabricate amounts for these.

## Total
- `Total = Paid subtotal + Estimated subtotal`, shown with the split: `$X committed · $Y estimated`.
- Currency-formatted using the series `currency` (e.g. "CA$" / "$… CAD"). Pending items never counted.
- Empty state: no committed spend, no lines, no rates → show "—", not "$0".

## Rules / invariants
- **Estimate-only, never touches committed spend.** Nothing on this tab writes to any event's
  committed/assigned budget. The banner says it; the code enforces it (only writes to `extras.campaign`).
- **Paid is a read, not a write** — reflects member events' committed costs; no money is committed at
  the series level.
- **Per-line estimate flag** (blue) is per-line, not blanket.
- **Rate helpers generate, don't replace** — they produce derived lines the user can influence via the
  rate; hand-set lines are separate and authoritative for their own amount.
- **Honest pending list** — no fabricated amounts.
- **No double-counting** — a cost is either committed on an event (shows under Paid) or a series-level
  estimated line, not both. The UI separation makes this the user's discipline; note it in copy.

## Currency
- `campaign.currency` (default "CAD"), per-series. Formatting helper takes the currency. Member-event
  budgets in a different currency are flagged, not converted (deferred).

## Edges
- Paid double-counting → separation + copy note (above).
- Generated-line drift → eliminated by deriving auto lines live (not storing them).
- Rate 0 / no travelers → auto line $0 or hidden, no error.
- Currency mixing → flag mismatched member-event rows; don't silently sum.
- Pending items sitting forever → fine; it's a checklist.

## Components / files
- Modify: `src/lib/campaign.ts` — add `currency`/`estimatedLines`/`pendingItems` to `Campaign` +
  `normalizeCampaign`; a currency-format helper; reuse existing `travelEstimate` / `accommodationEstimate`
  / `memberBudgetTotal`. Add an `estimatedSubtotal(manualLines, autoTravel, autoHotel)` helper if useful.
- Modify: `src/lib/db.ts` — add `getSeriesCommittedTotals(seriesId)` (per-event committed sum +
  currency, reading `budget_line` non-`estimate` `confirmed_amount`).
- Rewrite: `src/components/SeriesBudget.tsx` — the four blocks + total split.

## Testing
- Pure logic in `campaign.test.ts`: auto-line amounts (travel/hotel, locals $0, rate 0/null), estimated
  subtotal (manual + auto), total split, currency default in `normalizeCampaign`, pending excluded.
- `getSeriesCommittedTotals` verified by `tsc` + manual (no committed-budget test fixture in the repo).

## Deploy parity
- Frontend + `db.ts` only (campaign data via PostgREST as `authenticated`; `extras` on the already-
  granted `event_series`; committed budgets read from already-granted `budget`/`budget_line`). No
  migration, no cloud function. Ships via the SPA build on push.
