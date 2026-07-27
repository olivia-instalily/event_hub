# Onboarding flow redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drop the forced `EventSetup` page — land on the real event, surface setup concerns as dismissible amber flags, and move the setup page's two head-start helpers into the Budget and Deliverables tabs.

**Architecture:** Pure app code. A new pure helper decides which flags show. The two `EventSetup` step bodies are extracted into standalone components mounted in their tabs; then `EventSetup` is deleted and its render gate removed so `Overview` always renders. Flags live in `Overview`, reusing `saveSetupState`/`setupProgress` for manual "settle".

**Tech Stack:** React + TypeScript, Supabase/PostgREST (`src/lib/db.ts`), Vitest (node env, pure-function tests only — no RTL).

## Global Constraints

- Tests run in the **node** environment; only pure `.test.ts` logic is tested. UI is verified manually. (`vitest.config.ts`)
- `saveSetupState(eventId: string, progress: string[], complete: boolean)` — do NOT change its signature (`db.ts:3336`).
- Amber flag card pattern (mirror verbatim): `rounded-xl border border-amber-200 bg-amber-50 px-4 py-3`, `AlertCircle` in `text-amber-700`, title `text-[15px] font-medium text-amber-900`, blurb `text-[13px] text-amber-700`. (`EventPlanningPage.tsx:3893-3904`)
- Engagement signals (exact fields on `EventPlanning`, `db.ts:2587-2647`): `date`, `headcount`, `owners[]`, `eventBudgetTarget`, `budget.lines[].target`, `budget.lines[].confirmedAmount`, `deliverables[]`, `setupProgress[]`, `setupComplete`.
- **Deploy parity:** all app code — auto-deploys with Cloud Run. No migration, no cloud-function twin.

---

### Task 1: Prominent create button

**Files:**
- Modify: `src/components/EventsPage.tsx:1507-1508`

- [ ] **Step 1: Drop the light variant**

At `EventsPage.tsx:1507`, the create button is `<Button variant="secondary" ...>`. Remove the `variant="secondary"` prop so it uses the default dark `bg-primary` style. Leave everything else (onClick, disabled, title, children) unchanged.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Manual verification**

Open the Create Event modal → the "Skip & create event" / "Create event" button is now dark/prominent, not light gray.

- [ ] **Step 4: Commit**

```bash
git add src/components/EventsPage.tsx
git commit -m "style(create): prominent (dark) create-event button"
```

---

### Task 2: Pure flag-state helper

**Files:**
- Create: `src/lib/setupFlags.ts`
- Test: `src/lib/setupFlags.test.ts`

**Interfaces:**
- Produces:
  - `type SetupFlagKey = "date" | "headcount" | "owners" | "budget" | "timeline"`
  - `SETUP_FLAG_KEYS: SetupFlagKey[]`
  - `flagEngaged(plan: FlagInput, key: SetupFlagKey): boolean`
  - `visibleFlags(plan: FlagInput): SetupFlagKey[]` — keys that are neither engaged nor settled.
  - `type FlagInput = Pick<EventPlanning, "date" | "headcount" | "owners" | "eventBudgetTarget" | "budget" | "deliverables" | "setupProgress">`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { visibleFlags, flagEngaged, SETUP_FLAG_KEYS } from "./setupFlags";

const base = {
  date: null, headcount: null, owners: [] as { id: string; name: string; color: string | null }[],
  eventBudgetTarget: null, budget: null as any, deliverables: [] as any[], setupProgress: [] as string[],
};

describe("setupFlags", () => {
  it("shows all five flags for a blank event", () => {
    expect(visibleFlags(base).sort()).toEqual([...SETUP_FLAG_KEYS].sort());
  });
  it("date flag clears once a date is set", () => {
    expect(flagEngaged({ ...base, date: "2026-08-01" }, "date")).toBe(true);
    expect(visibleFlags({ ...base, date: "2026-08-01" })).not.toContain("date");
  });
  it("headcount flag clears once headcount is set", () => {
    expect(visibleFlags({ ...base, headcount: 100 })).not.toContain("headcount");
  });
  it("owners flag needs a SECOND owner (creator is auto-added)", () => {
    const one = [{ id: "a", name: "A", color: null }];
    const two = [...one, { id: "b", name: "B", color: null }];
    expect(flagEngaged({ ...base, owners: one }, "owners")).toBe(false);
    expect(flagEngaged({ ...base, owners: two }, "owners")).toBe(true);
  });
  it("budget flag clears on an overall target OR any line target/amount", () => {
    expect(visibleFlags({ ...base, eventBudgetTarget: 5000 })).not.toContain("budget");
    expect(visibleFlags({ ...base, budget: { id: "b", currency: "USD", targetAmount: null, lines: [{ id: "l", label: "AV", confirmedAmount: 10, target: null, status: "planned", syncUrl: null, docUrl: null, note: null, linkedEngagement: null }] } as any })).not.toContain("budget");
  });
  it("timeline flag clears once a deliverable exists", () => {
    expect(visibleFlags({ ...base, deliverables: [{ id: "d" } as any] })).not.toContain("timeline");
  });
  it("a settled flag is hidden even when not engaged", () => {
    expect(visibleFlags({ ...base, setupProgress: ["date"] })).not.toContain("date");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/setupFlags.test.ts`
Expected: FAIL — cannot resolve `./setupFlags`.

- [ ] **Step 3: Write the implementation**

```ts
import type { EventPlanning } from "./db";

export type SetupFlagKey = "date" | "headcount" | "owners" | "budget" | "timeline";
export const SETUP_FLAG_KEYS: SetupFlagKey[] = ["date", "headcount", "owners", "budget", "timeline"];

export type FlagInput = Pick<EventPlanning,
  "date" | "headcount" | "owners" | "eventBudgetTarget" | "budget" | "deliverables" | "setupProgress">;

/** True when the user has engaged enough for this flag to auto-clear. */
export function flagEngaged(plan: FlagInput, key: SetupFlagKey): boolean {
  switch (key) {
    case "date": return plan.date != null;
    case "headcount": return plan.headcount != null;
    // Creator is auto-added as owner (assignOwner), so >= 2 means a real co-owner was added.
    case "owners": return plan.owners.length >= 2;
    case "budget": return plan.eventBudgetTarget != null
      || (plan.budget?.lines.some((l) => l.target != null || l.confirmedAmount != null) ?? false);
    case "timeline": return plan.deliverables.length > 0;
  }
}

/** Flags to show: not yet engaged AND not manually settled (settled = key in setupProgress). */
export function visibleFlags(plan: FlagInput): SetupFlagKey[] {
  const settled = new Set(plan.setupProgress);
  return SETUP_FLAG_KEYS.filter((k) => !flagEngaged(plan, k) && !settled.has(k));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/setupFlags.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/setupFlags.ts src/lib/setupFlags.test.ts
git commit -m "feat(setup): pure flag-state helper (engagement + settle)"
```

---

### Task 3: Extract SuggestedDeliverables → mount in the Deliverables tab

**Files:**
- Create: `src/components/SuggestedDeliverables.tsx`
- Modify: `src/components/EventPlanningPage.tsx:4532-4538` (deliverables tab)

**Interfaces:**
- Produces: `SuggestedDeliverables({ plan, eventId, onApplied }: { plan: EventPlanning; eventId: string; onApplied: () => void })`

- [ ] **Step 1: Create the component from the existing TimelineStep body**

Create `src/components/SuggestedDeliverables.tsx`. Move the deliverable-suggestion logic from `EventSetup.tsx` `TimelineStep` (`:364-437`) and the `TENTATIVE_DELIVERABLES` const (`EventSetup.tsx:22-30`) and `dueOffsetForTitle` import (`from "../lib/schedule"`), with these adaptations:
  - Props are `{ plan, eventId, onApplied }` (no `hasDate`/`onNeedsDate`/`onDone`).
  - Keep the "no date set" amber hint, but its link scrolls to top instead of opening a step: `onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}`.
  - After `addSuggestion` calls `addDeliverable(...)`, also call `onApplied()` so the tab reloads and the main `Deliverables` list re-seeds.
  - Remove the `StepFooter`/`onDone` block entirely (no "Looks good" button).
  - Render only the "Suggested deliverables" add-list section (the existing dated-rows table already lives in the `Deliverables` component, so drop the `sorted`/`dues` rows rendering; keep only `suggestions` + `addSuggestion` + the no-date hint). `present`/`suggestions` derive from `plan.deliverables`.
  - Wrap in a titled card: `<div className="bg-white rounded-2xl border border-border p-5">` with a heading `Suggested deliverables`.
  - If `suggestions.length === 0`, render `null`.

- [ ] **Step 2: Mount it in the Deliverables tab**

In `EventPlanningPage.tsx:4532-4538`, add it inside the deliverables tab block, above `<PhaseEditor>`:

```tsx
        {tab === "deliverables" && (
          <div className="space-y-6">
            <SuggestedDeliverables plan={plan} eventId={eventId} onApplied={() => setReload((r) => r + 1)} />
            <PhaseEditor eventId={eventId} phases={plan.phases} deliverables={plan.deliverables} setPlan={setPlan} />
            <Deliverables eventId={eventId} initial={plan.deliverables} phases={plan.phases} jumpId={deliverableJump} linearProjectUrl={plan.linearProjectUrl} onLinearSynced={() => setReload((r) => r + 1)} onOpenReflection={() => { setReflectionJump((n) => n + 1); setTab("overview"); }} />
            <AgendaEditor eventId={eventId} initial={plan.agenda} />
          </div>
        )}
```

Add the import near the other component imports: `import { SuggestedDeliverables } from "./SuggestedDeliverables";`

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Manual verification**

Open a fresh event → Deliverables tab shows the suggested list; clicking Add on one adds a dated deliverable and it appears in the main list below. Once all suggestions are added (or none apply) the block disappears.

- [ ] **Step 5: Commit**

```bash
git add src/components/SuggestedDeliverables.tsx src/components/EventPlanningPage.tsx
git commit -m "feat(deliverables): suggested-deliverables head-start in the tab"
```

---

### Task 4: Extract BudgetProjections → mount in the Budget tab

**Files:**
- Create: `src/components/BudgetProjections.tsx`
- Modify: `src/components/EventPlanningPage.tsx:4529-4531` (budget tab)

**Interfaces:**
- Produces: `BudgetProjections({ plan, eventId, onApplied }: { plan: EventPlanning; eventId: string; onApplied: () => void })`

- [ ] **Step 1: Create the component from the existing BudgetStep body**

Create `src/components/BudgetProjections.tsx`. Move the projection logic from `EventSetup.tsx` `BudgetStep` (`:213-361`) verbatim, with these adaptations:
  - Props are `{ plan, eventId, onApplied }` (no `onDone`).
  - Keep all imports it uses: `getBudgetProjections, setEventBudgetTarget, setBudgetTarget, setBudgetLineTarget, addBudgetCategoryTarget, type BudgetProjection` from `../lib/db`; `BudgetDropZone, BudgetDropArea, BudgetImportModal` from `./BudgetImport`; `canonicalCategory, categoryKey` from `../lib/budgetCategories`; the `money`/`numOrNull` helpers (copy them into this file).
  - Remove the `StepFooter`/`onDone` block.
  - After a successful `BudgetImportModal` apply (`onApplied` callback in the modal, currently `setImportNote`), also call the component's `onApplied()` prop so the Budget tab reloads with new targets. (Keep the local `importNote` display too.)
  - Wrap the whole thing in a titled card `<div className="bg-white rounded-2xl border border-border p-5">` with a heading `Budget projections` and a one-line blurb.
  - Guard: if `!plan.budget`, render `null` (the tab already shows a "No budget attached" message in that case).

- [ ] **Step 2: Mount it above BudgetTracker in the Budget tab**

In `EventPlanningPage.tsx:4529-4531`:

```tsx
        {tab === "budget" && (plan.budget
          ? <div className="space-y-6">
              <BudgetProjections plan={plan} eventId={eventId} onApplied={() => setReload((r) => r + 1)} />
              <BudgetTracker budget={plan.budget} eventId={eventId} eventBudgetTarget={plan.eventBudgetTarget} engagements={plan.engagements} />
            </div>
          : <div className="bg-white rounded-2xl border border-border p-6 text-sm text-gray-400">No budget attached to this event yet.</div>)}
```

Add the import: `import { BudgetProjections } from "./BudgetProjections";`

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Manual verification**

Open a fresh event → Budget tab shows the "projected from comparable past events" table; entering a target or dropping a breakdown persists and the tracker below reflects it.

- [ ] **Step 5: Commit**

```bash
git add src/components/BudgetProjections.tsx src/components/EventPlanningPage.tsx
git commit -m "feat(budget): projection head-start in the tab"
```

---

### Task 5: Always render Overview + add onOpenTimeline

**Files:**
- Modify: `src/components/EventPlanningPage.tsx:4521-4526`

**Interfaces:**
- Consumes: `Overview` (existing). Produces: a new `onOpenTimeline: () => void` prop on `Overview` (used in Task 6).

- [ ] **Step 1: Remove the EventSetup gate**

Replace the overview-tab branch (`:4524-4526`) so `Overview` always renders, and pass the new `onOpenTimeline` prop:

```tsx
        {tab === "overview" && (
          <Overview plan={plan} eventId={eventId} onApplied={() => setReload((r) => r + 1)} onOpenBudget={() => setTab("budget")} onOpenTimeline={() => setTab("deliverables")} onOpenDeliverable={(id) => { setDeliverableJump(id); setTab("deliverables"); }} onOpenPeople={() => setTab("people")} onOpenEvent={onOpenEvent} reflectionJump={reflectionJump} reopened={reopened} setPlan={setPlan} />
        )}
```

- [ ] **Step 2: Add the prop to Overview's signature**

At `Overview`'s definition (`EventPlanningPage.tsx:3773`), add `onOpenTimeline` to the destructured props and the type:
`onOpenBudget: () => void; onOpenTimeline: () => void; onOpenDeliverable: (id: string) => void; ...`

- [ ] **Step 3: Remove the now-unused EventSetup import**

Remove `import { EventSetup } from "./EventSetup";` from `EventPlanningPage.tsx` (grep to confirm no other reference remains).

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. (Overview's body doesn't yet use `onOpenTimeline`; that's Task 6. An unused prop is fine, but if the linter complains, proceed to Task 6 which consumes it.)

- [ ] **Step 5: Manual verification**

Create a brand-new event → it lands directly on the event Overview (no setup wizard).

- [ ] **Step 6: Commit**

```bash
git add src/components/EventPlanningPage.tsx
git commit -m "feat(event): land on the event page, not the setup wizard"
```

---

### Task 6: Render the five flags in Overview

**Files:**
- Modify: `src/components/EventPlanningPage.tsx` (inside `Overview`, near the scoping nag at `:3893`)

**Interfaces:**
- Consumes: `visibleFlags`, `SetupFlagKey` (Task 2); `saveSetupState` (`db.ts`); `onOpenBudget`, `onOpenTimeline`, `setPlan` (already in `Overview`).

- [ ] **Step 1: Import the helper and icons**

Add `import { visibleFlags, type SetupFlagKey } from "../lib/setupFlags";`. Ensure these lucide icons are imported in `EventPlanningPage.tsx` (add any missing to the existing lucide import): `Calendar, Users, UserPlus, DollarSign, ClipboardList, Check` (`AlertCircle` is already imported).

- [ ] **Step 2: Add the flag block inside Overview**

Immediately before the scoping-nag block (`:3893`), add:

```tsx
      {(() => {
        const flags = visibleFlags(plan);
        if (flags.length === 0) return null;
        const META: Record<SetupFlagKey, { title: string; blurb: string; Icon: typeof Calendar; go: () => void }> = {
          date: { title: "Set the event date", blurb: "Unlocks scheduling and deliverable due-dates.", Icon: Calendar, go: () => window.scrollTo({ top: 0, behavior: "smooth" }) },
          headcount: { title: "Add expected headcount", blurb: "Sizes budget and logistics.", Icon: Users, go: () => window.scrollTo({ top: 0, behavior: "smooth" }) },
          owners: { title: "Add owners", blurb: "Give this event a co-owner.", Icon: UserPlus, go: () => window.scrollTo({ top: 0, behavior: "smooth" }) },
          budget: { title: "Review budget", blurb: "Set targets from comparable past events.", Icon: DollarSign, go: onOpenBudget },
          timeline: { title: "Check timeline", blurb: "Add dated deliverables.", Icon: ClipboardList, go: onOpenTimeline },
        };
        const settle = (key: SetupFlagKey) => {
          const next = [...plan.setupProgress, key];
          setPlan((p) => (p ? { ...p, setupProgress: next } : p));
          void saveSetupState(eventId, next, plan.setupComplete);
        };
        return (
          <div className="space-y-2">
            {flags.map((key) => {
              const m = META[key];
              return (
                <div key={key} className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                  <div className="flex items-center gap-3">
                    <m.Icon className="w-5 h-5 text-amber-700 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-[15px] font-medium text-amber-900">{m.title}</p>
                      <p className="text-[13px] text-amber-700">{m.blurb}</p>
                    </div>
                    <Button size="sm" variant="outline" onClick={m.go}>Go</Button>
                    <button onClick={() => settle(key)} title="Dismiss — don't show this again" className="w-7 h-7 rounded-full border border-amber-300 text-amber-700 hover:bg-amber-100 flex items-center justify-center shrink-0">
                      <Check className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        );
      })()}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors (`onOpenTimeline` now consumed).

- [ ] **Step 4: Manual verification**

Fresh event shows date/headcount/owners/budget/timeline flags. Setting a date removes the date flag; adding a second owner removes owners; partial budget removes budget; adding a deliverable removes timeline. Clicking the checkmark on any flag removes it permanently (reload → still gone). "Go" on budget/timeline switches tabs; "Go" on the header ones scrolls to top.

- [ ] **Step 5: Commit**

```bash
git add src/components/EventPlanningPage.tsx
git commit -m "feat(event): engagement flags (date/headcount/owners/budget/timeline)"
```

---

### Task 7: Delete EventSetup

**Files:**
- Delete: `src/components/EventSetup.tsx`

- [ ] **Step 1: Confirm it's unreferenced**

Run: `grep -rn "EventSetup" src/`
Expected: no matches (the import was removed in Task 5; the two helpers were ported in Tasks 3-4).

- [ ] **Step 2: Delete the file**

```bash
git rm src/components/EventSetup.tsx
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git commit -m "chore(setup): remove the forced EventSetup wizard (ported to tabs + flags)"
```

---

### Task 8: Verify creator-as-owner (no code)

**Files:** none.

- [ ] **Step 1: Confirm coverage**

`assignOwner` (`EventsPage.tsx:719`) adds `current?.id` as an owner on manual create (`:1028`) and the two brief/ingest paths (`:1090`, `:1130`). Read those three call sites and confirm each create path that leads to a planning event calls `assignOwner`. If any planning-create path is missing it, add `await assignOwner(id);` after creation on that path.

- [ ] **Step 2: Manual verification**

Create an event → open it → the creating profile appears as an owner in the header, and the "Add owners" flag is showing (because there's exactly one owner) until you add a second or settle it.

---

## Self-Review

**Spec coverage:**
- Part 1 (prominent button): Task 1. ✓
- Part 2 (no forced gate): Task 5. ✓
- Part 3 (move helpers, delete EventSetup): Tasks 3, 4, 7. ✓
- Part 4 (five flags, auto-clear + settle, jumps): Tasks 2, 6. ✓
- Part 5 (creator-as-owner): Task 8 (verify). ✓

**Placeholder scan:** none. Tasks 3-4 move existing, in-repo code with enumerated adaptations and exact source line ranges — not invented code, so no placeholder. All new code (helper, flag block, mounts) is shown in full.

**Type consistency:** `SetupFlagKey` and `visibleFlags`/`flagEngaged` are defined in Task 2 and consumed identically in Task 6. `onOpenTimeline: () => void` is added to `Overview` in Task 5 and consumed in Task 6. `saveSetupState(eventId, string[], boolean)` used per its real signature. `setPlan` is `Dispatch<SetStateAction<EventPlanning | null>>` — the `settle` updater guards `p ? ... : p`.

## Notes / Out of scope
- No Luma flag; no external-event flags; no `saveSetupState` signature change; no migration.
- Budget/timeline head-start blocks render as titled cards in their tabs (placement per spec).
