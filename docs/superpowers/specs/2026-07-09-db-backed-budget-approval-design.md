# Phase 0 — DB-backed Budget Approval (design)

## Goal
Move the budget-**approval workflow** out of `localStorage` into the database, so approval state is
shared across users and can be written by a server-side caller (the Phase 1 Slack endpoint). Scoping
**inputs** (type, audience, headcount, venue, components, justification, exec sponsor) stay in
localStorage for now.

This is the prerequisite for "Slack budget approval — interactive Approve/Decline": a Slack button
click runs server-side and needs the approval state to be in the DB, not in the requester's browser.

## Non-goals / deferred
- Moving scoping **inputs** to the DB (separate future effort).
- The Slack interactive layer itself (Phase 1).
- Restricting **who** can approve (build against the captured decider later).
- **Decline history** — one row per event keeps only the current outcome; re-decline overwrites.
  Accepted tradeoff for v1 (noted deliberately).

## Decisions (locked)
1. **Approval-workflow fields only** move to the DB; inputs stay in localStorage.
2. Storage: a dedicated **`budget_approval`** table, one row per event.
3. **Migrate-on-read** for existing in-flight approvals (localStorage → DB, one-time bridge).
4. **Current outcome only** — no history/audit log table.
5. **Single write path to the target:** `assignBudget` calls the existing `setEventBudgetTarget`
   (db.ts:2616) — the refactor must NOT open a second writer to `event.event_budget_target`.
6. **Attribution tolerates an app-side approver** — the form-link path approves with no Slack id.

## Data model — `budget_approval` (one row per event)
| column | type | notes |
|---|---|---|
| `event_id` | text, PK, FK→event.id ON DELETE CASCADE | one approval per event |
| `status` | text NOT NULL | `submitted` \| `assigned` \| `declined` (submitted = pending) |
| `requested_amount` | numeric null | rough total at submit |
| `decline_reason` | text null | required when `declined` |
| `decided_via` | text null | `app` \| `slack` (who-channel; supports adjustment #6) |
| `decider_ref` | text null | Slack user id when `slack`; app profile id/name when `app` |
| `decided_at` | timestamptz null | |
| `slack_channel` | text null | for Phase 1 message-update / re-send |
| `slack_message_ts` | text null | for Phase 1 message-update / re-send |
| `created_at` | timestamptz default now() | |
| `updated_at` | timestamptz default now() | |

**Assigned amount is NOT stored here** — it reuses the existing `event.event_budget_target`. On
approve, `assignBudget` sets the target via `setEventBudgetTarget` AND flips
`budget_approval.status='assigned'` (+ decided_* fields) — the two writes are one operation.

Migration file: `supabase/migrations/2026-07-09-000000_budget_approval.sql` (create table + grants so
PostgREST exposes it). **🚩 Deploy parity:** must be applied to **Cloud SQL** manually — the deploy
has no migration step — and PostgREST on live needs the table granted + a schema reload.

## Client API (`src/lib/db.ts`) — the sanctioned path
- `getBudgetApproval(eventId): Promise<BudgetApproval | null>` — reads the row (migrate-on-read
  bridge lives in the ScopingForm load, not here; see below).
- `submitBudgetApproval(eventId, { requestedAmount, slackChannel, slackMessageTs })` — upsert
  `status='submitted'`. Used by **new** submissions, writing to the DB directly.
- `assignBudget(eventId, amount, decider?: { via: 'app'|'slack', ref: string })`
  → calls `setEventBudgetTarget(eventId, amount)` (sanctioned target write) **then** upserts
  `budget_approval` `status='assigned'`, `decided_via`, `decider_ref`, `decided_at`. Default decider
  `{ via:'app', ref:<current app profile> }` when called from the UI.
- `declineBudget(eventId, reason, decider?)` → upsert `status='declined'`, `decline_reason`,
  decided_* fields. Does NOT touch the target.

`BudgetApproval` type: `{ eventId, status, requestedAmount, declineReason, decidedVia, deciderRef,
decidedAt, slackChannel, slackMessageTs }`.

## Migrate-on-read (bridge only)
A pure mapper `scopingToApproval(local: ScopingForm): { status, requestedAmount, ... } | null`
(returns null for `status:'draft'`). On the first load of an event where `getBudgetApproval` returns
null **and** localStorage shows a non-draft scoping, upsert the mapped row once. From then on the DB
is authoritative. **New submissions never go through this** — they call `submitBudgetApproval`
directly. Be explicit in code comments which path is the one-time bridge vs the live path.

## Blast radius — every reader of the old approval fields (must switch to `getBudgetApproval`)
- **`ScopingForm.tsx`**: status chip + `locked`/`submitted` (76,77,116-118), `submittedSummary`/
  `submittedChannel` (103,188-194,227), `assignedBudget`/`approvalComment` (204-205), submit/reopen
  actions (231-232). Submit now calls `submitBudgetApproval`; reopen updates DB.
- **`EventPlanningPage.tsx`**: `:922` assignedBudget; `:3039-3040` submitted/assigned; `:3067`
  submittedAt; `:3085` approvalComment; `:3346` digest assignedBudget; `:3352` scopingSubmitted;
  `:3358` `tgt = assignedBudget ?? facts.budget?.target`.
- **Unchanged (inputs stay local):** `EventPlanningPage:3748` (justification), `EventsPage:340`
  (audience/venue/etc.), `EventsPage:1018` (save new-event inputs), `EventPlanningPage:3314/3321`
  (input state via loadScoping/saveScoping).

A missed approval-field reader = silent stale state; the enumeration above is the checklist.

## Testing
- **Unit (pure):** `scopingToApproval` mapping — draft→null, submitted→row, assigned→row with amount.
  (Matches existing pure-logic test pattern: dedup/scoping tests.)
- **Shared-state (the one that proves the migration):** assign a budget in browser A → open the same
  event in browser B (or after clearing A's localStorage) → B sees `assigned` + the amount. This is
  what demonstrates approval state is no longer per-browser. Manual (no DB test harness exists).
- **Sanctioned-path:** `assignBudget` changes `event.event_budget_target` via `setEventBudgetTarget`
  (no second write path); status flips to `assigned` atomically-enough (both writes, error-handled).
- **Migrate-on-read:** an event with only localStorage `submitted` state → first load creates the DB
  row; subsequent loads read DB, don't re-migrate.

## 🚩 Deploy parity summary
- `budget_approval` migration → **apply to Cloud SQL manually** + PostgREST grant/schema reload.
- `db.ts` + component changes → auto-deploy on push.
- No new secret or cloud-function for Phase 0 (that's Phase 1).
