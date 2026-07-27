# Onboarding flow redesign — no forced setup page, engagement flags instead

Date: 2026-07-27

## Problem

After creating an event, the user is forced through a full-page `EventSetup` gate
(`EventSetup.tsx`, rendered instead of the event when `!setupComplete`) before they
can reach the actual event page. It bundles three steps — confirm essentials, review
budget, check timeline — behind a wizard. The user wants to land on the real event
immediately and have those concerns surface as dismissible amber "flags" on the event
page itself, cleared by minimal engagement or a manual settle. They also want the
create button to be more prominent, and headcount/owners split out as their own flags.

## Goals

1. Make the create button prominent (not the light secondary style).
2. Land on the real event page after creation — no forced setup gate.
3. Preserve the two head-start helpers from the setup page by moving them into the
   tabs where the user now lands.
4. Surface setup concerns as amber flags on the event Overview, each auto-clearing on
   engagement and manually settle-able.

---

## Part 1 — Prominent create button

`EventsPage.tsx:1507` — the create action is `<Button variant="secondary">` (label
"Skip & create event" / "Create event"), which renders light `bg-secondary`. Drop the
`variant` prop so it uses the default dark `bg-primary` style. No other change.

## Part 2 — Remove the forced setup gate

`EventPlanningPage.tsx:4524-4526` currently renders `<EventSetup>` for the overview
tab whenever `!plan.setupComplete && !wrapped && !pastByDate`. Change it so the overview
tab **always** renders `<Overview>`. New events land directly on the event page.
`setupComplete` no longer gates routing.

## Part 3 — Move the two head-start helpers into the tabs, then delete EventSetup

`EventSetup.tsx` has two assists that exist nowhere else. Port each into the tab the
matching flag jumps to, then delete `EventSetup.tsx` (it becomes unreachable).

- **Budget projections** — `BudgetStep` (`EventSetup.tsx:213-361`) shows "projected
  from comparable past events" (`getBudgetProjections`) with editable per-category
  targets and drop-to-fill import. Port this into the **Budget tab** (`BudgetTracker`)
  as a section shown when the event has few/no targets set (a head-start block), so the
  projection prefill survives.
- **Suggested deliverables** — `TimelineStep` (`EventSetup.tsx:364-437`) offers a
  one-click tentative-deliverables list (`TENTATIVE_DELIVERABLES`) that seeds the
  timeline with guessed due dates. Port this into the **Deliverables tab** as a
  "suggested deliverables" add-list.

After porting, delete `EventSetup.tsx` and its render branch. Keep `saveSetupState`
and `setupProgress` (reused by Part 4).

## Part 4 — Engagement flags on the event Overview

In `Overview` (`EventPlanningPage.tsx`, next to the existing scoping nag at `:3893`),
render a stack of amber flags using the same card pattern
(`rounded-xl border border-amber-200 bg-amber-50` + `AlertCircle`). Each flag has a
**"Go"** button (jumps to where the field is edited) and a **settle checkmark**
(persistently dismisses it).

| Flag | Auto-clears when | "Go" jumps to |
|---|---|---|
| Set the event date | `plan.date` is set | header (date field) — scroll to top |
| Add expected headcount | `plan.headcount != null` | header (headcount) — scroll to top |
| Add owners | `plan.owners.length >= 2` (a co-owner beyond the auto-added creator) | header (owner picker) — scroll to top |
| Review budget | `plan.eventBudgetTarget != null` OR any `plan.budget.lines[]` has `target != null` or `confirmedAmount != null` | Budget tab (`onOpenBudget`) |
| Check timeline | `plan.deliverables.length > 0` | Deliverables tab (`onOpenTimeline`, new) |

**Visibility rule:** a flag is shown when `!autoCleared && !settled`. `settled` means
its key is present in `plan.setupProgress`.

**Settle mechanism:** the checkmark calls
`saveSetupState(eventId, [...plan.setupProgress, key], plan.setupComplete)` and
optimistically updates `plan` via `setPlan`, so the flag disappears immediately and
stays gone. Keys: `"date" | "headcount" | "owners" | "budget" | "timeline"`
(a superset of the legacy `essentials/budget/timeline`; legacy keys are harmless).

**Jump wiring:** `Overview` already receives `onOpenBudget` (→ `setTab("budget")`) and
`onOpenDeliverable`. Add an `onOpenTimeline` prop wired to `setTab("deliverables")` at
the call site (`:4525`). Date/headcount/owners live in the always-visible header above
the tabs, so their "Go" scrolls the window to the top
(`window.scrollTo({ top: 0, behavior: "smooth" })`).

## Part 5 — Creator is automatically an owner (verify)

Already implemented: `assignOwner` (`EventsPage.tsx:719`) adds the creating profile
(`current?.id`) as an owner on every planning-create path — manual create (`:1028`) and
the two brief/ingest paths (`:1090`, `:1130`), preferring a matched brief owner when
present. **No new code needed; verify it fires on the paths that lead to the new flags.**
This is why the "Add owners" flag auto-clears at `>= 2` owners rather than `>= 1`: the
creator is always the first owner, so the flag nudges toward adding a co-owner.

---

## State / data

- `plan.setupProgress: string[]` — reused as the settled-flags set with the five keys
  above. Persisted via `saveSetupState(eventId, keys, complete)` (unchanged signature).
- All engagement signals already exist on `EventPlanning`: `date`, `headcount`,
  `owners`, `eventBudgetTarget`, `budget.lines[]`, `deliverables`.

## Testing

- Pure helper for flag state: `flagState(plan)` → which of the five flags are visible,
  given engagement + `setupProgress`. Unit-test each auto-clear condition and the
  settle-hides-it behavior (node env, `.test.ts`).
- Porting the budget/deliverable helpers is UI — verify manually.

## Out of scope

- Luma attach as its own flag (stays optional in the header).
- External events (they use a different creation path and don't show these flags).
- Any change to `saveSetupState`'s signature or the `setup_complete` column.

## Open / assumptions

- "Add owners" auto-clears at `>= 2` owners (creator + one). Confirmed with user.
- Budget/timeline head-start helpers are shown in their tabs as a dismissible/inline
  section rather than a modal; exact placement decided during implementation to match
  each tab's layout.
