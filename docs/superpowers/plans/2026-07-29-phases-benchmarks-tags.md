# Phases · Benchmarks · Tags — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure deliverables + the Overview timeline around three immutable phases (Planning / Day-of / Post), optional per-event benchmarks within a phase, and cross-cutting tags that filter the list.

**Architecture:** Phases become a constant (not per-event data). Benchmarks live in a new `event.benchmarks` JSONB. Deliverables get `benchmark_id` + `tags`, and their `phase` is repurposed from category → one of the three phase keys. The deliverables list groups Phase → Benchmark with a single-select tag filter bar; the timeline shows 3 phase dots + indented benchmark sub-dots that scroll to their list section.

**Tech Stack:** React + TypeScript, Supabase/PostgREST (`src/lib/db.ts`), Vitest (node env — pure `.test.ts` only, no RTL).

## Global Constraints

- Three immutable phase keys, in order: `"planning"`, `"day-of"`, `"post"` — labels `Planning` / `Day-of` / `Post`. Never editable/addable.
- Tests run in the **node** environment; only pure `.test.ts` logic is tested. UI verified manually.
- Tag filter is **single-select**: click a tag → filter to it; click another → replace; click the selected one → clear (show all).
- Backfill sets existing deliverables' `phase` from timing only (before→`planning`, on-day→`day-of`, after→`post`); old category discarded, no tags/benchmarks added to past events.
- **Deploy parity:** the migration (Task 1) must be applied to prod Cloud SQL manually — it does NOT ride the Cloud Run deploy. All other tasks are app code.
- Column grants mirror existing deliverable/event columns: `GRANT ... ON <table> TO anon, authenticated;`

---

### Task 1: Migration — benchmarks / benchmark_id / tags + phase backfill

**Files:**
- Create: `supabase/migrations/20260729000000_phases_benchmarks_tags.sql`

**Interfaces:**
- Produces: `event.benchmarks jsonb` (default `[]`), `deliverable.benchmark_id text` (nullable), `deliverable.tags jsonb` (default `[]`); every existing `deliverable.phase` set to one of `planning|day-of|post`.

- [ ] **Step 1: Write the migration**

```sql
-- Three-phase model: benchmarks (optional, per-event) + cross-cutting deliverable tags.
ALTER TABLE event ADD COLUMN IF NOT EXISTS benchmarks jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE deliverable ADD COLUMN IF NOT EXISTS benchmark_id text;
ALTER TABLE deliverable ADD COLUMN IF NOT EXISTS tags jsonb NOT NULL DEFAULT '[]'::jsonb;
GRANT UPDATE (benchmarks) ON event TO anon, authenticated;
GRANT UPDATE (benchmark_id, tags) ON deliverable TO anon, authenticated;

-- Backfill: collapse every existing deliverable's phase to planning/day-of/post by timing.
UPDATE deliverable d SET phase = CASE
  WHEN d.offset_start IS NOT NULL AND d.offset_start < 0 THEN 'planning'
  WHEN d.offset_start IS NOT NULL AND d.offset_start = 0 THEN 'day-of'
  WHEN d.offset_start IS NOT NULL AND d.offset_start > 0 THEN 'post'
  WHEN e.event_date IS NOT NULL AND d.resolved_due_date IS NOT NULL AND d.resolved_due_date < e.event_date THEN 'planning'
  WHEN e.event_date IS NOT NULL AND d.resolved_due_date IS NOT NULL AND d.resolved_due_date = e.event_date THEN 'day-of'
  WHEN e.event_date IS NOT NULL AND d.resolved_due_date IS NOT NULL AND d.resolved_due_date > e.event_date THEN 'post'
  ELSE 'planning'
END
FROM event e
WHERE d.event_id = e.id AND e.is_template = false;
```

- [ ] **Step 2: Apply locally + verify**

Run: `supabase db reset` is destructive — instead apply this file: `docker exec -i supabase_db_event_hub psql -U postgres -d postgres < supabase/migrations/20260729000000_phases_benchmarks_tags.sql`
Run: `docker exec supabase_db_event_hub psql -U postgres -d postgres -tAc "select distinct phase from deliverable;"`
Expected: only `planning`, `day-of`, `post` (for non-template events).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260729000000_phases_benchmarks_tags.sql
git commit -m "migration: event.benchmarks + deliverable.benchmark_id/tags + phase backfill"
```

> **DEPLOY PARITY:** apply to prod Cloud SQL manually after merge.

---

### Task 2: Pure helpers — phases, phase-from-timing, tag toggle, grouping

**Files:**
- Create: `src/lib/phases.ts`
- Test: `src/lib/phases.test.ts`

**Interfaces:**
- Produces:
  - `type Phase = "planning" | "day-of" | "post"`
  - `PHASES: Phase[]` = `["planning","day-of","post"]`; `PHASE_LABEL: Record<Phase,string>` = `{planning:"Planning","day-of":"Day-of",post:"Post"}`
  - `phaseForTiming(offsetStart: number | null, dueDate: string | null, eventDate: string | null): Phase`
  - `nextTagSelection(current: string | null, clicked: string): string | null` — single-select toggle.
  - `type Benchmark = { id: string; name: string; phase: Phase; order: number }`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { PHASES, phaseForTiming, nextTagSelection } from "./phases";

describe("phases", () => {
  it("has exactly the three phase keys in order", () => {
    expect(PHASES).toEqual(["planning", "day-of", "post"]);
  });
  it("phaseForTiming uses offset first", () => {
    expect(phaseForTiming(-5, null, "2026-08-01")).toBe("planning");
    expect(phaseForTiming(0, null, "2026-08-01")).toBe("day-of");
    expect(phaseForTiming(3, null, "2026-08-01")).toBe("post");
  });
  it("phaseForTiming falls back to due vs event date", () => {
    expect(phaseForTiming(null, "2026-07-30", "2026-08-01")).toBe("planning");
    expect(phaseForTiming(null, "2026-08-01", "2026-08-01")).toBe("day-of");
    expect(phaseForTiming(null, "2026-08-05", "2026-08-01")).toBe("post");
  });
  it("phaseForTiming defaults to planning when undated/unknown", () => {
    expect(phaseForTiming(null, null, null)).toBe("planning");
  });
  it("nextTagSelection is single-select with deselect", () => {
    expect(nextTagSelection(null, "Venue")).toBe("Venue");   // select
    expect(nextTagSelection("Venue", "Marketing")).toBe("Marketing"); // replace
    expect(nextTagSelection("Venue", "Venue")).toBe(null);   // deselect → all
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/phases.test.ts`
Expected: FAIL — cannot resolve `./phases`.

- [ ] **Step 3: Implement**

```ts
export type Phase = "planning" | "day-of" | "post";
export const PHASES: Phase[] = ["planning", "day-of", "post"];
export const PHASE_LABEL: Record<Phase, string> = { planning: "Planning", "day-of": "Day-of", post: "Post" };

export type Benchmark = { id: string; name: string; phase: Phase; order: number };

/** Which of the three phases a deliverable falls in, by timing: offset first, else due-vs-event date. */
export function phaseForTiming(offsetStart: number | null, dueDate: string | null, eventDate: string | null): Phase {
  if (offsetStart != null) return offsetStart < 0 ? "planning" : offsetStart === 0 ? "day-of" : "post";
  if (eventDate && dueDate) return dueDate < eventDate ? "planning" : dueDate === eventDate ? "day-of" : "post";
  return "planning";
}

/** Single-select tag filter: click a new tag to select it, click the selected one to clear (all). */
export function nextTagSelection(current: string | null, clicked: string): string | null {
  return current === clicked ? null : clicked;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/phases.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/phases.ts src/lib/phases.test.ts
git commit -m "feat(phases): Phase constants + phaseForTiming + tag single-select helper"
```

---

### Task 3: db.ts — types, reads, and write helpers for benchmarks + tags

**Files:**
- Modify: `src/lib/db.ts` — `Deliverable` interface (`~2668`); `EventPlanning` interface (`~2587`); `getEventPlanning` select (`~2719`) + deliverable map (`~2893`) + event benchmarks map; `addDeliverable` (`~3540`); add `setDeliverableBenchmark`, `setDeliverableTags`, `setEventBenchmarks`.

**Interfaces:**
- Consumes: `Phase`, `Benchmark` from `src/lib/phases.ts` (Task 2).
- Produces:
  - `Deliverable` gains `benchmarkId: string | null` and `tags: string[]`.
  - `EventPlanning` gains `benchmarks: Benchmark[]`.
  - `setDeliverableBenchmark(id: string, benchmarkId: string | null): Promise<void>`
  - `setDeliverableTags(id: string, tags: string[]): Promise<void>`
  - `setEventBenchmarks(eventId: string, benchmarks: Benchmark[]): Promise<void>`
  - `addDeliverable` fields gains optional `benchmarkId?: string | null; tags?: string[]`.

- [ ] **Step 1: Extend the Deliverable interface**

In `src/lib/db.ts` `Deliverable` (`~2668`), add after `phase`:
```ts
  benchmarkId: string | null;
  tags: string[];
```
Import `Phase, Benchmark` at the top of db.ts: `import { type Phase, type Benchmark } from "./phases";` (add near the other lib imports).

- [ ] **Step 2: Map the new fields in getEventPlanning**

In the deliverable map (`~2893`), add:
```ts
    benchmarkId: d.benchmark_id ?? null,
    tags: Array.isArray(d.tags) ? d.tags : [],
```
Add `benchmark_id, tags` to the deliverable columns fetched (find the `.from('deliverable').select(...)` used by getEventPlanning and add them). Add `benchmarks` to the event `.select(...)` string, and in the EventPlanning return object add:
```ts
    benchmarks: Array.isArray((row as any).benchmarks) ? (row as any).benchmarks as Benchmark[] : [],
```
Add `benchmarks: Benchmark[];` to the `EventPlanning` interface (`~2587`, next to `deliverables`).

- [ ] **Step 3: Extend addDeliverable + add write helpers**

Change `addDeliverable` (`~3540`) fields type to include `benchmarkId?: string | null; tags?: string[]`, insert `benchmark_id: fields.benchmarkId ?? null, tags: fields.tags ?? []`, and include them in the returned object (`benchmarkId: fields.benchmarkId ?? null, tags: fields.tags ?? []`). Then append:
```ts
/** Move a deliverable to a benchmark within its phase (null = directly under the phase). */
export async function setDeliverableBenchmark(id: string, benchmarkId: string | null): Promise<void> {
  const { error } = await supabase.from('deliverable').update({ benchmark_id: benchmarkId }).eq('id', id);
  if (error) throw error;
}
export async function setDeliverableTags(id: string, tags: string[]): Promise<void> {
  const { error } = await supabase.from('deliverable').update({ tags }).eq('id', id);
  if (error) throw error;
}
export async function setEventBenchmarks(eventId: string, benchmarks: Benchmark[]): Promise<void> {
  const { error } = await supabase.from('event').update({ benchmarks }).eq('id', eventId);
  if (error) throw error;
}
```
Note: `setDeliverablePhase` (`~3555`) already exists — reuse it for phase reassignment on drag.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/db.ts
git commit -m "feat(db): benchmarks + deliverable benchmark/tags read+write"
```

---

### Task 4: "Edit benchmarks" editor (replaces PhaseEditor)

**Files:**
- Modify: `src/components/EventPlanningPage.tsx` — `PhaseEditor` (`~1242-1331`) → rename to `BenchmarkEditor`; its mount (`~4740`).

**Interfaces:**
- Consumes: `PHASES`, `PHASE_LABEL`, `Benchmark` (phases.ts); `setEventBenchmarks`, `setDeliverableBenchmark` (db.ts).
- Produces: `BenchmarkEditor({ eventId, benchmarks, deliverables, setPlan })`.

- [ ] **Step 1: Rebuild the editor**

Replace `PhaseEditor` with `BenchmarkEditor`: a collapsible panel titled **"Edit benchmarks"**. It lists the 3 phases (read-only headers) and, under each, that phase's benchmarks (`benchmarks.filter(b => b.phase === phase)` sorted by `order`) with add/rename/remove/reorder controls and a phase assignment (each benchmark belongs to one phase). Persist via `setEventBenchmarks(eventId, next)` + optimistic `setPlan`. On remove, reassign that benchmark's deliverables to `null` benchmark (call `setDeliverableBenchmark(d.id, null)` for each `d.benchmarkId === removedId`) so none orphan. New benchmark ids: `` `bm-${Date.now()}-${order}` `` (no `Math.random`/`Date.now` restriction here — this is app code, not a workflow script).

- [ ] **Step 2: Update the mount**

At `~4740`, replace `<PhaseEditor eventId={eventId} phases={plan.phases} deliverables={plan.deliverables} setPlan={setPlan} />` with:
```tsx
<BenchmarkEditor eventId={eventId} benchmarks={plan.benchmarks} deliverables={plan.deliverables} setPlan={setPlan} />
```

- [ ] **Step 3: Typecheck + manual check**

Run: `npx tsc --noEmit` (clean). Manually: open Deliverables → "Edit benchmarks" → add "Scoping" under Planning → it persists and appears; remove it → its tasks fall back under the phase.

- [ ] **Step 4: Commit**

```bash
git add src/components/EventPlanningPage.tsx
git commit -m "feat(deliverables): Edit benchmarks editor (fixed phases, benchmark CRUD)"
```

---

### Task 5: Deliverables list — tag bar, Phase→Benchmark grouping, drag, row re-center

**Files:**
- Modify: `src/components/EventPlanningPage.tsx` — the `Deliverables` component (`~1416-1700`): grouping (`~1609-1694`), row layout (`~1640`), dnd end (`~1521-1557`).

**Interfaces:**
- Consumes: `PHASES`, `PHASE_LABEL`, `nextTagSelection` (phases.ts); `setDeliverablePhase`, `setDeliverableBenchmark`, `plan.benchmarks`.

- [ ] **Step 1: Tag filter bar (single-select)**

At the top of the Deliverables component's render, add a chip bar built from the distinct tags across `initial` deliverables (`Array.from(new Set(items.flatMap(d => d.tags)))`). Track `const [tag, setTag] = useState<string | null>(null)`. Each chip `onClick={() => setTag((t) => nextTagSelection(t, chip))}`, styled selected when `tag === chip`. When `tag` is set, filter the rendered rows to `d.tags.includes(tag)`.

- [ ] **Step 2: Group Phase → Benchmark**

Replace the current group-by-`phase` render with two levels: outer loop over `PHASES` (always show all three, `id={`delsec-${phase}`}`); inner, for each phase, render its benchmarks (`plan.benchmarks.filter(b => b.phase === phase).sort(order)`, each `id={`delsec-bm-${b.id}`}`) as sub-headers, then that benchmark's tasks (`items.filter(d => d.phase === phase && d.benchmarkId === b.id)`); finally the phase's benchmark-less tasks (`d.phase === phase && !d.benchmarkId`) directly under the phase. Apply the tag filter within.

- [ ] **Step 3: Re-center the row**

In the row (`~1640`), the title/date/checkbox misalign because the content block is a two-line flex-column in an `items-center` row. Wrap the title+date content so it's vertically centered relative to the checkbox/controls: keep the row `flex items-center gap-3`, and ensure the content `<div>` doesn't force taller alignment — put the title and the date/offset on one aligned baseline row (title `flex-1`, date control `shrink-0` on the same line) OR add `self-center` to the content block. Verify the checkbox, title, date and status control sit on one centered line.

- [ ] **Step 4: Drag reassigns phase + benchmark**

Update `onDragEnd` (`~1521-1557`): the drop target id encodes phase (`delsec-<phase>`) or benchmark (`delsec-bm-<id>`). On cross-group drop, set the dragged deliverable's `phase` (via `setDeliverablePhase`) and `benchmarkId` (via `setDeliverableBenchmark`, `null` when dropped on a phase's non-benchmark zone), optimistically update local state, and persist. Keep within-group reorder as-is.

- [ ] **Step 5: Typecheck + manual check**

Run: `npx tsc --noEmit` (clean). Manually: tasks group under Planning/Day-of/Post and their benchmarks; clicking a tag filters to it, clicking again clears; dragging a task to another phase/benchmark moves it and persists on reload.

- [ ] **Step 6: Commit**

```bash
git add src/components/EventPlanningPage.tsx
git commit -m "feat(deliverables): tag filter + Phase→Benchmark grouping + drag + row align"
```

---

### Task 6: Timeline — 3 phase dots + benchmark sub-dots + click-to-jump

**Files:**
- Modify: `src/components/EventPlanningPage.tsx` — `deriveMarkers` (`~1960`), `OverviewTimeline` (`~2021`).

**Interfaces:**
- Consumes: `PHASES`, `PHASE_LABEL` (phases.ts); `plan.benchmarks`.

- [ ] **Step 1: Build markers from the 3 phases + benchmarks**

Rewrite `deriveMarkers` so the primary markers are always the 3 `PHASES` (label from `PHASE_LABEL`, view: planning→`planning`, day-of→`day-of`, post→`post`), and each phase's benchmarks (`plan.benchmarks.filter(b=>b.phase===phase)`) become **secondary** markers (kind: "secondary") rendered indented, same color as the parent phase, keyed `bm:<id>`. Keep the date-based `currentKey` resolution mapping today's timing to the right phase.

- [ ] **Step 2: Click-to-jump**

`OverviewTimeline`'s `onSelect` already switches the view; extend a phase/benchmark node click to also scroll its deliverables section into view: on select, `document.getElementById(key.startsWith("bm:") ? \`delsec-bm-${id}\` : \`delsec-${phase}\`)?.scrollIntoView({ behavior: "smooth", block: "start" })` (reuse the existing brief-highlight pattern).

- [ ] **Step 3: Typecheck + manual check**

Run: `npx tsc --noEmit` (clean). Manually: timeline shows exactly Planning/Day-of/Post with any benchmarks as smaller indented same-color dots; clicking a dot scrolls to that list section.

- [ ] **Step 4: Commit**

```bash
git add src/components/EventPlanningPage.tsx
git commit -m "feat(timeline): 3 phase dots + benchmark sub-dots + click-to-jump"
```

---

### Task 7: Suggested deliverables — categories become tags + real phases

**Files:**
- Modify: `src/components/SuggestedDeliverables.tsx`

**Interfaces:**
- Consumes: `Phase` (phases.ts); `addDeliverable` (with `tags`).

- [ ] **Step 1: Retype the tentative list + add with tag/phase**

Change `TENTATIVE_DELIVERABLES` entries to `{ title: string; tag: string; phase: Phase }`:
```ts
const TENTATIVE_DELIVERABLES: { title: string; tag: string; phase: Phase }[] = [
  { title: "Book venue & confirm space", tag: "Venue", phase: "planning" },
  { title: "Launch registration page", tag: "Marketing", phase: "planning" },
  { title: "Finalize catering & menu", tag: "Catering", phase: "planning" },
  { title: "Confirm speakers & moderators", tag: "Program", phase: "planning" },
  { title: "Lock A/V & production", tag: "Production", phase: "planning" },
  { title: "Send invites & track RSVPs", tag: "Guests", phase: "planning" },
  { title: "Run-of-show & day-of staffing", tag: "Logistics", phase: "day-of" },
];
```
Update `addSuggestion`/`addAll` to call `addDeliverable(eventId, { title: s.title, phase: s.phase, ownerRole: null, dueDate: guessDue(s.title), tags: [s.tag] })`. The subtitle shows the tag (`{s.tag}`) instead of the old phase.

- [ ] **Step 2: Typecheck + manual check**

Run: `npx tsc --noEmit` (clean). Manually: adding a suggestion lands it in the right phase with its tag; the tag appears in the filter bar.

- [ ] **Step 3: Commit**

```bash
git add src/components/SuggestedDeliverables.tsx
git commit -m "feat(deliverables): suggestions carry a tag + a real phase"
```

---

### Task 8: Consistent Open / Where-things-stand order

**Files:**
- Modify: `src/components/EventPlanningPage.tsx` (`~4055-4065`, the planning-view top slot).

- [ ] **Step 1: Stabilize the order**

The top slot swaps Open·next-up and Where-things-stand depending on `anythingOpen`. Make the order stable: always render `WhereThingsStand` in the same position, with `OpenNextUp` above it when `anythingOpen` (never reorder them). Concretely, render `{anythingOpen && <OpenNextUp .../>}` then always `<WhereThingsStand .../>` — but ensure no other view reorders them; if a different view renders these in the opposite order, align it to Open-then-Where.

- [ ] **Step 2: Typecheck + manual check**

Run: `npx tsc --noEmit` (clean). Manually: Open (when present) is always above Where-things-stand across phase views.

- [ ] **Step 3: Commit**

```bash
git add src/components/EventPlanningPage.tsx
git commit -m "fix(overview): stable Open / Where-things-stand order"
```

---

## Self-Review

**Spec coverage:**
- 3 immutable phases + constant: Task 2 (PHASES) + Task 6 (timeline). ✓
- Benchmarks (event.benchmarks, editor, sub-dots): Tasks 1, 3, 4, 6. ✓
- Tags (deliverable.tags, single-select filter bar): Tasks 1, 3, 5, 7. ✓
- Deliverable phase repurpose + timing backfill: Tasks 1, 3. ✓
- Phase→Benchmark grouping + drag + row re-center: Task 5. ✓
- Click-to-jump: Task 6. ✓
- Suggestions → tag + phase: Task 7. ✓
- Open/Where-things-stand ordering: Task 8. ✓

**Placeholder scan:** none — pure/data tasks have full code; UI tasks give exact anchors + concrete change specs and the id conventions used across tasks.

**Type consistency:** `Phase`/`Benchmark` defined in Task 2, consumed identically in Tasks 3-7. `benchmarkId`/`tags` added to `Deliverable` in Task 3 and used in Tasks 5/7. Section id conventions `delsec-<phase>` / `delsec-bm-<id>` are shared between Task 5 (render) and Task 6 (jump).

## Notes / Out of scope
- No multi-select tag filtering; tags only on deliverables; phases stay fixed at three (Task 4 enforces).
- Templates keep their own rail; benchmarks are event-only for now.
