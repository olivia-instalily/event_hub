# Unify the event & series Slack-capture UI

Date: 2026-08-03

## Problem / goal

Slack captures render through two divergent UIs:

- **Event** (`EventPlanningPage`): `OpenNextUp` shows all captures as `SlackCaptureCard`s (confirm / undo /
  edit / move / dismiss), and budget/person captures are *also* surfaced inline under the Budget and
  Staffing cards (`capByHome`). No selection, no bulk actions.
- **Series** (`SeriesOverview`): a "From Slack" panel (unrouted / push-wide) + an "Assigned to events"
  panel, each with **selection, Select-all, bulk + per-card Keep/Discard**, assign-to-event, and a
  source-arrow / corner layout. But **no edit, no move**.

Make them look and behave the same, using the **series UI as the model**. The series gains **edit +
move**; the event gains **selection + everything the series has** (bulk & per-card keep/discard, the
card layout, trash-icon discard, corner source). The event keeps its inline budget/staffing copies,
**kept in sync** with the panel.

## Architecture — one shared component

Extract the series card into a reusable pair (new file `src/components/SlackCard.tsx`):

- **`SlackCard`** — the single card, series-styled: selection checkbox (left) · category chip +
  status badges (top) · summary/detail · **source arrow pinned top-right** · **action cluster
  bottom-right** (keep + trash-discard, tight `gap-0.5`) · inline **edit** (summary/detail) · a
  **move** menu (reclassify home). Actions are passed in, so the same card serves every surface.
- **`SlackCaptureList`** — the panel wrapper: optional **Select-all header + bulk Keep/Discard**, then
  the list of `SlackCard`s. Selection state is owned by the caller and passed down.

Both `SeriesOverview` and the event Overview render these, so the look is identical by construction.
`SlackCaptureCard` (event-only, now redundant) is removed once the event switches over.

### `SlackCard` props (the context seam)
```ts
{
  capture: SlackCapture | SeriesCapture | AssignedCapture; // normalized to a common shape at the call site
  selected?: boolean; onToggleSelect?: () => void;         // omit → no checkbox
  onEdit?: (summary: string, detail: string | null) => Promise<void>;   // inline edit (editSlackCapture)
  onMove?: (home: CaptureHome) => Promise<void>;           // reclassify (setCaptureHome)
  onKeep?: () => Promise<void>;                            // clear card, keep what applied (dismissSlackCapture)
  onDiscard?: () => Promise<void>;                         // reverse + remove (discardCapture) / plain dismiss
  assignTargets?: { id: string; name: string }[];         // series-unrouted only → "assign to:" chips
  onAssign?: (eventId: string) => Promise<void>;
  onResolve?: () => void;                                  // event-held budget collision → open merge
  sourceRef?: string | null;
  badge?: ReactNode;                                       // e.g. push-wide / no-event-matched / ✓ applied
}
```
Only the handlers a surface supplies get rendered — one card, many contexts.

## Series changes

- Series "From Slack" and "Assigned to events" cards render via `SlackCard`, now with **edit** and
  **move** available (below the card), plus the existing assign / keep / discard / selection.
- No behavior change to assign (`assignSeriesCapture`), keep (`dismissSlackCapture`), or discard
  (`discardCapture`).

## Event changes

- `OpenNextUp`'s "From Slack" block is replaced by `SlackCaptureList` (series-style): **selection,
  Select-all, bulk Keep/Discard, per-card keep/discard, edit, move, corner layout**. The Setup-flags
  block above it is unchanged.
- **Keep/discard semantics** (event captures auto-apply): **Keep** = clear the card, keep what it
  applied (budget line / staff role stays) = `dismissSlackCapture`. **Discard** = reverse it
  (`discardCapture` deletes the created line / removes the role) then remove. Same as the series
  "Assigned" cards.
- **Held captures** (budget figure colliding with an existing line — `flags.conflict`, or
  `flags.ambiguity`) show a small **Resolve** action that opens today's merge modal
  (`budgetChoice`); the auto-apply path is unchanged.
- **Terminology** aligns to the series: **keep / discard** (retire "confirm / dismiss" wording).
  Bulk "Confirm all" is replaced by the selection + bulk keep/discard set.

## Inline copies, kept in sync

- The Budget/Staffing inline surfacings (`capByHome('budget')` / `capByHome('person')`) keep showing,
  but each renders with the **same `SlackCard`** and the **same handlers** (keep/discard/edit/move),
  wired to `reloadCaptures`.
- Sync is structural: both the panel and the inline copies read the one `captures` state array and
  every action calls `reloadCaptures()` (a refetch). A keep/discard/edit/move on either surface
  updates the same capture id and both re-render consistently. No separate sync code needed — just a
  single shared state + reload on every action.

## Data / handlers (all exist today)

- `editSlackCapture(id, {summary, detail})` — edit. `setCaptureHome(id, home)` — move.
- `dismissSlackCapture(id)` — keep (clear). `discardCapture({id, eventId, undo})` — discard (reverse
  + remove). `assignSeriesCapture(capId, eventId)` — series assign.
- Event held/merge: existing `promoteAndConfirm` / `budgetChoice` merge flow, reused behind `onResolve`.

## Testing

- Mostly manual (UI): series cards gain edit/move; event shows the series-style panel with selection
  + bulk/per-card keep/discard; a keep/discard on the event panel reflects in the inline
  budget/staffing copy and vice-versa; held budget captures still open the merge.
- Any pure helper extracted (e.g. normalizing the three capture shapes into `SlackCard`'s props) gets
  a small unit test.

## Out of scope

- The extraction / scrape engine and what auto-applies (budget→line, person→role) — unchanged.
- Giving "open"/"plan" captures a persistent destination (separate open question).
- The series' cross-event snapshot (budget rollup / staffing / learnings) below the capture panels.

## Notes

- This is the concurrent Slack session's area (`SeriesOverview`, `SlackCaptureCard`, the event
  Overview). Keep commits scoped to these changes; strip/preserve any unrelated uncommitted work in
  shared files (e.g. `BudgetTracker`'s `slackRef`) as before.
