# Deliverables & timeline: 3 phases · benchmarks · tags

Date: 2026-07-29

## Problem / goal

The deliverables tab and the Overview timeline currently key off a single per-event
`phase` list whose values double as *categories* (Venue, Production, Guests…). That
conflates three different ideas and produces sprawling, inconsistent timelines. Replace
it with a clear three-level model:

- **Phase** — a fixed lifecycle stage. Exactly three, immutable: **Planning → Day-of → Post**.
- **Benchmark** — an optional, user-defined milestone *within* a phase (e.g. "Scoping",
  "Day before" under Planning). Rendered as a smaller, same-color, indented sub-dot on the
  timeline; behaves like a phase node but nested.
- **Tag** — a cross-cutting, descriptive label on a deliverable (Venue, Marketing…). Not
  tied to a phase; used to **filter** the deliverables list.

Deliverables group **Phase → Benchmark** in the list; tags filter across everything.

## Data model

- **Phases are constants**, not per-event data: `PHASES = ["planning", "day-of", "post"]`
  (display labels "Planning" / "Day-of" / "Post"). The timeline always shows exactly these
  three; `event.phases` no longer drives the phase count. (`defaultPhases` already returns
  these three — see the phase-reduction work already shipped.)
- **`event.benchmarks`** — new JSONB column: `[{ id, name, phase, order }]` where `phase`
  is one of the three. The editable per-event layer.
- **`deliverable.phase`** — repurposed to hold one of the three phase keys (today it holds
  the category string).
- **`deliverable.benchmark_id`** — new nullable column referencing a benchmark id (a task
  with none sits directly under its phase).
- **`deliverable.tags`** — new JSONB column, `string[]` (default `[]`).

### Migration + backfill (deploy-parity: manual apply to Cloud SQL)
- Add `benchmarks jsonb` to `event`; add `benchmark_id text` and `tags jsonb default '[]'`
  to `deliverable`. Grants mirror existing columns.
- **Backfill existing deliverables' `phase` from timing only** (no tags/benchmarks added to
  past events — those are optional): relative to the event date, a deliverable that falls
  **before** the event → `planning`, **on the day** → `day-of`, **after** → `post`. Use
  `offset_start` when present (`< 0` → planning, `= 0` → day-of, `> 0` → post), else the
  resolved due date vs event date; undated/unknown → `planning`. The old category value in
  `phase` is discarded (not carried into tags).

## Timeline (Overview)

- Render the **3 phase dots** (Planning / Day-of / Post) from the constant, in order.
- Under each phase, render its **benchmark sub-dots**: smaller, same color as the parent
  phase, visually indented. They behave like phase nodes (selectable views).
- **Click-to-jump:** clicking any dot (phase or benchmark) scrolls the deliverables list to
  that phase/benchmark section (reuse the existing scroll-into-view + brief-highlight pattern).

## Deliverables area

- **Tag filter bar** at the top: one chip per distinct tag present on the event's
  deliverables. **Single-select:** clicking a tag filters the list to it; clicking a
  different tag replaces the selection; clicking the currently-selected tag clears it (back
  to showing all). No tag selected = all shown.
- **Grouping:** top level = the 3 phases; within a phase, tasks group under their
  **benchmark** (header per benchmark); tasks with no benchmark render directly under the
  phase. Empty phases still show (so you can drop into them).
- **Rows re-centered** — fix the title/date/checkbox vertical misalignment (title currently
  sits lower than the date/checkbox).
- **Drag:** dragging a task into another phase or benchmark group reassigns its `phase` and
  `benchmark_id` (persisted). Dragging into a phase's non-benchmark area clears `benchmark_id`.

## Editor: "Edit phases" → "Edit benchmarks"

- Rename the control to **Edit benchmarks**. It adds / renames / removes / reorders
  **benchmarks**, each assigned to one of the 3 phases (a phase picker per benchmark).
- The **3 phases are fixed** — not addable/removable/renamable.
- Removing a benchmark reassigns its deliverables to "no benchmark" under the same phase
  (never orphans them).

## Suggested deliverables

- The tentative list's category becomes a **tag**, and each suggestion is assigned a real
  **phase** (e.g. Book venue → planning; Launch registration / Send invites → planning;
  Run-of-show & day-of staffing → day-of; a debrief suggestion → post). "Add all" still adds
  every remaining suggestion.

## Separate small fix (bundled)

- **Open · next-up vs Where things stand ordering:** make their order consistent across
  views (today the top slot swaps depending on whether anything is open). Fix: keep a stable
  order — Open (when present) always above Where-things-stand.

## Testing

- Pure helpers get unit tests (node env, `.test.ts`): phase-derivation-from-timing (backfill
  logic), tag single-select toggle reducer, benchmark grouping (phase → benchmark → tasks,
  benchmark-less under phase).
- Migration verified by applying locally and checking the new columns + a backfilled event's
  deliverable phases.
- UI (timeline sub-dots, tag bar, editor, drag, jump) verified manually.

## Out of scope
- Tags on anything other than deliverables; multi-select tag filtering.
- Editing/adding phases (fixed at three).
- Carrying old categories into tags for existing events.
- Benchmarks on the deliverable-less template rail (templates keep their own rail for now).
