# DB-backed Budget Approval — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the budget-approval workflow (status / assigned amount / decline reason / attribution / Slack refs) out of `localStorage` into a `budget_approval` DB table so approval state is shared across users and writable server-side (Phase 1 Slack).

**Architecture:** New `budget_approval` table (one row per event). A small client API in `db.ts` is the sanctioned path; `assignBudget` reuses the existing `setEventBudgetTarget` writer (no second write path to `event.event_budget_target`). Scoping inputs stay in `localStorage`. Existing in-flight approvals bridge to the DB once via migrate-on-read.

**Tech Stack:** React + TypeScript (Vite), `@supabase/supabase-js` (PostgREST), Vitest, SQL migrations under `supabase/migrations/`.

## Global Constraints
- Approval-workflow fields only move to the DB; scoping **inputs** stay in `localStorage` (`loadScoping`/`saveScoping` unchanged for inputs).
- Assigned amount is **`event.event_budget_target`** — written **only** via `setEventBudgetTarget` (db.ts:2616). No second writer.
- Attribution supports app **or** Slack deciders: `decided_via` ∈ `'app'|'slack'`, `decider_ref` text.
- Migrate-on-read is a one-time bridge for existing localStorage records; **new submissions write to the DB directly**.
- One row per event → no decline history (accepted).
- 🚩 Deploy parity: the migration must be **applied to Cloud SQL manually** (deploy has no migration step) + PostgREST grant/schema reload. `db.ts`/component changes auto-deploy on push.
- Verify with `npx tsc -b` and `npx vitest run` (must stay green).

---

### Task 1: `budget_approval` migration

**Files:**
- Create: `supabase/migrations/20260709000000_budget_approval.sql`

**Interfaces:**
- Produces: table `budget_approval(event_id, status, requested_amount, decline_reason, decided_via, decider_ref, decided_at, slack_channel, slack_message_ts, created_at, updated_at)`.

- [ ] **Step 1: Write the migration SQL**

```sql
-- Budget approval workflow, one row per event. Assigned amount is NOT stored here — it reuses
-- event.event_budget_target (written only via setEventBudgetTarget). See the Phase 0 design spec.
create table if not exists public.budget_approval (
  event_id          text primary key references public.event(id) on delete cascade,
  status            text not null check (status in ('submitted','assigned','declined')),
  requested_amount  numeric,
  decline_reason    text,
  decided_via       text check (decided_via in ('app','slack')),
  decider_ref       text,
  decided_at        timestamptz,
  slack_channel     text,
  slack_message_ts  text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- PostgREST access. Mirrors the project's other tables (adjust roles if Cloud SQL differs).
grant all on public.budget_approval to anon, authenticated, service_role;
```

- [ ] **Step 2: Apply locally and verify the table exists**

Run: `supabase migration up`
Then: `supabase db execute "select count(*) from budget_approval;"` (or psql) — Expected: `0`, no error.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260709000000_budget_approval.sql
git commit -m "feat(budget): budget_approval table migration"
```

> 🚩 Do NOT forget Task 6 applies this same SQL to Cloud SQL — the deploy will not.

---

### Task 2: Pure `scopingToApproval` mapper (migrate-on-read bridge)

**Files:**
- Modify: `src/lib/scoping.ts` (add export near the bottom)
- Test: `tests/scopingApproval.test.ts`

**Interfaces:**
- Consumes: `ScopingForm` (existing).
- Produces: `scopingToApproval(s: ScopingForm): { status: 'submitted'|'assigned'; assignedAmount: number | null; slackChannel: string | null } | null` — returns `null` for a draft (nothing to migrate).

- [ ] **Step 1: Write the failing test**

```ts
// tests/scopingApproval.test.ts
import { describe, expect, it } from "vitest";
import { emptyScoping, scopingToApproval } from "../src/lib/scoping";

describe("scopingToApproval (migrate-on-read bridge)", () => {
  it("returns null for a draft (nothing to migrate)", () => {
    expect(scopingToApproval(emptyScoping())).toBeNull();
  });
  it("maps a submitted record", () => {
    const s = { ...emptyScoping(), status: "submitted" as const, submittedChannel: "#budget" };
    expect(scopingToApproval(s)).toEqual({ status: "submitted", assignedAmount: null, slackChannel: "#budget" });
  });
  it("maps an assigned record, carrying the assigned amount", () => {
    const s = { ...emptyScoping(), status: "assigned" as const, assignedBudget: 8000, submittedChannel: "#budget" };
    expect(scopingToApproval(s)).toEqual({ status: "assigned", assignedAmount: 8000, slackChannel: "#budget" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/scopingApproval.test.ts`
Expected: FAIL — `scopingToApproval` is not exported.

- [ ] **Step 3: Implement the mapper**

Append to `src/lib/scoping.ts`:

```ts
// One-time migrate-on-read bridge: map an existing localStorage scoping record to the fields the
// budget_approval row needs. Returns null for a draft (nothing to migrate). NOT used for new
// submissions — those call submitBudgetApproval directly.
export function scopingToApproval(s: ScopingForm): { status: "submitted" | "assigned"; assignedAmount: number | null; slackChannel: string | null } | null {
  if (s.status === "draft") return null;
  return { status: s.status, assignedAmount: s.status === "assigned" ? s.assignedBudget : null, slackChannel: s.submittedChannel };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/scopingApproval.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/scoping.ts tests/scopingApproval.test.ts
git commit -m "feat(budget): scopingToApproval migrate-on-read mapper"
```

---

### Task 3: Budget-approval client API in `db.ts`

**Files:**
- Modify: `src/lib/db.ts` (add after `setEventBudgetTarget`, ~line 2618)

**Interfaces:**
- Consumes: `supabase` (existing), `setEventBudgetTarget(eventId, target)` (existing, db.ts:2616), `scopingToApproval`, `loadScoping` (from `./scoping`).
- Produces:
  - `type BudgetApproval = { eventId: string; status: 'submitted'|'assigned'|'declined'; requestedAmount: number|null; declineReason: string|null; decidedVia: 'app'|'slack'|null; deciderRef: string|null; decidedAt: string|null; slackChannel: string|null; slackMessageTs: string|null }`
  - `getBudgetApproval(eventId): Promise<BudgetApproval | null>`
  - `submitBudgetApproval(eventId, opts: { requestedAmount: number|null; slackChannel: string|null; slackMessageTs?: string|null }): Promise<void>`
  - `assignBudget(eventId, amount: number, decider?: { via: 'app'|'slack'; ref: string }): Promise<void>`
  - `declineBudget(eventId, reason: string, decider?: { via: 'app'|'slack'; ref: string }): Promise<void>`
  - `migrateScopingApprovalIfNeeded(eventId): Promise<BudgetApproval | null>`

- [ ] **Step 1: Add the type + row mapper**

Add near the other db types / after `setEventBudgetTarget`:

```ts
export type BudgetApproval = {
  eventId: string;
  status: 'submitted' | 'assigned' | 'declined';
  requestedAmount: number | null;
  declineReason: string | null;
  decidedVia: 'app' | 'slack' | null;
  deciderRef: string | null;
  decidedAt: string | null;
  slackChannel: string | null;
  slackMessageTs: string | null;
};

const toBudgetApproval = (r: any): BudgetApproval => ({
  eventId: r.event_id, status: r.status, requestedAmount: r.requested_amount ?? null,
  declineReason: r.decline_reason ?? null, decidedVia: r.decided_via ?? null, deciderRef: r.decider_ref ?? null,
  decidedAt: r.decided_at ?? null, slackChannel: r.slack_channel ?? null, slackMessageTs: r.slack_message_ts ?? null,
});
```

- [ ] **Step 2: Add read + submit + assign + decline**

```ts
export async function getBudgetApproval(eventId: string): Promise<BudgetApproval | null> {
  const { data } = await supabase.from('budget_approval').select('*').eq('event_id', eventId).maybeSingle();
  return data ? toBudgetApproval(data) : null;
}

/** New submissions write here directly (NOT via the migrate-on-read bridge). */
export async function submitBudgetApproval(eventId: string, opts: { requestedAmount: number | null; slackChannel: string | null; slackMessageTs?: string | null }): Promise<void> {
  const { error } = await supabase.from('budget_approval').upsert({
    event_id: eventId, status: 'submitted', requested_amount: opts.requestedAmount,
    slack_channel: opts.slackChannel, slack_message_ts: opts.slackMessageTs ?? null,
    decline_reason: null, decided_via: null, decider_ref: null, decided_at: null, updated_at: new Date().toISOString(),
  }, { onConflict: 'event_id' });
  if (error) throw error;
}

/** Sanctioned assign path: set the target via the existing writer, THEN flip approval state.
 *  Target first so we never mark 'assigned' without the target actually written. */
export async function assignBudget(eventId: string, amount: number, decider: { via: 'app' | 'slack'; ref: string } = { via: 'app', ref: 'app' }): Promise<void> {
  await setEventBudgetTarget(eventId, amount);
  const { error } = await supabase.from('budget_approval').upsert({
    event_id: eventId, status: 'assigned', decline_reason: null,
    decided_via: decider.via, decider_ref: decider.ref, decided_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }, { onConflict: 'event_id' });
  if (error) throw error;
}

export async function declineBudget(eventId: string, reason: string, decider: { via: 'app' | 'slack'; ref: string } = { via: 'app', ref: 'app' }): Promise<void> {
  const { error } = await supabase.from('budget_approval').upsert({
    event_id: eventId, status: 'declined', decline_reason: reason,
    decided_via: decider.via, decider_ref: decider.ref, decided_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }, { onConflict: 'event_id' });
  if (error) throw error;
}
```

- [ ] **Step 3: Add the migrate-on-read bridge**

```ts
/** One-time bridge: if there's no DB row yet but localStorage has a non-draft scoping, seed the DB
 *  row from it (and set the target for an already-assigned record via the sanctioned path). Returns
 *  the resulting approval. Safe to call on every load — no-ops once a row exists. */
export async function migrateScopingApprovalIfNeeded(eventId: string): Promise<BudgetApproval | null> {
  const existing = await getBudgetApproval(eventId);
  if (existing) return existing;
  const mapped = scopingToApproval(loadScoping(eventId));
  if (!mapped) return null;
  if (mapped.status === 'assigned' && mapped.assignedAmount != null) {
    await assignBudget(eventId, mapped.assignedAmount);
    if (mapped.slackChannel) await supabase.from('budget_approval').update({ slack_channel: mapped.slackChannel }).eq('event_id', eventId);
  } else {
    await submitBudgetApproval(eventId, { requestedAmount: null, slackChannel: mapped.slackChannel });
  }
  return getBudgetApproval(eventId);
}
```

Add `import { scopingToApproval, loadScoping } from './scoping';` if not already importing from `./scoping` (db.ts currently does not import scoping — add the import at the top).

- [ ] **Step 4: Typecheck**

Run: `npx tsc -b`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/lib/db.ts
git commit -m "feat(budget): budget_approval client API (get/submit/assign/decline + migrate)"
```

---

### Task 4: Refactor `ScopingForm.tsx` to the DB approval

**Files:**
- Modify: `src/components/ScopingForm.tsx`

**Interfaces:**
- Consumes: `getBudgetApproval`, `submitBudgetApproval`, `migrateScopingApprovalIfNeeded`, `type BudgetApproval` (Task 3); `buildScopingSummary`, `loadScoping`/`saveScoping` (inputs only).

- [ ] **Step 1: Load approval from the DB (with migrate-on-read)**

Add state + effect near the top of the component (after `scoping` is loaded for inputs):

```tsx
const [approval, setApproval] = useState<BudgetApproval | null>(null);
useEffect(() => { void migrateScopingApprovalIfNeeded(plan.id).then(setApproval); }, [plan.id]);
```

Import: `import { slackSend, submitBudgetApproval, migrateScopingApprovalIfNeeded, type BudgetApproval, type EventPlanning } from "../lib/db";`

- [ ] **Step 2: Replace approval-field reads with `approval`**

Replace each reader (keep input reads on `scoping`):
- `const locked = scoping.status === "assigned";` → `const locked = approval?.status === "assigned";`
- `const submitted = scoping.status !== "draft";` → `const submitted = !!approval && approval.status !== "draft";` (approval is null when draft)
- status chip (116-118): use `approval?.status ?? "draft"` in place of `scoping.status`.
- `scoping.submittedSummary` (103,188-194): the summary is rebuilt from inputs; use the local `summary` computed at submit, or `buildScopingSummary(...)` for display. Replace `scoping.submittedSummary` reads with a computed `const summary = buildScopingSummary({ title: plan.title, date: plan.date, tags: plan.tags, scoping, roughTotal, link });` and gate on `submitted`.
- `scoping.submittedChannel` (191,227) → `approval?.slackChannel ?? "Slack"`.
- `scoping.assignedBudget` (204) → `approval?.status === "assigned" ? tgtAmount : null` where `tgtAmount` comes from the event target (`plan.eventBudgetTarget`); show `money(plan.eventBudgetTarget)`.
- `scoping.approvalComment` (205) → removed (no comment field in the new model; declines carry a reason, approvals don't). Delete that line.
- status text/buttons (226-232): drive off `approval?.status ?? "draft"`.

- [ ] **Step 3: Submit writes to the DB directly**

In the submit handler (around line 91-95), after `await slackSend(...)`:

```tsx
await slackSend(slackChannel.trim(), summary);
await submitBudgetApproval(plan.id, { requestedAmount: roughTotal, slackChannel: slackChannel.trim() });
setApproval(await migrateScopingApprovalIfNeeded(plan.id));
```

Remove the old `set({ status: "submitted", ... })` localStorage write of approval fields (keep any input saves).

- [ ] **Step 4: Typecheck**

Run: `npx tsc -b`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/components/ScopingForm.tsx
git commit -m "refactor(budget): ScopingForm reads/writes approval from the DB"
```

---

### Task 5: Refactor `EventPlanningPage.tsx` approval readers

**Files:**
- Modify: `src/components/EventPlanningPage.tsx`

**Interfaces:**
- Consumes: `getBudgetApproval` / `type BudgetApproval` (Task 3); existing `plan.eventBudgetTarget`.

- [ ] **Step 1: Load approval where the readers live**

The readers cluster in two components (the glance/summary around 3039-3085 and the digest/facts builder around 3346-3358) plus line 922. In each component that reads approval fields, add:

```tsx
const [approval, setApproval] = useState<BudgetApproval | null>(null);
useEffect(() => { void getBudgetApproval(eventId).then(setApproval); }, [eventId]);
```

Import: add `getBudgetApproval, type BudgetApproval` to the existing `../lib/db` import.

- [ ] **Step 2: Replace each reader (exact spots)**

- `:922` `const assignedBudget = loadScoping(eventId).assignedBudget;` → `const assignedBudget = approval?.status === "assigned" ? plan.eventBudgetTarget : null;` (this component already has `plan`; add the approval load from Step 1).
- `:3039-3040` `const submitted = scoping.status !== "draft";` → `const submitted = !!approval && approval.status !== "draft";`; `const assigned = approval?.status === "assigned" ? plan.eventBudgetTarget : null;`
- `:3067` `scoping.submittedAt` → `approval?.decidedAt ?? null` (or omit the Row if you prefer; decidedAt is the DB analogue).
- `:3085` `scoping.approvalComment` → replace with `approval?.declineReason` gated on `approval?.status === "declined"` (comment is gone; decline reason is the note now).
- `:3346` `if (scoping.assignedBudget != null)` → `if (approval?.status === "assigned" && plan.eventBudgetTarget != null)` then push `money(plan.eventBudgetTarget)`.
- `:3352` `const scopingSubmitted = scoping.status !== "draft";` → `const scopingSubmitted = !!approval && approval.status !== "draft";`
- `:3358` `const tgt = scoping.assignedBudget ?? facts.budget?.target ?? null;` → `const tgt = (approval?.status === "assigned" ? plan.eventBudgetTarget : null) ?? facts.budget?.target ?? null;`

Leave `loadScoping(eventId)` reads of **inputs** (e.g. `:3748` justification) unchanged.

- [ ] **Step 3: Typecheck**

Run: `npx tsc -b`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/components/EventPlanningPage.tsx
git commit -m "refactor(budget): EventPlanningPage reads approval from the DB"
```

---

### Task 6: Verify + apply to Cloud SQL

**Files:** none (verification + deploy step)

- [ ] **Step 1: Full verify**

Run: `npx tsc -b && npx vitest run`
Expected: tsc exit 0; all tests pass (incl. the 3 new `scopingApproval` tests).

- [ ] **Step 2: Migrate-on-read check (local)**

In the app (local), open an event that currently shows `submitted`/`assigned` (localStorage). Confirm it still shows that status (now sourced from the DB row created on first load). Reload → still correct, no duplicate row.

- [ ] **Step 3: Shared-state test (proves the migration)**

Assign a budget on an event in browser A. Open the same event in browser B (or a private window / after clearing A's `localStorage`). Expected: B shows `assigned` + the amount — approval state is no longer per-browser.

- [ ] **Step 4: Sanctioned-path check**

Confirm `assignBudget` moved `event.event_budget_target` (query it) and that no code writes that column except `setEventBudgetTarget`. Run: `grep -rn "event_budget_target" src/lib/db.ts` — Expected: only `setEventBudgetTarget` performs the `.update(...)`.

- [ ] **Step 5: Apply the migration to Cloud SQL** 🚩

The deploy does NOT run migrations. Apply `supabase/migrations/20260709000000_budget_approval.sql` to Cloud SQL (via cloud-sql-proxy + psql), then reload PostgREST (`NOTIFY pgrst, 'reload schema';` or restart the service) and confirm the grant lets PostgREST see the table. Verify live: after deploy, `getBudgetApproval` on an event returns `null` (not a PostgREST 404/permission error).

- [ ] **Step 6: Push (deploys the frontend)**

```bash
git push origin main
```
Then hard-refresh the live site and re-run Step 3 (shared-state) against the deployed URL.

---

## Self-review notes
- **Spec coverage:** table (T1), migrate-on-read pure mapper (T2) + bridge (T3), sanctioned assign via `setEventBudgetTarget` (T3), submit/assign/decline API (T3), attribution `decided_via`/`decider_ref` (T3), all enumerated readers refactored (T4/T5), shared-state + sanctioned-path + migrate tests (T6), Cloud SQL apply (T6). ✅
- **Amount source:** assigned amount is always `event.event_budget_target`; `budget_approval` never stores it. Consistent across T3–T5.
- **Known limitation:** `assignBudget` is two writes (target, then status) — not a single transaction over PostgREST; target-first ordering avoids a false 'assigned'. Accepted for v1.
