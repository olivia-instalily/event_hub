# Unify event & series Slack-capture UI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** One shared, series-styled Slack-capture card/list used by both the event Overview and the Series Overview — series gains edit+move, event gains selection + bulk/per-card keep/discard — with the event's inline budget/staffing copies kept in sync.

**Architecture:** Extract `SlackCard` + `SlackCaptureList` (`src/components/SlackCard.tsx`) from the series design; drive per-surface behavior through props. `SeriesOverview` and the event `OpenNextUp`/inline surfacings render them. `SlackCaptureCard.tsx` (event-only) is retired. Sync is structural: one `captures` state + `reloadCaptures()` on every action.

**Tech Stack:** React + TypeScript + Tailwind; lucide icons; existing db helpers.

## Global Constraints

- Series UI is the visual model; both surfaces must look identical (same `SlackCard`).
- Terminology: **keep / discard** everywhere (retire "confirm / dismiss").
- **Keep** = clear card, keep what applied (`dismissSlackCapture`). **Discard** = reverse + remove (`discardCapture`).
- Card layout: checkbox left · chip + badges top · summary/detail · **source arrow top-right** · **keep + trash-discard bottom-right, `gap-0.5`** · inline edit · move menu.
- Move = reclassify home via `setCaptureHome`; homes: `person | budget | open | plan`.
- Event inline copies (`capByHome`) + the panel read one `captures` array; every action calls `reloadCaptures()`.
- Reuse existing db helpers only; do NOT change extraction/scrape or what auto-applies.
- Concurrent-session area: commit only these files; strip/preserve unrelated uncommitted work in shared files (e.g. `BudgetTracker` `slackRef`).

---

## File Structure

- **Create** `src/components/SlackCard.tsx` — `SlackCard` (unified card) + `SlackCaptureList` (panel wrapper with select-all + bulk keep/discard).
- **Modify** `src/components/SeriesOverview.tsx` — render via `SlackCard`/`SlackCaptureList`; add edit + move handlers.
- **Modify** `src/components/EventPlanningPage.tsx` — `OpenNextUp` from-Slack block → `SlackCaptureList`; inline `capByHome` → `SlackCard`; add keep/discard handlers; `resolve` for held; retire confirm/dismiss wording.
- **Delete** `src/components/SlackCaptureCard.tsx` — once the event no longer imports it.

---

## Task 1: `SlackCard` + `SlackCaptureList`

**Files:**
- Create: `src/components/SlackCard.tsx`

**Interfaces (Produces):**
```ts
export type SlackCardModel = {
  id: string; home: CaptureHome; summary: string; detail: string | null;
  sourceRef: string | null; badge?: ReactNode;
};
export function SlackCard(props: {
  model: SlackCardModel;
  selected?: boolean; onToggleSelect?: () => void;
  onEdit?: (summary: string, detail: string | null) => Promise<void>;
  onMove?: (home: CaptureHome) => Promise<void>;
  onKeep?: () => Promise<void>;
  onDiscard?: () => Promise<void>;
  assignTargets?: { id: string; name: string }[];
  onAssign?: (eventId: string) => Promise<void>;
  onResolve?: () => void;              // held budget collision → merge modal
  tone?: "violet" | "emerald";         // From-Slack vs Assigned styling
}): JSX.Element;
export function SlackCaptureList(props: {
  models: SlackCardModel[];
  selected: Set<string>; onToggle: (id: string) => void; onToggleAll: (on: boolean) => void;
  onBulkKeep?: () => Promise<void>; onBulkDiscard?: () => Promise<void>;
  card: (m: SlackCardModel) => JSX.Element;   // caller supplies a configured SlackCard per model
  emptyText?: string;
}): JSX.Element;
```

**Notes:** `SlackCard` renders only the handlers supplied (checkbox when `onToggleSelect`; assign chips when `assignTargets`; keep/discard cluster when those handlers exist; a small **Resolve** button when `onResolve`; **edit** and **move** whenever `onEdit`/`onMove` exist). Layout matches the current series card: `flex items-stretch gap-2 rounded-lg border … px-3 py-2`, chip via a small `HOME_TAG` map (move `HOME_TAG` here and import from both callers), source arrow + keep/discard in a right column (`flex flex-col items-end justify-between`), edit/move rows appear below on toggle. `SlackCaptureList` renders the select-all row + bulk buttons (only when `onBulkKeep`/`onBulkDiscard` given) then maps `models` through `card`.

- [ ] **Step 1:** Build `SlackCard.tsx` with the two exports above, porting the series card markup (`SeriesOverview.tsx` lines ~97-114 for From-Slack, ~144-157 for Assigned) and folding in `SlackCaptureCard`'s edit (local `editing` state + summary/detail inputs → `onEdit`) and move (`moving` state + `HOME_MOVE` chips → `onMove`). Export `HOME_TAG`.
- [ ] **Step 2:** `npx tsc --noEmit` → clean.
- [ ] **Step 3:** Commit — `git add src/components/SlackCard.tsx && git commit -m "feat(slack): shared SlackCard + SlackCaptureList (series-styled, with edit/move)"`

---

## Task 2: Series uses the shared card (+ edit/move)

**Files:**
- Modify: `src/components/SeriesOverview.tsx`

**Consumes:** `SlackCard`, `SlackCaptureList`, `HOME_TAG` from `./SlackCard`.

- [ ] **Step 1:** Replace the bespoke "From Slack" `<ul>` (lines ~96-115) with `SlackCaptureList` fed `caps` mapped to `SlackCardModel` (badge = push-wide / no-event-matched pill), each card configured with: `onToggleSelect`, `assignTargets={events}` + `onAssign`, `onKeep`? no (unrouted → discard only), `onDiscard={() => discardOne(c.id)}`, **`onEdit`** (`editSlackCapture`), **`onMove`** (`setCaptureHome` + `reloadCaps`). Bulk: `onBulkDiscard={discardFromSlack}`.
- [ ] **Step 2:** Replace the "Assigned to events" `<ul>` (lines ~144-157) with `SlackCard`s (grouped by event as now) configured with `onToggleSelect`, `onKeep={() => keepOne(c.id)}`, `onDiscard={() => discardOneAssigned(c)}`, `onEdit`, `onMove`, `tone="emerald"`, badge = `✓ applied`. Keep the per-event Select-all / bulk keep/discard header (or move into `SlackCaptureList`).
- [ ] **Step 3:** Add `editCap`/`moveCap` handlers: `const editCap = async (id, s, d) => { await editSlackCapture(id, { summary: s, detail: d }); reloadCaps(); }` and `const moveCap = async (id, home) => { await setCaptureHome(id, home); reloadCaps(); }`. Import `editSlackCapture`, `setCaptureHome`.
- [ ] **Step 4:** `npx tsc --noEmit` → clean; manual: series cards now show edit + move; assign/keep/discard/selection unchanged.
- [ ] **Step 5:** Commit — `git commit -m "feat(series): render Slack cards via shared SlackCard; add edit + move"`

---

## Task 3: Event Overview uses the shared panel + selection/keep/discard

**Files:**
- Modify: `src/components/EventPlanningPage.tsx` (`OpenNextUp` ~3364, its call sites ~3289/3318, event handlers ~2955-3130)

**Consumes:** `SlackCard`, `SlackCaptureList` from `./SlackCard`.

- [ ] **Step 1:** Add event keep/discard handlers next to the existing capture handlers:
```ts
const keepCapture = async (c: SlackCapture) => { await dismissSlackCapture(c.id); reloadCaptures(); };
const discardCaptureEvt = async (c: SlackCapture) => { await discardCapture({ id: c.id, eventId, undo: (c.flags as any)?.undo ?? null }); reloadCaptures(); };
const editCaptureEvt = async (c: SlackCapture, s: string, d: string | null) => { await editSlackCapture(c.id, { summary: s, detail: d }); reloadCaptures(); };
```
(import `discardCapture`, `editSlackCapture` in `db` import block.)
- [ ] **Step 2:** Add selection state in `Overview`: `const [capSel, setCapSel] = useState<Set<string>>(new Set());` with toggle/toggle-all/bulk keep+discard over `capSel` (bulk = loop the per-card handlers).
- [ ] **Step 3:** Rewrite `OpenNextUp`'s "From Slack" block to render `<SlackCaptureList>` of all `captures`: each `SlackCard` gets `onToggleSelect`, `onKeep={() => keepCapture(c)}`, `onDiscard={() => discardCaptureEvt(c)}`, `onEdit`, `onMove={(h) => reclassifyCapture(c, h)}`, and `onResolve={() => promoteAndConfirm(c)}` **only when** `capHeld(c)`. Drop the "Confirm all" button (replaced by bulk keep/discard) and the `SlackCaptureCard` import. Keep the Setup-flags block above untouched.
- [ ] **Step 4:** `npx tsc --noEmit` → clean; manual: event "From Slack" now looks like the series panel (selection, bulk + per-card keep/discard, edit, move); held budget captures show **Resolve** → merge modal.
- [ ] **Step 5:** Commit — `git commit -m "feat(event): series-style Slack panel — selection + keep/discard + edit/move"`

---

## Task 4: Inline budget/staffing copies → shared card, synced

**Files:**
- Modify: `src/components/EventPlanningPage.tsx` (the `capByHome('budget')` ~3330 and `capByHome('person')` ~3335 renders)

- [ ] **Step 1:** Replace the inline `<SlackCaptureCard>`s under `ov-budget` / `ov-staffing` with `<SlackCard>` using the same `keepCapture`/`discardCaptureEvt`/`editCaptureEvt`/`reclassifyCapture` handlers (no selection checkbox inline — omit `onToggleSelect`). They read the same `captures`; each handler calls `reloadCaptures`, so an action here updates the panel and vice-versa.
- [ ] **Step 2:** `npx tsc --noEmit` → clean; manual: keep/discard on the panel removes the inline copy too (and vice-versa); edit reflects both places.
- [ ] **Step 3:** Commit — `git commit -m "feat(event): inline budget/staffing Slack copies use shared card, synced with the panel"`

---

## Task 5: Retire `SlackCaptureCard`

**Files:**
- Delete: `src/components/SlackCaptureCard.tsx`
- Modify: `src/components/EventPlanningPage.tsx` (remove its import + any now-unused imports)

- [ ] **Step 1:** Confirm no remaining `SlackCaptureCard` references (`grep -rn SlackCaptureCard src/`); delete the file and its import.
- [ ] **Step 2:** `npx tsc --noEmit` → clean (fix any newly-unused imports flagged by `noUnusedLocals`).
- [ ] **Step 3:** Commit — `git commit -m "refactor(slack): remove SlackCaptureCard (superseded by shared SlackCard)"`

---

## Self-Review notes

- **Spec coverage:** shared component → T1; series edit/move → T2; event selection+keep/discard+layout → T3; inline sync → T4; terminology + cleanup → T3/T5. All spec sections mapped.
- **Type consistency:** `SlackCardModel` + `SlackCard`/`SlackCaptureList` signatures defined in T1 and consumed unchanged in T2-T4; handlers use existing db signatures (`dismissSlackCapture`, `discardCapture`, `editSlackCapture`, `setCaptureHome`, `assignSeriesCapture`).
- **Sync:** guaranteed by shared `captures` state + `reloadCaptures()` in every event handler (T3/T4); no bespoke sync code.
- **Held captures:** `onResolve` gated on `capHeld(c)` reuses `promoteAndConfirm`/`budgetChoice` — no change to auto-apply.
