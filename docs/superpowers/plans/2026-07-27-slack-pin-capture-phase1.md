# Slack pin → capture ledger (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn an `:eventhub:` Slack reaction into proposed, idempotent, reversible capture rows on the event linked to that channel — processing the pinned message plus adaptive surrounding context via Claude — and un-react/undo to fully revert.

**Architecture:** Pure decision logic (event resolution, deterministic ids, context bounds, conflict flags, person_tag mapping, ephemeral text) lives in a testable `slack-capture-lib.ts`. Thin I/O adapters wrap the Slack Web API (`slack-api.ts`) and Claude extraction (`slack-extract.ts`). `slack-events.ts`'s `onReactionAdded`/`onReactionRemoved` orchestrate them and persist via the existing `getServiceClient()`.

**Tech Stack:** TypeScript (Node/Express, cloud-functions), `@anthropic-ai/sdk` (`claude-haiku-4-5`), `@supabase/supabase-js` over PostgREST, vitest.

## Global Constraints

- **cloud-functions only** — Slack handlers have no `supabase/functions` (Deno) twin; do NOT add one.
- **Migration is manual** — deploy has no migration step; the SQL must be applied to Cloud SQL (`event-499220:us-central1:eventhub-db`) via cloud-sql-proxy separately.
- **Default capture status is always `proposed`.** Never auto-confirm.
- **Idempotent** — deterministic primary key `${eventId}:${channel}:${ts}:${type}`; re-pin/retry upserts, never duplicates.
- **Fully reversible** — un-react (`reaction_removed`) or Undo deletes all captures for a pin, restoring pre-pin state.
- **Feedback is reactor-private** — `chat.postEphemeral` to the reactor's user id only.
- Anthropic call shape (mirror `extract-debrief.ts`): `client.messages.create({ model: 'claude-haiku-4-5', max_tokens, system, messages, output_config: { format: { type: 'json_schema', schema } } })`, then `JSON.parse(resp.content.find(b => b.type === 'text').text)`.
- Context window constants: `CTX_BEFORE=20`, `CTX_AFTER=5`, `CTX_MAX=30`, `CTX_MAX_SPAN_MS=3*60*60*1000`.

---

### Task 1: Migration — `event.slack_channel` + `slack_capture` ledger

**Files:**
- Create: `supabase/migrations/20260727000000_slack_capture.sql`

**Interfaces:**
- Produces: table `slack_capture` and column `event.slack_channel`, consumed by all later tasks.

- [ ] **Step 1: Write the migration**

```sql
-- Optional link from an event to the Slack channel that discusses it.
alter table event add column if not exists slack_channel text;
create index if not exists event_slack_channel_idx on event(slack_channel);

-- Unified ledger of proposed captures pinned from Slack ("From Slack" feed).
create table if not exists slack_capture (
  id            text primary key,                  -- deterministic: eventId:channel:ts:type
  event_id      text not null references event(id) on delete cascade,
  slack_channel text not null,
  slack_ts      text not null,
  type          text not null check (type in ('note','status','debrief','people','budget','vendor','other')),
  payload       jsonb not null,
  status        text not null default 'proposed' check (status in ('proposed','dismissed','confirmed')),
  confidence    real,
  source_ref    text,
  context_ts    jsonb,
  flags         jsonb not null default '{}',
  reactor_user  text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists slack_capture_event_idx on slack_capture(event_id);
create index if not exists slack_capture_status_idx on slack_capture(status);
grant select, insert, update, delete on slack_capture to anon, authenticated;
```

- [ ] **Step 2: Sanity-check it applies (local Supabase)**

Run: `supabase db reset --debug 2>&1 | tail -20` (or apply this file with `psql` against a scratch DB).
Expected: no SQL errors; `slack_capture` and `event.slack_channel` exist.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260727000000_slack_capture.sql
git commit -m "migration: slack_capture ledger + event.slack_channel link"
```

(Prod apply to Cloud SQL is a manual deploy step — tracked in Task 6.)

---

### Task 2: Pure capture logic — `slack-capture-lib.ts` (TDD)

**Files:**
- Create: `cloud-functions/src/functions/slack-capture-lib.ts`
- Test: `cloud-functions/src/functions/slack-capture-lib.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type CaptureType = 'note'|'status'|'debrief'|'people'|'budget'|'vendor'|'other';
  export interface SlackMsg { ts: string; text: string; user?: string; thread_ts?: string }
  export interface EventRow { id: string; name?: string; event_date?: string | null; slack_channel?: string | null }
  export interface Proposal { type: CaptureType; payload: any; confidence?: number; contextTs?: { first: string; last: string }; ambiguity?: { question: string } }
  export interface StoredCapture { id: string; event_id: string; slack_channel: string; slack_ts: string; type: CaptureType; payload: any; status: 'proposed'; confidence: number | null; source_ref: string | null; context_ts: any; flags: Record<string, unknown>; reactor_user: string | null }
  export function captureId(eventId: string, channel: string, ts: string, type: CaptureType): string
  export function resolveEvent(events: EventRow[], channelId: string): EventRow | null
  export function contextBounds(msgs: SlackMsg[], pinnedTs: string, now?: number): SlackMsg[]
  export function detectConflict(p: Proposal, committed: { budget?: boolean }): { field: string } | null
  export function buildCaptures(event: EventRow, channel: string, pinnedTs: string, reactor: string | null, sourceRef: string | null, proposals: Proposal[], committed: { budget?: boolean }): StoredCapture[]
  export function composeEphemeral(eventName: string, caps: StoredCapture[]): string
  ```
- Consumes: nothing (pure).

- [ ] **Step 1: Write the failing tests**

Create `cloud-functions/src/functions/slack-capture-lib.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { captureId, resolveEvent, contextBounds, detectConflict, buildCaptures, composeEphemeral,
  type EventRow, type SlackMsg, type Proposal } from "./slack-capture-lib.js";

const ev = (id: string, ch: string | null, date: string | null = null): EventRow => ({ id, slack_channel: ch, event_date: date, name: id });

describe("captureId", () => {
  it("is deterministic per (event,channel,ts,type)", () => {
    expect(captureId("e1", "C1", "111.2", "budget")).toBe("e1:C1:111.2:budget");
    expect(captureId("e1", "C1", "111.2", "budget")).toBe(captureId("e1", "C1", "111.2", "budget"));
  });
});

describe("resolveEvent", () => {
  it("returns null when no event is linked to the channel", () => {
    expect(resolveEvent([ev("e1", "CX")], "C1")).toBeNull();
  });
  it("returns the single linked event", () => {
    expect(resolveEvent([ev("e1", "C1"), ev("e2", "CX")], "C1")?.id).toBe("e1");
  });
  it("picks the most recent by event_date when several share the channel", () => {
    const got = resolveEvent([ev("old", "C1", "2026-01-01"), ev("new", "C1", "2026-09-01")], "C1");
    expect(got?.id).toBe("new");
  });
});

describe("contextBounds", () => {
  const msg = (ts: string, text = "m"): SlackMsg => ({ ts, text });
  it("caps to CTX_MAX messages centered on availability, keeping the pin", () => {
    const msgs = Array.from({ length: 50 }, (_, i) => msg(String(1000 + i)));
    const out = contextBounds(msgs, "1030", 1_000_000 * 1000);
    expect(out.length).toBeLessThanOrEqual(30);
    expect(out.some((m) => m.ts === "1030")).toBe(true);
  });
  it("drops messages older than the 3h span from the pin", () => {
    const pinSec = 1_000_000;                       // pin at ts=1_000_000 (seconds)
    const msgs = [msg(String(pinSec - 4 * 3600)), msg(String(pinSec - 60)), msg(String(pinSec))];
    const out = contextBounds(msgs, String(pinSec), pinSec * 1000);
    expect(out.find((m) => m.ts === String(pinSec - 4 * 3600))).toBeUndefined();
    expect(out.length).toBe(2);
  });
});

describe("detectConflict", () => {
  it("flags a budget proposal when a budget is already committed", () => {
    expect(detectConflict({ type: "budget", payload: { amount: 4000 } }, { budget: true })).toEqual({ field: "budget" });
  });
  it("returns null when no conflict", () => {
    expect(detectConflict({ type: "note", payload: { text: "x" } }, { budget: true })).toBeNull();
    expect(detectConflict({ type: "budget", payload: { amount: 1 } }, { budget: false })).toBeNull();
  });
});

describe("buildCaptures", () => {
  const props: Proposal[] = [
    { type: "note", payload: { text: "kickoff moved" }, confidence: 0.9, contextTs: { first: "1", last: "2" } },
    { type: "budget", payload: { amount: 4000 }, confidence: 0.7 },
  ];
  it("stamps deterministic ids, proposed status, provenance, and conflict flags", () => {
    const caps = buildCaptures(ev("e1", "C1"), "C1", "111.2", "U9", "https://link", props, { budget: true });
    expect(caps).toHaveLength(2);
    expect(caps[0]).toMatchObject({ id: "e1:C1:111.2:note", event_id: "e1", status: "proposed", reactor_user: "U9", source_ref: "https://link" });
    const budget = caps.find((c) => c.type === "budget")!;
    expect(budget.flags).toEqual({ conflict: { field: "budget" } });
  });
});

describe("composeEphemeral", () => {
  it("lists captures and surfaces ambiguity/conflict for the reactor", () => {
    const caps = buildCaptures(ev("e1", "C1"), "C1", "1.2", "U9", null,
      [{ type: "budget", payload: { amount: 4000 }, ambiguity: { question: "$4k — budget or venue cost?" } }], { budget: true });
    const text = composeEphemeral("Toronto Summit", caps);
    expect(text).toContain("Toronto Summit");
    expect(text).toContain("budget");
    expect(text).toMatch(/budget or venue cost/);
    expect(text).toMatch(/already set|won't overwrite|conflict/i);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd cloud-functions && npx vitest run src/functions/slack-capture-lib.test.ts`
Expected: FAIL — module not found / exports undefined.

- [ ] **Step 3: Implement the library**

Create `cloud-functions/src/functions/slack-capture-lib.ts`:

```ts
export type CaptureType = 'note' | 'status' | 'debrief' | 'people' | 'budget' | 'vendor' | 'other';
export interface SlackMsg { ts: string; text: string; user?: string; thread_ts?: string }
export interface EventRow { id: string; name?: string; event_date?: string | null; slack_channel?: string | null }
export interface Proposal { type: CaptureType; payload: any; confidence?: number; contextTs?: { first: string; last: string }; ambiguity?: { question: string } }
export interface StoredCapture {
  id: string; event_id: string; slack_channel: string; slack_ts: string; type: CaptureType;
  payload: any; status: 'proposed'; confidence: number | null; source_ref: string | null;
  context_ts: any; flags: Record<string, unknown>; reactor_user: string | null;
}

export const CTX_BEFORE = 20, CTX_AFTER = 5, CTX_MAX = 30, CTX_MAX_SPAN_MS = 3 * 60 * 60 * 1000;

export function captureId(eventId: string, channel: string, ts: string, type: CaptureType): string {
  return `${eventId}:${channel}:${ts}:${type}`;
}

// Event linked to this channel; when several share it, the soonest/most-recent by event_date wins.
export function resolveEvent(events: EventRow[], channelId: string): EventRow | null {
  const linked = events.filter((e) => e.slack_channel === channelId);
  if (linked.length === 0) return null;
  if (linked.length === 1) return linked[0];
  return [...linked].sort((a, b) => String(b.event_date ?? '').localeCompare(String(a.event_date ?? '')))[0];
}

// Trim a fetched window to the cap: within CTX_MAX_SPAN_MS of the pin, at most CTX_MAX messages,
// always keeping the pin. Slack ts is "<epoch-seconds>.<seq>".
export function contextBounds(msgs: SlackMsg[], pinnedTs: string, now: number = Date.now()): SlackMsg[] {
  const sec = (ts: string) => Math.floor(Number(ts) * (ts.includes('.') ? 1 : 1)); // ts already in seconds
  const pinSec = Number(pinnedTs);
  const withinSpan = msgs.filter((m) => Math.abs(Number(m.ts) - pinSec) * 1000 <= CTX_MAX_SPAN_MS);
  const sorted = [...withinSpan].sort((a, b) => Number(a.ts) - Number(b.ts));
  if (sorted.length <= CTX_MAX) return sorted;
  // Keep CTX_MAX around the pin, biased backward.
  const pinIdx = sorted.findIndex((m) => m.ts === pinnedTs);
  const start = Math.max(0, Math.min(pinIdx - CTX_BEFORE, sorted.length - CTX_MAX));
  return sorted.slice(start, start + CTX_MAX);
  void sec;
}

export function detectConflict(p: Proposal, committed: { budget?: boolean }): { field: string } | null {
  if (p.type === 'budget' && committed.budget) return { field: 'budget' };
  return null;
}

export function buildCaptures(
  event: EventRow, channel: string, pinnedTs: string, reactor: string | null,
  sourceRef: string | null, proposals: Proposal[], committed: { budget?: boolean },
): StoredCapture[] {
  return proposals.map((p) => {
    const conflict = detectConflict(p, committed);
    const flags: Record<string, unknown> = {};
    if (p.ambiguity) flags.ambiguity = p.ambiguity;
    if (conflict) flags.conflict = conflict;
    return {
      id: captureId(event.id, channel, pinnedTs, p.type),
      event_id: event.id, slack_channel: channel, slack_ts: pinnedTs, type: p.type,
      payload: p.payload, status: 'proposed', confidence: p.confidence ?? null,
      source_ref: sourceRef, context_ts: p.contextTs ?? null, flags, reactor_user: reactor,
    };
  });
}

export function composeEphemeral(eventName: string, caps: StoredCapture[]): string {
  const lines = [`Captured to *${eventName}* (proposed — edit or dismiss in EventHub):`];
  for (const c of caps) {
    lines.push(`• ${c.type}: ${summarize(c.payload)}`);
    const f = c.flags as any;
    if (f.ambiguity?.question) lines.push(`   ↳ ${f.ambiguity.question}`);
    if (f.conflict?.field) lines.push(`   ↳ ${f.conflict.field} already set — landed as proposed, won't overwrite.`);
  }
  return lines.join('\n');
}

function summarize(payload: any): string {
  if (payload?.text) return String(payload.text).slice(0, 80);
  return Object.entries(payload ?? {}).map(([k, v]) => `${k}=${v}`).join(', ').slice(0, 80);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd cloud-functions && npx vitest run src/functions/slack-capture-lib.test.ts`
Expected: PASS — all green.

- [ ] **Step 5: Commit**

```bash
git add cloud-functions/src/functions/slack-capture-lib.ts cloud-functions/src/functions/slack-capture-lib.test.ts
git commit -m "feat(slack): pure capture logic — id/resolve/context/conflict/compose"
```

---

### Task 3: Slack Web API adapters — `slack-api.ts`

**Files:**
- Create: `cloud-functions/src/lib/slack-api.ts`

**Interfaces:**
- Consumes: `SlackMsg` from Task 2; `process.env.SLACK_BOT_TOKEN`.
- Produces:
  ```ts
  export function fetchContext(channel: string, ts: string, threadTs: string | undefined): Promise<SlackMsg[]>
  export function getPermalink(channel: string, ts: string): Promise<string | null>
  export function postEphemeral(channel: string, user: string, text: string): Promise<void>
  ```

- [ ] **Step 1: Implement the adapters** (thin I/O — verified by the end-to-end run in Task 6, not a unit test)

Create `cloud-functions/src/lib/slack-api.ts`:

```ts
import type { SlackMsg } from '../functions/slack-capture-lib.js';
import { CTX_BEFORE, CTX_AFTER } from '../functions/slack-capture-lib.js';

const api = async (method: string, params: Record<string, string>) => {
  const url = `https://slack.com/api/${method}?${new URLSearchParams(params)}`;
  const r = await fetch(url, { headers: { authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}` } });
  return await r.json() as any;
};

// Thread → whole thread; else a window around the pin (biased backward). Caller trims via contextBounds.
export async function fetchContext(channel: string, ts: string, threadTs: string | undefined): Promise<SlackMsg[]> {
  if (threadTs) {
    const r = await api('conversations.replies', { channel, ts: threadTs, limit: '100' });
    return (r.messages ?? []).map((m: any) => ({ ts: m.ts, text: m.text ?? '', user: m.user, thread_ts: m.thread_ts }));
  }
  const before = await api('conversations.history', { channel, latest: ts, inclusive: 'true', limit: String(CTX_BEFORE + 1) });
  const after = await api('conversations.history', { channel, oldest: ts, inclusive: 'false', limit: String(CTX_AFTER) });
  const merged = [...(before.messages ?? []), ...(after.messages ?? [])];
  return merged.map((m: any) => ({ ts: m.ts, text: m.text ?? '', user: m.user, thread_ts: m.thread_ts }));
}

export async function getPermalink(channel: string, ts: string): Promise<string | null> {
  const r = await api('chat.getPermalink', { channel, message_ts: ts });
  return r.ok ? r.permalink : null;
}

export async function postEphemeral(channel: string, user: string, text: string): Promise<void> {
  const r = await fetch('https://slack.com/api/chat.postEphemeral', {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`, 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ channel, user, text }),
  });
  const j = await r.json() as any;
  if (!j.ok) console.error(JSON.stringify({ fn: 'slack-api', op: 'postEphemeral', error: j.error }));
}
```

- [ ] **Step 2: Type-check**

Run: `cd cloud-functions && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add cloud-functions/src/lib/slack-api.ts
git commit -m "feat(slack): Web API adapters — fetchContext / permalink / postEphemeral"
```

---

### Task 4: Claude extraction — `slack-extract.ts`

**Files:**
- Create: `cloud-functions/src/functions/slack-extract.ts`

**Interfaces:**
- Consumes: `SlackMsg`, `Proposal` from Task 2; `process.env.ANTHROPIC_API_KEY`.
- Produces: `export function extractCaptures(pinnedTs: string, msgs: SlackMsg[]): Promise<Proposal[]>`

- [ ] **Step 1: Implement extraction** (thin LLM I/O — integration-checked in Task 6)

Create `cloud-functions/src/functions/slack-extract.ts`:

```ts
import Anthropic from '@anthropic-ai/sdk';
import type { SlackMsg, Proposal } from './slack-capture-lib.js';

const SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    proposals: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          type: { enum: ['note', 'status', 'debrief', 'people', 'budget', 'vendor', 'other'] },
          payload: { type: 'object', description: 'fields for the type; see instructions' },
          confidence: { type: 'number' },
          contextTs: { type: 'object', additionalProperties: false, properties: { first: { type: 'string' }, last: { type: 'string' } }, required: ['first', 'last'] },
          ambiguity: { type: ['object', 'null'], additionalProperties: false, properties: { question: { type: 'string' } } },
        },
        required: ['type', 'payload', 'confidence', 'contextTs'],
      },
    },
  },
  required: ['proposals'],
};

const SYSTEM = `You extract EventHub updates from a Slack conversation. One message is marked <PINNED>. \
Only consider messages that are part of the SAME conversation/decision as the pinned one — treat unrelated chatter as noise. \
If the window clearly spans two distinct topics, extract only the one containing the pin. \
Return 0..n proposals. Each proposal: type ∈ note|status|debrief|people|budget|vendor|other, a payload with the fields for that type \
(note {text}; status {target,name,status}; people {name,org?,lens?,why?}; budget {category,vendor?,amount?,note?}; vendor {category,vendor,link?,note?}; other {text}), \
a confidence 0..1, contextTs {first,last} = the ts range of messages you actually used, and ambiguity {question} only if the value's meaning is genuinely unclear (e.g. a bare number that could be budget or venue cost). No preamble.`;

export async function extractCaptures(pinnedTs: string, msgs: SlackMsg[]): Promise<Proposal[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return [];
  const transcript = msgs.map((m) => `${m.ts === pinnedTs ? '<PINNED> ' : ''}[${m.ts}] ${m.user ?? '?'}: ${m.text}`).join('\n');
  const client = new Anthropic({ apiKey });
  const resp = await (client.messages.create as any)({
    model: 'claude-haiku-4-5',
    max_tokens: 4000,
    system: SYSTEM,
    messages: [{ role: 'user', content: `Conversation:\n${transcript}` }],
    output_config: { format: { type: 'json_schema', schema: SCHEMA } },
  });
  const textBlock = (resp.content as any[]).find((b: any) => b.type === 'text');
  if (!textBlock) return [];
  try { return (JSON.parse(textBlock.text).proposals ?? []) as Proposal[]; }
  catch { console.error(JSON.stringify({ fn: 'slack-extract', error: 'invalid json', raw: textBlock.text })); return []; }
}
```

- [ ] **Step 2: Type-check + commit**

Run: `cd cloud-functions && npx tsc --noEmit` → no errors.
```bash
git add cloud-functions/src/functions/slack-extract.ts
git commit -m "feat(slack): Claude extraction of typed capture proposals"
```

---

### Task 5: Orchestrate + persist + undo in `slack-events.ts`

**Files:**
- Modify: `cloud-functions/src/functions/slack-events.ts`

**Interfaces:**
- Consumes: Tasks 2–4 + `getServiceClient()` from `../db.js`.
- Produces: filled `onReactionAdded`; new `onReactionRemoved`; `handler` routes both reaction types.

- [ ] **Step 1: Route both reaction types in `handler`**

In `slack-events.ts`, replace the `if (decision.event?.type === 'reaction_added')` block in `handler` with:

```ts
  const ev = decision.event;
  if (ev?.reaction === 'eventhub' && ev?.item?.type === 'message') {
    const work = ev.type === 'reaction_added' ? onReactionAdded(ev)
      : ev.type === 'reaction_removed' ? onReactionRemoved(ev)
      : null;
    if (work) work.catch((e) => console.error(JSON.stringify({ fn: 'slack-events', error: String((e as Error)?.message ?? e) })));
  }
```

- [ ] **Step 2: Implement `onReactionAdded`** — replace the stub with:

```ts
import { getServiceClient } from '../db.js';
import { fetchContext, getPermalink, postEphemeral } from '../lib/slack-api.js';
import { extractCaptures } from './slack-extract.js';
import { resolveEvent, contextBounds, buildCaptures, composeEphemeral, type EventRow } from './slack-capture-lib.js';

async function onReactionAdded(event: any) {
  const channel: string = event.item.channel;
  const ts: string = event.item.ts;
  const reactor: string = event.user;
  const sb = getServiceClient();

  const { data: events } = await sb.from('event').select('id, name, event_date, slack_channel').eq('slack_channel', channel);
  const target = resolveEvent((events ?? []) as EventRow[], channel);
  if (!target) { await postEphemeral(channel, reactor, "This channel isn't linked to an EventHub event yet — link it from the event, then re-pin."); return; }

  const raw = await fetchContext(channel, ts, event.item.thread_ts);
  const windowMsgs = contextBounds(raw, ts);
  const proposals = await extractCaptures(ts, windowMsgs);
  if (proposals.length === 0) { await postEphemeral(channel, reactor, `Pinned to *${target.name}*, but I couldn't pull a clear update from the thread — open it in EventHub to add one.`); return; }

  const permalink = await getPermalink(channel, ts);
  const { data: budgetRows } = await sb.from('budget_line').select('id').eq('event_id', target.id).limit(1);
  const caps = buildCaptures(target, channel, ts, reactor, permalink, proposals, { budget: (budgetRows?.length ?? 0) > 0 });

  await sb.from('slack_capture').upsert(caps, { onConflict: 'id' });
  await postEphemeral(channel, reactor, composeEphemeral(target.name ?? 'the event', caps));
}
```

- [ ] **Step 3: Implement `onReactionRemoved` (undo)** — add:

```ts
// Un-react = undo: delete every capture for this pin, restoring pre-pin state (idempotent).
async function onReactionRemoved(event: any) {
  const channel: string = event.item.channel;
  const ts: string = event.item.ts;
  const sb = getServiceClient();
  await sb.from('slack_capture').delete().eq('slack_channel', channel).eq('slack_ts', ts);
}
```

- [ ] **Step 4: Build + full cloud-functions test suite**

Run: `cd cloud-functions && npm run build && npx vitest run`
Expected: tsc clean; all tests pass (Task 2 lib + existing `routeSlackEvent` tests).

- [ ] **Step 5: Commit**

```bash
git add cloud-functions/src/functions/slack-events.ts
git commit -m "feat(slack): orchestrate pin→capture + un-react undo in slack-events"
```

---

### Task 6: Deploy + end-to-end verify (operational)

**Files:** none.

- [ ] **Step 1: Apply the migration to Cloud SQL**

Start the proxy, then apply:
```bash
cloud-sql-proxy --port 9470 event-499220:us-central1:eventhub-db &
PW=$(grep -E '^DB_PASSWORD=' .env | cut -d= -f2- | tr -d '"' | head -1)
PGPASSWORD="$PW" psql -h 127.0.0.1 -p 9470 -U postgres -d postgres -f supabase/migrations/20260727000000_slack_capture.sql
```
Expected: `ALTER TABLE`, `CREATE TABLE`, `GRANT` succeed. Verify: `\d slack_capture`.

- [ ] **Step 2: Ship the code**

Cherry-pick the Phase-1 commits onto a fresh branch off `main` (avoid the unrelated in-progress commits), push, and let Cloud Build deploy. Then link a test event to a channel:
```sql
update event set slack_channel = '<C-channel-id>' where id = '<event-id>';
```

- [ ] **Step 3: Slack app config (Phase 3 prerequisites, minimum to test)**

In the Slack app: add the `:eventhub:` custom emoji; subscribe to `reaction_added` + `reaction_removed`; add scopes `reactions:read`, `channels:history`, `groups:history`, `chat:write`; invite the bot to the channel; point the Events request URL at `https://<run-url>/functions/v1/slack-events` (it will pass `url_verification`).

- [ ] **Step 4: Manual verification**

- Pin `:eventhub:` on a message in the linked channel → a `slack_capture` row (status `proposed`) appears; the reactor gets an ephemeral summary; prod logs show `POST 200 …/slack-events`.
- Re-pin the same message → no duplicate row (upsert).
- Remove the `:eventhub:` reaction → the capture row is deleted (undo).
- Pin in an unlinked channel → ephemeral "link this channel first," no row.

---

## Self-Review

**Spec coverage:** `event.slack_channel` + `slack_capture` (Task 1); channel→event resolution incl. multi-event most-recent (Task 2 `resolveEvent` + Task 5); adaptive context — thread vs window (Task 3 `fetchContext`) + cap/narrow (Task 2 `contextBounds`, Task 4 same-conversation prompt); typed extraction (Task 4); commit-as-proposed idempotent (Task 2 `captureId`/`buildCaptures`, Task 5 upsert); people fan-out — deferred note: Phase 1 stores the `people` capture in the ledger; the `person_tag` fan-out lands with Phase 2 promotion (called out here as the one spec item intentionally deferred to keep Phase 1 single-write-path); ambiguity + conflict flags (Task 2 `detectConflict`/`buildCaptures`, Task 4 `ambiguity`); ephemeral reactor-private feedback (Task 3 `postEphemeral`, Task 2 `composeEphemeral`); fallbacks no-link/no-extract (Task 5); undo via un-react (Task 5 `onReactionRemoved`) + idempotent delete; deploy/migration-manual/scopes (Task 6).

**Deviation from spec (flagged):** the spec's "people also fan out to `person_tag`" is moved to Phase 2 (promotion) so Phase 1 has exactly one write target (`slack_capture`) — simpler, and undo stays a single-table delete. If you want the `person_tag` fan-out in Phase 1, it's a small add to `onReactionAdded` + the undo delete.

**Placeholder scan:** none — all steps have complete code/commands. `contextBounds` has a vestigial `sec` helper guarded with `void`; harmless, could be removed.

**Type consistency:** `SlackMsg`/`Proposal`/`EventRow`/`StoredCapture`/`CaptureType` defined in Task 2 and imported unchanged in Tasks 3–5; `captureId` id format matches the migration's PK comment and the upsert `onConflict: 'id'`; `resolveEvent`/`contextBounds`/`buildCaptures`/`composeEphemeral`/`detectConflict` signatures identical across tasks.
