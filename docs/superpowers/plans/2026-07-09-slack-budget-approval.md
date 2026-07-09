# Slack Interactive Budget Approval — Implementation Plan (Phase 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Let approvers Approve/Decline a scoping budget request from in-channel Slack buttons (Decline requires a reason), writing the outcome to the Phase 0 `budget_approval` record and updating the message; plus a "Re-send to Slack" action.

**Architecture:** A public Node cloud function `slack-interactions` (on Cloud Run, behind Caddy) receives Slack's interaction POSTs. It verifies the Slack signature on the RAW body FIRST, parses the interaction, opens Approve/Decline modals, and on modal submit applies the outcome (state-checked for idempotency) then updates the original message. The request message (with buttons) is posted by a `slack-approval` cloud function. Local dev is NOT supported for the inbound flow (Slack needs a public URL) — Node-only, prod-first.

**Tech Stack:** Node/Express cloud functions, `node:crypto` (HMAC), Slack Web API (`chat.postMessage`/`chat.update`/`views.open`), PostgREST via the cloud-functions service client, Vitest for the pure signature test.

## Global Constraints
- Inbound endpoint is a **Node cloud function only** (no Deno twin) — Slack hits the Cloud Run URL.
- **Signature verification is mandatory and FIRST** on every inbound request: HMAC-SHA256 over `v0:{timestamp}:{rawBody}` compared timing-safe to `X-Slack-Signature`; reject if invalid or timestamp older than 300s.
- The endpoint needs the **RAW request body** — it must NOT be pre-parsed by the global `express.json()`.
- **Attribution, not restriction:** capture the Slack user id (`decided_via='slack'`, `decider_ref=<user id>`); do NOT restrict who can approve.
- **Approve carries an amount** (default = requested); **Decline requires a non-empty reason**.
- **Idempotency:** if `budget_approval.status` is already `assigned`/`declined`, the action no-ops and re-updates the message.
- The outcome writes the SAME fields as Phase 0's `assignBudget`/`declineBudget` (set `event.event_budget_target` for approve; upsert `budget_approval` status/decided_*). Because those live in frontend `src/lib/db.ts`, the cloud function replicates that exact write set via its service client — keep the two in sync (dual-maintained logic; note it in comments).
- New secret **`SLACK_SIGNING_SECRET`** (Secret Manager + `deploy.yml`). `SLACK_BOT_TOKEN` already exists.
- 🚩 Deploy parity: new cloud function + route auto-deploy on push; the **secret** and **Slack app dashboard config** are manual. No migration (Phase 0 already added `slack_channel`/`slack_message_ts`).
- Verify with `npx tsc -p cloud-functions/tsconfig.json --noEmit` and `npx vitest run`.

---

### Task 1: Slack signature verification (pure, TDD)

**Files:**
- Create: `cloud-functions/src/lib/slack.ts`
- Test: `tests/slackSignature.test.ts`

**Interfaces:**
- Produces: `verifySlackSignature(rawBody: string, timestamp: string | undefined, signature: string | undefined, secret: string, nowMs?: number): boolean`

- [ ] **Step 1: Write the failing test**

```ts
// tests/slackSignature.test.ts
import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { verifySlackSignature } from "../cloud-functions/src/lib/slack";

const SECRET = "test_signing_secret";
const sign = (body: string, ts: string) => "v0=" + createHmac("sha256", SECRET).update(`v0:${ts}:${body}`).digest("hex");

describe("verifySlackSignature", () => {
  const now = 1_000_000_000_000; // fixed ms
  const ts = String(Math.floor(now / 1000));
  const body = "payload=%7B%22type%22%3A%22block_actions%22%7D";

  it("accepts a valid, fresh signature", () => {
    expect(verifySlackSignature(body, ts, sign(body, ts), SECRET, now)).toBe(true);
  });
  it("rejects a tampered body", () => {
    expect(verifySlackSignature(body + "x", ts, sign(body, ts), SECRET, now)).toBe(false);
  });
  it("rejects a stale timestamp (>5 min)", () => {
    const old = String(Math.floor(now / 1000) - 400);
    expect(verifySlackSignature(body, old, sign(body, old), SECRET, now)).toBe(false);
  });
  it("rejects missing signature/timestamp/secret", () => {
    expect(verifySlackSignature(body, undefined, sign(body, ts), SECRET, now)).toBe(false);
    expect(verifySlackSignature(body, ts, undefined, SECRET, now)).toBe(false);
    expect(verifySlackSignature(body, ts, sign(body, ts), "", now)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/slackSignature.test.ts` — Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

```ts
// cloud-functions/src/lib/slack.ts
import { createHmac, timingSafeEqual } from 'node:crypto';

// Verify a Slack request signature over the RAW body. Reject if missing, stale (>5 min → replay),
// or mismatched. nowMs is injectable for tests.
export function verifySlackSignature(rawBody: string, timestamp: string | undefined, signature: string | undefined, secret: string, nowMs: number = Date.now()): boolean {
  if (!timestamp || !signature || !secret) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowMs / 1000 - ts) > 300) return false;
  const expected = 'v0=' + createHmac('sha256', secret).update(`v0:${timestamp}:${rawBody}`).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/slackSignature.test.ts` — Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add cloud-functions/src/lib/slack.ts tests/slackSignature.test.ts
git commit -m "feat(slack): request-signature verification"
```

---

### Task 2: Post the interactive approval request (`slack-approval` cloud function)

**Files:**
- Create: `cloud-functions/src/functions/slack-approval.ts`
- Modify: `cloud-functions/src/index.ts` (import + `app.post('/slack-approval', slackApproval)` next to the other routes)
- Modify: `src/lib/db.ts` (client caller)

**Interfaces:**
- Produces (cloud): POST `{ channel, eventId, summary, link, requestedAmount }` → posts a message with Approve/Decline buttons + a link, returns `{ ok, channel, ts }`.
- Produces (client): `postApprovalRequest(opts: { channel: string; eventId: string; summary: string; link: string; requestedAmount: number | null }): Promise<{ channel: string; ts: string }>`

- [ ] **Step 1: Implement the cloud function**

```ts
// cloud-functions/src/functions/slack-approval.ts
import { Request, Response } from 'express';

export async function handler(req: Request, res: Response) {
  try {
    const { channel, eventId, summary, link, requestedAmount } = req.body ?? {};
    if (!channel || !eventId) { res.status(400).json({ error: 'channel and eventId are required' }); return; }
    const token = process.env.SLACK_BOT_TOKEN;
    if (!token) { res.status(500).json({ error: 'SLACK_BOT_TOKEN not configured' }); return; }

    const blocks = [
      { type: 'section', text: { type: 'mrkdwn', text: String(summary || `Budget request for event ${eventId}`) } },
      { type: 'actions', elements: [
        { type: 'button', style: 'primary', text: { type: 'plain_text', text: 'Approve' }, action_id: 'approve', value: String(eventId) },
        { type: 'button', style: 'danger', text: { type: 'plain_text', text: 'Decline' }, action_id: 'decline', value: String(eventId) },
        ...(link ? [{ type: 'button', text: { type: 'plain_text', text: 'Open in EventHub' }, url: String(link) }] : []),
      ] },
    ];
    const r = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ channel, text: `Budget request${requestedAmount != null ? ` — $${requestedAmount}` : ''}`, blocks }),
    });
    const data = await r.json() as any;
    if (!data.ok) { res.status(502).json({ error: `Slack: ${data.error ?? 'unknown error'}` }); return; }
    res.json({ ok: true, channel: data.channel, ts: data.ts });
  } catch (e) {
    console.error(JSON.stringify({ fn: 'slack-approval', error: String((e as Error)?.message ?? e) }));
    res.status(500).json({ error: String((e as Error)?.message ?? e) });
  }
}
```

- [ ] **Step 2: Register the route** in `cloud-functions/src/index.ts` — add `import { handler as slackApproval } from './functions/slack-approval.js';` with the other imports and `app.post('/slack-approval', slackApproval);` with the other routes.

- [ ] **Step 3: Add the client caller** in `src/lib/db.ts` (near `slackSend`):

```ts
export async function postApprovalRequest(opts: { channel: string; eventId: string; summary: string; link: string; requestedAmount: number | null }): Promise<{ channel: string; ts: string }> {
  const res = await fetch('/functions/v1/slack-approval', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(opts) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as any)?.error ?? `Slack post failed (${res.status}).`);
  return { channel: (data as any).channel, ts: (data as any).ts };
}
```

- [ ] **Step 4: Typecheck + commit**

Run: `npx tsc -p cloud-functions/tsconfig.json --noEmit` (exit 0) and `npx tsc -b` (exit 0).
```bash
git add cloud-functions/src/functions/slack-approval.ts cloud-functions/src/index.ts src/lib/db.ts
git commit -m "feat(slack): post interactive budget-approval request"
```

---

### Task 3: Inbound endpoint — raw body + signature gate + parse/ack

**Files:**
- Create: `cloud-functions/src/functions/slack-interactions.ts`
- Modify: `cloud-functions/src/index.ts` (register the raw-body route BEFORE the global `express.json()`)

**Interfaces:**
- Consumes: `verifySlackSignature` (Task 1).
- Produces: POST `/slack-interactions` handler (raw body). Exports `handler`.

- [ ] **Step 1: Register the raw-body route before the JSON parser** in `cloud-functions/src/index.ts`.

Add the import with the others, then place this line ABOVE `app.use(express.json({ limit: '20mb' }));`:

```ts
import { handler as slackInteractions } from './functions/slack-interactions.js';
// ... (cors already applied above)
// Slack signature verification needs the RAW body, so this route must be registered with a raw
// parser BEFORE the global express.json() (which would otherwise consume the stream).
app.post('/slack-interactions', express.raw({ type: '*/*', limit: '2mb' }), slackInteractions);
app.use(express.json({ limit: '20mb' }));  // existing line — must stay AFTER the raw route
```

- [ ] **Step 2: Implement the endpoint skeleton (signature + parse + ack)**

```ts
// cloud-functions/src/functions/slack-interactions.ts
import { Request, Response } from 'express';
import { verifySlackSignature } from '../lib/slack.js';

export async function handler(req: Request, res: Response) {
  const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : String(req.body ?? '');
  const secret = process.env.SLACK_SIGNING_SECRET;
  const ok = verifySlackSignature(raw, req.header('x-slack-request-timestamp'), req.header('x-slack-signature'), secret ?? '');
  if (!ok) { res.status(401).send('bad signature'); return; }

  let payload: any;
  try { payload = JSON.parse(new URLSearchParams(raw).get('payload') ?? '{}'); }
  catch { res.status(400).send('bad payload'); return; }

  try {
    if (payload.type === 'block_actions') { await onAction(payload, res); return; }
    if (payload.type === 'view_submission') { await onSubmit(payload, res); return; }
    res.status(200).send(''); // ignore other interaction types
  } catch (e) {
    console.error(JSON.stringify({ fn: 'slack-interactions', error: String((e as Error)?.message ?? e) }));
    res.status(200).send(''); // ack even on error so Slack doesn't retry-storm; logged above
  }
}

// onAction / onSubmit are added in Tasks 4 and 5.
async function onAction(_payload: any, res: Response) { res.status(200).send(''); }
async function onSubmit(_payload: any, res: Response) { res.status(200).send(''); }
```

- [ ] **Step 3: Typecheck + commit**

Run: `npx tsc -p cloud-functions/tsconfig.json --noEmit` (exit 0).
```bash
git add cloud-functions/src/functions/slack-interactions.ts cloud-functions/src/index.ts
git commit -m "feat(slack): inbound interactions endpoint (signature gate + parse)"
```

---

### Task 4: Approve/Decline buttons → open modals

**Files:**
- Modify: `cloud-functions/src/functions/slack-interactions.ts` (implement `onAction`)

**Interfaces:**
- Consumes: Slack `block_actions` payload (`actions[0].action_id`/`.value`, `trigger_id`, `channel.id`, `message.ts`).
- Produces: opens a modal via `views.open`; modal `private_metadata` carries `{ eventId, channel, ts }`.

- [ ] **Step 1: Implement `onAction`** (replace the stub)

```ts
const slackApi = async (method: string, body: unknown) => {
  const r = await fetch(`https://slack.com/api/${method}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`, 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
  });
  return await r.json() as any;
};

async function onAction(payload: any, res: Response) {
  const action = payload.actions?.[0];
  const eventId = action?.value;
  const meta = JSON.stringify({ eventId, channel: payload.channel?.id, ts: payload.message?.ts });
  // Ack the button click immediately (empty 200) — the modal is opened via the trigger_id.
  res.status(200).send('');
  if (action?.action_id === 'approve') {
    await slackApi('views.open', { trigger_id: payload.trigger_id, view: {
      type: 'modal', callback_id: 'approve_modal', private_metadata: meta,
      title: { type: 'plain_text', text: 'Approve budget' },
      submit: { type: 'plain_text', text: 'Approve' },
      blocks: [{ type: 'input', block_id: 'amt', label: { type: 'plain_text', text: 'Assigned amount (USD)' },
        element: { type: 'number_input', is_decimal_allowed: false, action_id: 'value' } }],
    } });
  } else if (action?.action_id === 'decline') {
    await slackApi('views.open', { trigger_id: payload.trigger_id, view: {
      type: 'modal', callback_id: 'decline_modal', private_metadata: meta,
      title: { type: 'plain_text', text: 'Decline budget' },
      submit: { type: 'plain_text', text: 'Decline' },
      blocks: [{ type: 'input', block_id: 'reason', label: { type: 'plain_text', text: 'Reason (required)' },
        element: { type: 'plain_text_input', multiline: true, action_id: 'value' } }],
    } });
  }
}
```

- [ ] **Step 2: Typecheck + commit**

Run: `npx tsc -p cloud-functions/tsconfig.json --noEmit` (exit 0).
```bash
git add cloud-functions/src/functions/slack-interactions.ts
git commit -m "feat(slack): approve/decline open modals"
```

---

### Task 5: Modal submit → apply outcome (idempotent) + update message

**Files:**
- Modify: `cloud-functions/src/functions/slack-interactions.ts` (implement `onSubmit`, add DB writes via the service client)

**Interfaces:**
- Consumes: `getServiceClient` from `../db.js`; `view_submission` payload (`view.callback_id`, `view.private_metadata`, `view.state.values`, `user.id`).
- Produces: writes `event.event_budget_target` + `budget_approval` (mirrors Phase 0 `assignBudget`/`declineBudget`); `chat.update`s the original message.

- [ ] **Step 1: Implement `onSubmit`** (replace the stub) — add `import { getServiceClient } from '../db.js';` at the top.

```ts
async function onSubmit(payload: any, res: Response) {
  const view = payload.view;
  const meta = JSON.parse(view.private_metadata || '{}');
  const eventId = meta.eventId as string;
  const userId = payload.user?.id as string;
  const supa = getServiceClient();

  // Idempotency: if already resolved, no-op and just refresh the message.
  const { data: existing } = await supa.from('budget_approval').select('status').eq('event_id', eventId).maybeSingle();
  const already = (existing as any)?.status;
  if (already === 'assigned' || already === 'declined') {
    res.status(200).send(''); // close the modal
    await updateMessage(meta, `Already ${already} — no change.`);
    return;
  }

  const nowIso = new Date().toISOString();
  if (view.callback_id === 'approve_modal') {
    const amount = Number(view.state.values.amt.value.value);
    if (!Number.isFinite(amount)) { res.status(200).json({ response_action: 'errors', errors: { amt: 'Enter a number' } }); return; }
    // Mirror Phase 0 assignBudget: set the target, then flip approval state. Keep in sync with src/lib/db.ts.
    await supa.from('event').update({ event_budget_target: amount }).eq('id', eventId);
    await supa.from('budget_approval').upsert({ event_id: eventId, status: 'assigned', decided_via: 'slack', decider_ref: userId, decided_at: nowIso, decline_reason: null, updated_at: nowIso }, { onConflict: 'event_id' });
    res.status(200).send('');
    await updateMessage(meta, `Approved by <@${userId}> — $${amount} assigned.`);
    return;
  }
  if (view.callback_id === 'decline_modal') {
    const reason = String(view.state.values.reason.value.value || '').trim();
    if (!reason) { res.status(200).json({ response_action: 'errors', errors: { reason: 'A reason is required' } }); return; }
    await supa.from('budget_approval').upsert({ event_id: eventId, status: 'declined', decline_reason: reason, decided_via: 'slack', decider_ref: userId, decided_at: nowIso, updated_at: nowIso }, { onConflict: 'event_id' });
    res.status(200).send('');
    await updateMessage(meta, `Declined by <@${userId}> — ${reason}`);
    return;
  }
  res.status(200).send('');
}

async function updateMessage(meta: { channel?: string; ts?: string }, text: string) {
  if (!meta.channel || !meta.ts) return;
  await slackApi('chat.update', { channel: meta.channel, ts: meta.ts, text, blocks: [{ type: 'section', text: { type: 'mrkdwn', text } }] });
}
```

- [ ] **Step 2: Typecheck + commit**

Run: `npx tsc -p cloud-functions/tsconfig.json --noEmit` (exit 0).
```bash
git add cloud-functions/src/functions/slack-interactions.ts
git commit -m "feat(slack): apply approve/decline outcome + update message (idempotent)"
```

---

### Task 6: Wire ScopingForm submit + Re-send action

**Files:**
- Modify: `src/lib/db.ts` (nothing new — reuses `postApprovalRequest`, `submitBudgetApproval`)
- Modify: `src/components/ScopingForm.tsx`

**Interfaces:**
- Consumes: `postApprovalRequest` (Task 2), `submitBudgetApproval` (Phase 0), `getBudgetApproval`.

- [ ] **Step 1: Submit posts the interactive message and stores its ts.** In `ScopingForm.tsx`'s submit handler, replace the plain `await slackSend(slackChannel.trim(), summary);` + `submitBudgetApproval(...)` with:

```tsx
const link = /* existing deep link built above */ "";
const { channel, ts } = await postApprovalRequest({ channel: slackChannel.trim(), eventId: plan.id, summary, link, requestedAmount: roughTotal });
await submitBudgetApproval(plan.id, { requestedAmount: roughTotal, slackChannel: channel, slackMessageTs: ts });
setApproval(await getBudgetApproval(plan.id));
```
Add `postApprovalRequest` to the `../lib/db` import; keep `buildScopingSummary` for `summary`.

- [ ] **Step 2: Add a "Re-send to Slack" button** shown when `approval?.status === "submitted"`. It re-posts and updates the stored ts:

```tsx
const resend = async () => {
  const summary = buildScopingSummary({ title: plan.title, date: plan.date, tags: plan.tags, scoping, roughTotal, link });
  const { channel, ts } = await postApprovalRequest({ channel: (approval?.slackChannel ?? slackChannel).trim(), eventId: plan.id, summary, link, requestedAmount: roughTotal });
  await submitBudgetApproval(plan.id, { requestedAmount: roughTotal, slackChannel: channel, slackMessageTs: ts });
  setApproval(await getBudgetApproval(plan.id));
};
```
Render near the "Submitted · awaiting budget" area: `<button onClick={() => void resend()}>Re-send to Slack</button>`.

- [ ] **Step 3: Typecheck + tests + commit**

Run: `npx tsc -b` (exit 0), `npx vitest run` (passes).
```bash
git add src/components/ScopingForm.tsx src/lib/db.ts
git commit -m "feat(slack): submit posts interactive request; add Re-send"
```

---

### Task 7: Secret, deploy, Slack app config, verify

**Files:**
- Modify: `.github/workflows/deploy.yml` (add the signing secret)

- [ ] **Step 1: Add the secret to deploy.yml** — in `--set-secrets`, add a line:
```
SLACK_SIGNING_SECRET=eventhub-slack-signing-secret:latest,\
```
```bash
git add .github/workflows/deploy.yml
git commit -m "chore(slack): wire SLACK_SIGNING_SECRET on deploy"
```

- [ ] **Step 2: Create the secret in Secret Manager** (guided — needs the value from the Slack app's Basic Information → Signing Secret):
```
printf '%s' '<signing secret>' | gcloud secrets create eventhub-slack-signing-secret --project=event-499220 --data-file=- \
  || printf '%s' '<signing secret>' | gcloud secrets versions add eventhub-slack-signing-secret --project=event-499220 --data-file=-
gcloud secrets add-iam-policy-binding eventhub-slack-signing-secret --project=event-499220 \
  --member=serviceAccount:15951963035-compute@developer.gserviceaccount.com --role=roles/secretmanager.secretAccessor
```

- [ ] **Step 3: Push (deploys the endpoint + secret)**
```bash
git push origin main
```

- [ ] **Step 4: Configure the Slack app (guided, dashboard)** — Interactivity & Shortcuts → ON → Request URL: `https://eventhub-licvsmaspa-uc.a.run.app/functions/v1/slack-interactions`. Ensure Bot Token Scopes include `chat:write`. Reinstall the app if scopes changed.

- [ ] **Step 5: Verify on live**
  - Signature: `curl -sS -o /dev/null -w "%{http_code}\n" -X POST https://eventhub-licvsmaspa-uc.a.run.app/functions/v1/slack-interactions -d 'payload=%7B%7D'` → **401** (no valid signature). MUST be 401, not 200.
  - Approve: submit a scoping request → message with buttons appears → click Approve, enter amount → the event's `event_budget_target` updates, `budget_approval` shows `assigned` + your Slack id, message updates to "Approved by …".
  - Decline: click Decline → modal requires a reason → `budget_approval` shows `declined` + reason, message updates.
  - Idempotency: click Approve again after resolution → no double-assign; message shows "Already assigned — no change."
  - Re-send: from the record, Re-send → new message appears and resolves the same event.

---

## Self-review notes
- **Spec coverage:** interactive message + buttons + link + embedded id (T2); signature-verified inbound endpoint with raw body (T1,T3); approve/decline modals (T4); apply outcome + idempotency + message update + attribution (T5); re-send (T6); secret + Slack config + verify incl. the 401 signature test (T7). ✅
- **Sanctioned-path caveat:** the endpoint replicates `assignBudget`/`declineBudget`'s writes via the service client (the frontend function can't run server-side); comments mark it dual-maintained with `src/lib/db.ts`. Flagged, not silent.
- **Ack timing:** button acks immediately then opens the modal via `trigger_id`; submit does the (fast) DB write then acks — within Slack's 3s window.
- **No migration:** `budget_approval.slack_channel`/`slack_message_ts` already exist from Phase 0.
