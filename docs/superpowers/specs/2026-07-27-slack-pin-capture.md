# Slack pin → EventHub capture (Phase 1: pipeline + ledger)

**Date:** 2026-07-27
**Status:** Approved (design) — Phase 1 of 3

## Problem & intent

Reacting to a Slack message with a specific emoji (`:eventhub:`) is a deliberate human act
of intent — "capture this into EventHub." The pin confirms *relevance*, not accuracy or
finality. We want that pin to process the message **plus its surrounding conversational
context** and land the resulting update(s) on the linked EventHub event as **proposed,
correctable** items — no pre-commit approval queue (the pin was the go-ahead), but nothing
auto-promoted to confirmed either.

The deployed functions server currently 404s on `POST /functions/v1/slack-events` (the
handler was added but does nothing yet); this phase makes it real.

## Scope

**Phase 1 (this spec):** the `:eventhub:` reaction handler, context fetch, LLM extraction,
and a unified `slack_capture` ledger that stores proposed captures idempotently, routed to
the event linked to the reacting channel, with ephemeral feedback to the reactor.

**Out of scope (later phases):**
- Phase 2 — in-app "From Slack" review surface: render captures per event/section,
  edit/dismiss, and **promote** proposed → confirmed (writing into `budget_line`,
  `deliverable`, `engagement`, notes, etc. honoring single-write-path + flag-don't-reconcile).
  Promotions must be **reversible** — record enough (created row id / prior value) that undo
  can roll the section write back, not just the ledger row.
- Phase 3 — Slack app operational config (emoji, event subscription, OAuth scopes).

## Principles (load-bearing)

- **Pin = intent, not approval gate.** Commit directly as `proposed`. No queue re-asking
  whether the item should exist.
- **Default status is always `proposed`**, even if the LLM thinks the value is settled.
  Promotion to `confirmed` is a separate deliberate human action (Phase 2).
- **Correctable ledger, not approval gate.** The "From Slack" feed is an editable record.
- **Idempotent.** Slack retries (the observed 502→retry) and re-pinning the same message
  must not duplicate — upsert on `(event_id, slack_channel, slack_ts, type)`.
- **Feedback is private to the reactor** — `chat.postEphemeral` to the reactor's user id
  only; the channel sees nothing beyond the reaction itself.
- **Intervene in exactly two cases:** (1) ambiguous radius, (2) conflict with committed data.
  Never silently overwrite.
- **Fully reversible.** Undo restores the exact pre-pin state — as if the message was never
  processed or accepted as truth. Removing the `:eventhub:` reaction is itself an undo.

## Data model (one migration — manual apply to Cloud SQL)

```sql
-- Optional link from an event to the Slack channel that talks about it.
alter table event add column if not exists slack_channel text;  -- Slack channel id, e.g. 'C0123'
create index if not exists event_slack_channel_idx on event(slack_channel);

-- Unified ledger of proposed captures pinned from Slack ("From Slack" feed).
create table if not exists slack_capture (
  id            text primary key,
  event_id      text not null references event(id) on delete cascade,
  slack_channel text not null,
  slack_ts      text not null,                 -- the pinned message ts
  type          text not null check (type in ('note','status','debrief','people','budget','vendor','other')),
  payload       jsonb not null,                -- typed extraction (shape per type)
  status        text not null default 'proposed' check (status in ('proposed','dismissed','confirmed')),
  confidence    real,                          -- 0..1 from the LLM
  source_ref    text,                          -- Slack permalink to the pinned message
  context_ts    jsonb,                         -- resolved provenance: {first, last} message ts the capture read
  flags         jsonb not null default '{}',   -- { ambiguity?: {question}, conflict?: {field, existing} }
  reactor_user  text,                          -- Slack user id who pinned
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (event_id, slack_channel, slack_ts, type)
);
create index if not exists slack_capture_event_idx on slack_capture(event_id);
create index if not exists slack_capture_status_idx on slack_capture(status);
grant select, insert, update on slack_capture to anon, authenticated;  -- Phase 2 reads/edits
```

People captures ALSO fan out to the existing `person_tag` (source='slack', status='proposed',
source_ref=permalink) — it already implements propose-then-confirm. Other types live in the
ledger until Phase 2 promotion.

## Pipeline — `cloud-functions/src/functions/slack-events.ts` (`onReactionAdded`)

1. **Filter:** ignore reactions whose `reaction !== 'eventhub'`, and non-message items.
2. **Resolve event:** `select … from event where slack_channel = item.channel`.
   - none → `chat.postEphemeral` to reactor: "This channel isn't linked to an EventHub event
     — link it from the event, then re-pin." Stop.
   - multiple → pick the most recent by `event_date`; note the choice in the ephemeral
     ("captured to <event> — wrong one? open it in EventHub"). (Full picker deferred.)
3. **Fetch context (adaptive, bounded — config constants, not magic numbers):**
   - If the message has `thread_ts`: fetch the whole thread via `conversations.replies`.
   - Else top-level: `conversations.history` around it — `CTX_BEFORE=20` messages before,
     `CTX_AFTER=5` after (bias backward — context precedes decisions).
   - Hard cap: `CTX_MAX=30` messages or `CTX_MAX_SPAN=3h`, whichever is smaller.
4. **Extract (one Anthropic call):** pass the fetched window with the pinned message marked.
   Claude must (a) select only messages in the *same* conversation/decision as the pin,
   (b) extract 0..n typed capture proposals from just those, (c) if the window spans two
   distinct topics, extract only the one containing the pin and surface the other as a
   *possible separate* capture rather than merging. It returns, per proposal: `type`,
   `payload`, `confidence`, `contextTs {first,last}` (the resolved boundary), and optional
   `ambiguity {question}`.
5. **Conflict check (best-effort, Phase 1):** for `budget`/`vendor`/`status` proposals,
   compare against existing committed data on the event (e.g. a budget already set); if it
   would overwrite, set `flags.conflict` — never write over committed data (enforced at
   promotion in Phase 2).
6. **Persist:** upsert each proposal into `slack_capture` (idempotent key); people also upsert
   into `person_tag`. Re-processing the same pin updates the existing rows.
7. **Acknowledge:** `chat.postEphemeral` to the reactor listing what was captured (per type,
   one line each), any ambiguity question ("$4k — budget or venue cost?"), any conflict
   ("budget already set — landed as proposed, won't overwrite"), and "edit/dismiss in EventHub."

Handshake + signature verification already exist in the committed `slack-events.ts`
(`routeSlackEvent` → `url_verification` challenge, raw-body HMAC via `verifySlackSignature`,
fast ack). This phase fills in `onReactionAdded`.

## Undo / reversibility

The pin can be taken back cleanly — undo restores the exact pre-pin state, as if the message
was never processed. Three equivalent entry points, all resolving to the same operation:

- **Un-react** — `reaction_removed` of `:eventhub:` on the same message (the natural gesture).
- **"Undo" in the ephemeral** — the reactor-only Slack message carries an Undo action
  (`block_actions`, routed through the existing `slack-interactions` handler).
- **Dismiss in-app** — from the "From Slack" feed (Phase 2 surface).

**The operation (Phase 1):** delete every `slack_capture` row for that pin
(`event_id`, `slack_channel`, `slack_ts` — all `type`s) plus the fanned-out `person_tag` rows
carrying that pin's `source_ref`. Because Phase-1 captures are all `proposed` and nothing has
been promoted, deleting them fully restores prior state. Undo is **idempotent** (safe to fire
twice; deleting an already-gone capture is a no-op) — important given un-react + ephemeral
Undo could both arrive. Re-pinning after an undo simply re-creates the captures.

**Phase 2:** once a capture is promoted (written into `budget_line`/`deliverable`/etc.), undo
must also reverse that section write — so promotion records a reversal handle (created row id,
or the prior value it replaced). Undo rolls back the section write, then removes the ledger
row. This is why promotions store reversal data (see Scope).

## Payload shapes (per `type`)

- `note`: `{ text }` — the captured statement.
- `status`: `{ target: 'deliverable'|'engagement', name, status: 'Todo'|'In Progress'|'Done' }`.
- `debrief`: the `extract-debrief` outcome subset `{ verdict, worthRepeating, turnoutActual, ... }`.
- `people`: `{ name, org?, lens?: 'candidate'|'prospect'|'partner', why? }` (→ `person_tag`).
- `budget`: `{ category, vendor?, amount?, note? }`.
- `vendor`: `{ category, vendor, link?, note? }`.
- `other`: `{ text }` — captured but untyped; triaged in Phase 2.

## Build / deploy notes

- **cloud-functions only** — Slack handlers have no Deno/`supabase/functions` twin; do not
  add one. Local dev won't exercise this (Supabase stack); test against a deployed instance.
- **Migration is manual** — the deploy has no migration step; apply `slack_capture` +
  `event.slack_channel` to Cloud SQL via cloud-sql-proxy before/with the deploy.
- **Scopes/config (Phase 3, required to test end-to-end):** `:eventhub:` emoji,
  `reaction_added` + `reaction_removed` event subscriptions, `reactions:read`, `channels:history`/`groups:history`,
  `conversations.replies`, `chat:write`; bot must be a member of the channel.
  `SLACK_SIGNING_SECRET` + `SLACK_BOT_TOKEN` are already deployed.
- Window sizes (`CTX_BEFORE/AFTER/MAX/MAX_SPAN`) are named constants — expected to be tuned
  against real channel behavior.

## Testing

Pure, table-driven unit tests (TDD) — no Slack, no LLM:
- **event resolution:** channel→event (none / one / multiple→most-recent-by-date).
- **idempotency:** same `(event_id, channel, ts, type)` upserts, never duplicates;
  re-process updates in place.
- **context window bounds:** thread → replies path; top-level → 20/5 with the 30-msg / 3h cap.
- **capture → person_tag mapping** for `people`.
- **conflict detection:** budget/vendor/status vs existing committed data sets `flags.conflict`.
- **ephemeral message composition:** given captures + flags → the reactor-facing summary lines.

The Anthropic extraction (window → typed proposals + same-conversation narrowing) gets a thin
integration check with a couple of fixed transcripts, not a unit assertion on model output.

## Verification

- `npx tsc` (cloud-functions) clean; cloud-functions vitest green incl. new tests.
- Migration applied to Cloud SQL (verify columns/table exist).
- End-to-end (post-deploy): pin `:eventhub:` on a message in a linked channel → a
  `slack_capture` row appears (status `proposed`) + an ephemeral reply to the reactor; the
  prod `/functions/v1/slack-events` 404s become 200s in the logs; re-pinning does not
  duplicate.
