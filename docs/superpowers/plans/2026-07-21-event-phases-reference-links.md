# Event Phases + Reference Links + Series Folder — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** date-aware default phases on drop-create + an event-side phase editor; a reference-links ("Resources") area on the event (folders included); and a single paired folder link on a series.

**Architecture:** Pure phase helper in `src/lib/eventPhases.ts` (unit-tested); phases persisted via existing `setEventPattern`. Reference links in a new `event.reference_links` jsonb column (migration) with `getEventPlanning`/`setEventReferenceLinks`. Series folder in `event_series.extras.campaign.folderUrl` (no migration).

**Tech Stack:** React 18 + TS, Tailwind, supabase-js (PostgREST as `authenticated`), vitest.

## Global Constraints

- Default phases: past (`date` && `date < today`) → `[{name:"Wrap",order:0}]`; future/undated → `[{name:"Plan",order:0},{name:"Wrap",order:1}]`. Applies only when no explicit phases; a brief's phases win.
- Phase editor must never orphan a deliverable: on rename, deliverables follow the new name; on remove, its deliverables move to the previous phase (or first remaining). At least one phase always remains.
- Reference links are OPEN-ONLY — never ingested/processed/wrapped; distinct from `source_materials`.
- `ReferenceLink = { id, label, url, kind?: "folder" | "link" }`.
- Series folder: `Campaign.folderUrl: string | null` (default null), stored in extras; no migration.
- **Migration ordering:** the `reference_links` column must exist in prod BEFORE any pushed frontend selects it (`getEventPlanning`), or every event page 400s. The migration is applied to prod (Task 3) before the column-selecting code (Task 4).

---

### Task 1: `defaultPhases` helper + apply in create paths (TDD)

**Files:**
- Create: `src/lib/eventPhases.ts`, `src/lib/eventPhases.test.ts`
- Modify: `src/components/SeriesPlan.tsx` (`createFromDrop`), `src/lib/db.ts` (`backfillEvent`), `src/components/EventsPage.tsx` (create-from-review path where phases default to `[]`)

**Interfaces:**
- Produces: `defaultPhases(date: string | null): { name: string; order: number }[]`

- [ ] **Step 1: Failing test** — `src/lib/eventPhases.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { defaultPhases } from "./eventPhases";
const today = new Date().toISOString().slice(0, 10);
const past = "2020-01-01";
const future = "2999-01-01";
describe("defaultPhases", () => {
  it("past date → single Wrap", () => { expect(defaultPhases(past)).toEqual([{ name: "Wrap", order: 0 }]); });
  it("future date → Plan then Wrap", () => { expect(defaultPhases(future)).toEqual([{ name: "Plan", order: 0 }, { name: "Wrap", order: 1 }]); });
  it("undated → Plan then Wrap", () => { expect(defaultPhases(null)).toEqual([{ name: "Plan", order: 0 }, { name: "Wrap", order: 1 }]); });
  it("today → Plan then Wrap (not past)", () => { expect(defaultPhases(today)).toEqual([{ name: "Plan", order: 0 }, { name: "Wrap", order: 1 }]); });
});
```

- [ ] **Step 2: Run — fails** (`npx vitest run src/lib/eventPhases.test.ts`) — module not found.

- [ ] **Step 3: Implement** — `src/lib/eventPhases.ts`:
```ts
// The default phase set for an event created without explicit phases. A past event only needs the
// post-event Wrap; a future/undated one gets Plan → Wrap. (Explicit phases from a brief override this.)
export function defaultPhases(date: string | null): { name: string; order: number }[] {
  const today = new Date().toISOString().slice(0, 10);
  const isPast = !!date && date < today;
  return isPast ? [{ name: "Wrap", order: 0 }] : [{ name: "Plan", order: 0 }, { name: "Wrap", order: 1 }];
}
```

- [ ] **Step 4: Run — passes.**

- [ ] **Step 5: Apply in create paths.**
  - `src/components/SeriesPlan.tsx` — in `createFromDrop`, pass `phases: defaultPhases(date)` to `createPlanningEvent` (import `defaultPhases`). (Currently it passes no phases.)
  - `src/lib/db.ts` — in `backfillEvent`, set the created event's `phases` to `defaultPhases(input.date)` if it currently sets none/hardcodes Wrap (import/inline the same logic; keep it a single source — import from `./eventPhases`).
  - `src/components/EventsPage.tsx` — where the ingest create falls back to `phases: []` (no brief phases), use `defaultPhases(fields.date || null)` for a non-template event instead of `[]`. Templates stay phase-less.

- [ ] **Step 6: Typecheck** (`npx tsc --noEmit -p tsconfig.json`) — clean.

- [ ] **Step 7: Commit**
```bash
git add src/lib/eventPhases.ts src/lib/eventPhases.test.ts src/components/SeriesPlan.tsx src/lib/db.ts src/components/EventsPage.tsx
git commit -m "feat(events): date-aware default phases (future → Plan+Wrap, past → Wrap)"
```

---

### Task 2: Event phase editor

**Files:** Modify `src/components/EventPlanningPage.tsx` (add a phase editor); uses existing `setEventPattern({ phases })` and the existing per-deliverable phase setter.

**Interfaces:**
- Consumes: `setEventPattern` (db.ts), `plan.phases: EventPhase[]`, `plan.deliverables` (each has `phase`), the existing deliverable-phase setter (`setDeliverablePhase(id, phase)` — confirm the exact name in db.ts; it's used by `WrappedDeliverables`).

- [ ] **Step 1: Add a `PhaseEditor` block** on the planning page (near the timeline / phase rail). It lists `plan.phases` sorted by `order`, each row: a rename input, ▲/▼ reorder, and a remove (✕). Below: an "+ add phase" input.
  - **add:** append `{ name, order: phases.length }`.
  - **rename:** update that phase's `name`; then reassign every deliverable whose `phase === oldName` to `newName`.
  - **remove:** disallow if only one phase remains; else drop it, renumber `order` 0..n-1, and reassign its deliverables to the previous phase (or the first remaining).
  - **reorder:** swap adjacent, renumber `order`.
  - Persist phases via `setEventPattern(eventId, { phases: next })` and update local `plan` state; reassign deliverables via the existing per-deliverable phase setter (one call per affected deliverable) so nothing is orphaned.

- [ ] **Step 2: Typecheck** — clean.

- [ ] **Step 3: Commit**
```bash
git add src/components/EventPlanningPage.tsx
git commit -m "feat(events): phase editor on the event page (add/rename/remove/reorder, task-safe)"
```

---

### Task 3: `reference_links` migration + apply to prod

**Files:** Create `supabase/migrations/<ts>_event_reference_links.sql`

- [ ] **Step 1: Migration file**
```sql
-- Reference links: open-only resources (Google Docs/sheets/folders) attached to an event. Never
-- processed/ingested — distinct from source_materials. jsonb array of { id, label, url, kind }.
ALTER TABLE event ADD COLUMN IF NOT EXISTS reference_links jsonb NOT NULL DEFAULT '[]'::jsonb;
GRANT UPDATE (reference_links) ON event TO anon, authenticated;
```

- [ ] **Step 2: Apply to prod BEFORE the column-selecting code ships** (controller step — see plan note). Verify the column exists in prod. (Then Task 4's `getEventPlanning` select is safe to commit/push.)

- [ ] **Step 3: Commit**
```bash
git add supabase/migrations/*_event_reference_links.sql
git commit -m "migration: event.reference_links column + grant"
```

---

### Task 4: Reference links in db

**Files:** Modify `src/lib/db.ts`

**Interfaces:**
- Produces: `ReferenceLink = { id: string; label: string; url: string; kind?: "folder" | "link" }`; `EventPlanning.referenceLinks: ReferenceLink[]`; `setEventReferenceLinks(eventId, links): Promise<void>`.

- [ ] **Step 1:** Add `export interface ReferenceLink { id: string; label: string; url: string; kind?: "folder" | "link" }`. Add `referenceLinks: ReferenceLink[]` to `EventPlanning`.
- [ ] **Step 2:** In `getEventPlanning`, add `reference_links` to the `.select(...)` string and map `referenceLinks: Array.isArray((row as any).reference_links) ? (row as any).reference_links : []` in the returned object.
- [ ] **Step 3:** Add:
```ts
export async function setEventReferenceLinks(eventId: string, links: ReferenceLink[]): Promise<void> {
  const { error } = await supabase.from("event").update({ reference_links: links }).eq("id", eventId);
  if (error) throw error;
}
```
- [ ] **Step 4: Typecheck** — clean. **Commit** `src/lib/db.ts` — "feat(events): reference_links in getEventPlanning + setEventReferenceLinks".

---

### Task 5: Reference-links "Resources" UI (event page)

**Files:** Modify `src/components/EventPlanningPage.tsx`

- [ ] **Step 1:** A "Resources" section: list `plan.referenceLinks` as clickable rows (folder icon when `kind==="folder"`, else a link icon; label → `target="_blank" rel="noreferrer"`, host as subtext). Add-row: label + URL inputs, a "Folder?" toggle (sets `kind`), append with a generated id. Remove per row. Persist via `setEventReferenceLinks(eventId, next)` + local state. Basic URL check (must start with `http`). Empty state: "No linked resources yet — add a Google Doc, sheet, or folder." Nothing here calls the ingest.
- [ ] **Step 2: Typecheck** — clean. **Commit** — "feat(events): Resources area — open-only reference links (folders included)".

---

### Task 6: Series folder link

**Files:** Modify `src/lib/campaign.ts` (+ `campaign.test.ts`), `src/components/SeriesDashboard.tsx`

**Interfaces:** `Campaign.folderUrl: string | null`.

- [ ] **Step 1:** Add `folderUrl: string | null` to `Campaign`; `emptyCampaign` → `folderUrl: null`; `normalizeCampaign` → `folderUrl: typeof c.folderUrl === "string" && c.folderUrl.trim() ? c.folderUrl : null`. Add a test: `normalizeCampaign({}).folderUrl === null` and a provided value round-trips.
- [ ] **Step 2: Run tests** — pass.
- [ ] **Step 3:** In `SeriesDashboard` header, a "📁 Folder" affordance: when `campaign.folderUrl` set, an open-in-new-tab link; an edit control (small input/popover) to set/change it, persisted via the existing `save({ ...campaign, folderUrl })`. Basic `http` check.
- [ ] **Step 4: Typecheck** — clean. **Commit** — "feat(series): single paired folder link on the series".

---

## Self-Review

**Spec coverage:** Part 1 default → Task 1; Part 1 editor → Task 2; Part 2 (column/db/UI) → Tasks 3–5; Part 3 series folder → Task 6. ✓
**Placeholders:** none (defaultPhases, migration SQL, db fns fully coded; UI tasks give exact behavior + persistence calls).
**Type consistency:** `ReferenceLink`/`referenceLinks`/`setEventReferenceLinks` (Task 4) consumed in Task 5; `defaultPhases` (Task 1) used in create paths; `Campaign.folderUrl` (Task 6) consistent.
**Deploy parity:** Task 3 migration is a manual/controller-applied prod step, sequenced before Task 4's column select. Parts 1 & 3 need no migration.
