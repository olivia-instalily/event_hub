# Slack channel link control on the event card — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A card-footer control that links an event to an existing Slack channel or creates a new private `evt-<slug>` channel (inviting the event's owners), persisting `event.slack_channel` so the `:eventhub:` capture pipeline can route to it.

**Architecture:** A pure `slugifyChannel` helper (TDD). One cloud-functions endpoint `slack-link-channel` does create/link + owner-invite + sets the column with the service role (no client grant). A React `SlackChannelControl` in the Events-page card footer drives it via `db.ts` helpers.

**Tech Stack:** TypeScript, React, Express (cloud-functions), Slack Web API, `@supabase/supabase-js`, vitest.

## Global Constraints

- cloud-functions only — no `supabase/functions` (Deno) twin for this endpoint.
- No migration — `event.slack_channel` already exists in prod.
- Link/unlink writes go through the endpoint (service role); the client never needs a PostgREST column grant.
- New Slack scopes (operational, added in the Slack app): `groups:write`, `users:read.email`.
- Owner invite is best-effort — unresolved emails are `skipped`, never fatal.
- Open-in-Slack link uses `https://slack.com/app_redirect?channel=<id>` (no team id needed).
- Slack channel names: lowercase, ≤80 chars, `[a-z0-9-]` only.

---

### Task 1: Pure `slugifyChannel` (TDD)

**Files:**
- Create: `src/lib/slackChannel.ts`
- Test: `tests/slackChannel.test.ts`

**Interfaces:**
- Produces: `export function slugifyChannel(title: string): string` — returns `evt-<slug>`, valid Slack channel name.

- [ ] **Step 1: Write failing tests**

Create `tests/slackChannel.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { slugifyChannel } from "../src/lib/slackChannel";

describe("slugifyChannel", () => {
  it("lowercases, prefixes evt-, and hyphenates spaces", () => {
    expect(slugifyChannel("Toronto Summit")).toBe("evt-toronto-summit");
  });
  it("strips punctuation and collapses repeats", () => {
    expect(slugifyChannel("Q3  Client   Dinner!!")).toBe("evt-q3-client-dinner");
  });
  it("trims leading/trailing hyphens from the slug body", () => {
    expect(slugifyChannel("  --Kickoff--  ")).toBe("evt-kickoff");
  });
  it("drops non-ascii", () => {
    expect(slugifyChannel("Café Résumé")).toBe("evt-caf-rsum");
  });
  it("caps total length at 80 chars", () => {
    expect(slugifyChannel("x".repeat(200)).length).toBeLessThanOrEqual(80);
  });
  it("falls back to evt-event when nothing usable remains", () => {
    expect(slugifyChannel("!!!")).toBe("evt-event");
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run tests/slackChannel.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

Create `src/lib/slackChannel.ts`:

```ts
// Slack channel name from an event title: lowercase, [a-z0-9-] only, evt- prefixed, <=80 chars.
export function slugifyChannel(title: string): string {
  const body = (title ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")   // non-alphanumeric → hyphen
    .replace(/-+/g, "-")            // collapse repeats
    .replace(/^-|-$/g, "");         // trim edge hyphens
  const slug = body || "event";
  return `evt-${slug}`.slice(0, 80).replace(/-$/, "");
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/slackChannel.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/slackChannel.ts tests/slackChannel.test.ts
git commit -m "feat(slack): slugifyChannel — event title -> evt-<slug> channel name"
```

---

### Task 2: Server endpoint `slack-link-channel`

**Files:**
- Create: `cloud-functions/src/functions/slack-link-channel.ts`
- Modify: `cloud-functions/src/index.ts` (import + `app.post`)

**Interfaces:**
- Consumes: `getServiceClient()` from `../db.js`, `process.env.SLACK_BOT_TOKEN`.
- Produces: `POST /functions/v1/slack-link-channel` accepting `{ eventId, channelId }` (link/clear; `channelId` may be `null`) or `{ eventId, create: { name } }`; returns `{ ok, id, name, skipped? }` or `{ error }`.

- [ ] **Step 1: Implement the handler**

Create `cloud-functions/src/functions/slack-link-channel.ts`:

```ts
import { Request, Response } from 'express';
import { getServiceClient } from '../db.js';

const slackGet = async (method: string, params: Record<string, string>) => {
  const r = await fetch(`https://slack.com/api/${method}?${new URLSearchParams(params)}`, {
    headers: { authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}` },
  });
  return await r.json() as any;
};
const slackPost = async (method: string, body: unknown) => {
  const r = await fetch(`https://slack.com/api/${method}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`, 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
  });
  return await r.json() as any;
};

export async function handler(req: Request, res: Response) {
  try {
    const { eventId, channelId, create } = req.body ?? {};
    if (!eventId) { res.status(400).json({ error: 'eventId required' }); return; }
    const sb = getServiceClient();
    let id: string | null = channelId ?? null;
    let name = '';
    const skipped: string[] = [];

    if (create?.name) {
      const c = await slackPost('conversations.create', { name: create.name, is_private: true });
      if (!c.ok) { res.status(400).json({ error: c.error ?? 'create failed' }); return; }  // e.g. name_taken
      id = c.channel.id; name = c.channel.name;

      // Invite the event's owners by email (best-effort).
      const { data: owners } = await sb.from('event_owner').select('profile:profile ( name, email )').eq('event_id', eventId);
      const users: string[] = [];
      for (const o of (owners ?? []) as any[]) {
        const email = o.profile?.email;
        if (!email) { if (o.profile?.name) skipped.push(o.profile.name); continue; }
        const u = await slackGet('users.lookupByEmail', { email });
        if (u.ok && u.user?.id) users.push(u.user.id);
        else skipped.push(o.profile?.name ?? email);
      }
      if (users.length) {
        const inv = await slackPost('conversations.invite', { channel: id, users: users.join(',') });
        if (!inv.ok) console.error(JSON.stringify({ fn: 'slack-link-channel', op: 'invite', error: inv.error }));
      }
    }

    // Set (or clear) the link with the service role.
    const { error } = await sb.from('event').update({ slack_channel: id }).eq('id', eventId);
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.json({ ok: true, id, name, skipped });
  } catch (e) {
    console.error(JSON.stringify({ fn: 'slack-link-channel', error: String((e as Error)?.message ?? e) }));
    res.status(500).json({ error: String((e as Error)?.message ?? e) });
  }
}
```

- [ ] **Step 2: Register the route** in `cloud-functions/src/index.ts`

Add the import alongside the other slack imports:
```ts
import { handler as slackLinkChannel }       from './functions/slack-link-channel.js';
```
Add the route with the other `app.post` json routes (after `slackSend`):
```ts
app.post('/slack-link-channel',       slackLinkChannel);
```

- [ ] **Step 3: Build + commit**

Run: `cd cloud-functions && npm run build` → no errors.
```bash
git add cloud-functions/src/functions/slack-link-channel.ts cloud-functions/src/index.ts
git commit -m "feat(slack): slack-link-channel endpoint (create/link/unlink + owner invite)"
```

---

### Task 3: `db.ts` — surface `slackChannel` + link/unlink helpers

**Files:**
- Modify: `src/lib/db.ts`

**Interfaces:**
- Consumes: Task 2 endpoint.
- Produces: `EventListItem.slackChannel`; `linkSlackChannel(eventId, arg)`; `unlinkSlackChannel(eventId)`.

- [ ] **Step 1: Add `slackChannel` to the list item**

In `src/lib/db.ts`: add `slackChannel: string | null;` to the `EventListItem` interface (next to `gcalHtmlLink`); add `slack_channel` to `EVENT_LIST_SELECT`; add `slackChannel: (row as any).slack_channel ?? null,` in `toListItem` (next to the `gcalEventId` mapping).

- [ ] **Step 2: Add the helpers** (near `listSlackChannels`, ~line 2002)

```ts
export async function linkSlackChannel(
  eventId: string,
  arg: { channelId: string } | { create: { name: string } },
): Promise<{ id: string; name: string; skipped?: string[] }> {
  const { data, error } = await supabase.functions.invoke('slack-link-channel', { body: { eventId, ...arg } });
  if (error || (data as any)?.error) throw new Error((data as any)?.error ?? error?.message ?? 'link failed');
  return data as { id: string; name: string; skipped?: string[] };
}

export async function unlinkSlackChannel(eventId: string): Promise<void> {
  const { data, error } = await supabase.functions.invoke('slack-link-channel', { body: { eventId, channelId: null } });
  if (error || (data as any)?.error) throw new Error((data as any)?.error ?? error?.message ?? 'unlink failed');
}
```

- [ ] **Step 3: Type-check + commit**

Run: `npx tsc -b 2>&1 | head -20` → no errors.
```bash
git add src/lib/db.ts
git commit -m "feat(slack): slackChannel on EventListItem + link/unlink helpers"
```

---

### Task 4: `SlackChannelControl` component + card-footer wiring

**Files:**
- Create: `src/components/SlackChannelControl.tsx`
- Modify: `src/components/EventsPage.tsx` (import + render in the card footer at ~line 2355)

**Interfaces:**
- Consumes: `slugifyChannel` (Task 1), `linkSlackChannel`/`unlinkSlackChannel`/`listSlackChannels` (Task 3), `EventListItem.slackChannel`.
- Produces: `export function SlackChannelControl({ eventId, title, slackChannel, onChange }: { eventId: string; title: string; slackChannel: string | null; onChange: () => void })`.

- [ ] **Step 1: Implement the component**

Create `src/components/SlackChannelControl.tsx`:

```tsx
import { useEffect, useRef, useState } from "react";
import { Hash, Plus, X, ExternalLink, Loader2 } from "lucide-react";
import { slugifyChannel } from "../lib/slackChannel";
import { listSlackChannels, linkSlackChannel, unlinkSlackChannel } from "../lib/db";

export function SlackChannelControl({ eventId, title, slackChannel, onChange }: { eventId: string; title: string; slackChannel: string | null; onChange: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [channels, setChannels] = useState<{ id: string; name: string }[]>([]);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => { if (open) { setName(slugifyChannel(title)); setErr(null); listSlackChannels().then(setChannels).catch(() => setChannels([])); } }, [open, title]);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    if (open) document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const linkedName = channels.find((c) => c.id === slackChannel)?.name;

  const run = async (fn: () => Promise<{ skipped?: string[] } | void>) => {
    setBusy(true); setErr(null);
    try { const r = await fn(); setOpen(false); onChange(); if (r && "skipped" in r && r.skipped?.length) alert(`Couldn't add to Slack (not found by email): ${r.skipped.join(", ")}`); }
    catch (e) { setErr((e as Error).message === "name_taken" ? "That channel name is taken — try another." : (e as Error).message); }
    finally { setBusy(false); }
  };

  if (slackChannel) {
    return (
      <span className="inline-flex items-center gap-1 text-sm text-gray-600" onClick={(e) => e.stopPropagation()}>
        <a href={`https://slack.com/app_redirect?channel=${slackChannel}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-purple-700 hover:underline">
          <Hash className="w-3.5 h-3.5" />{linkedName ?? "slack channel"}<ExternalLink className="w-3 h-3" />
        </a>
        <button onClick={() => run(() => unlinkSlackChannel(eventId))} title="Unlink" className="p-0.5 text-gray-400 hover:text-red-600"><X className="w-3.5 h-3.5" /></button>
      </span>
    );
  }

  const filtered = channels.filter((c) => c.name.includes(q.toLowerCase()));
  return (
    <div className="relative inline-block" ref={ref} onClick={(e) => e.stopPropagation()}>
      <button onClick={() => setOpen((v) => !v)} className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800">
        <Hash className="w-3.5 h-3.5" /> Link Slack
      </button>
      {open && (
        <div className="absolute z-40 mt-1 w-72 rounded-xl border border-border bg-white shadow-xl p-3 space-y-3">
          <div>
            <div className="text-[12px] text-gray-500 mb-1">Create a channel</div>
            <div className="flex items-center gap-1">
              <span className="text-gray-400">#</span>
              <input value={name} onChange={(e) => setName(e.target.value)} className="flex-1 px-2 py-1 border border-border rounded text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
              <button disabled={busy || !name.trim()} onClick={() => run(() => linkSlackChannel(eventId, { create: { name: name.trim() } }))} className="inline-flex items-center gap-1 px-2 py-1 text-sm rounded-lg bg-gray-900 text-white hover:bg-gray-700 disabled:opacity-50">
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>
          <div>
            <div className="text-[12px] text-gray-500 mb-1">Or pick an existing one</div>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search channels…" className="w-full px-2 py-1 border border-border rounded text-sm mb-1 focus:outline-none focus:ring-2 focus:ring-gray-300" />
            <ul className="max-h-40 overflow-auto">
              {filtered.map((c) => (
                <li key={c.id}>
                  <button disabled={busy} onClick={() => run(() => linkSlackChannel(eventId, { channelId: c.id }))} className="w-full text-left px-2 py-1 rounded text-sm hover:bg-gray-100">#{c.name}</button>
                </li>
              ))}
              {filtered.length === 0 && <li className="px-2 py-1 text-[13px] text-gray-400">No channels the bot is in.</li>}
            </ul>
          </div>
          {err && <p className="text-[12px] text-red-600">{err}</p>}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Wire it into the card footer**

In `src/components/EventsPage.tsx`, import at top with the other component imports:
```ts
import { SlackChannelControl } from "./SlackChannelControl";
```
In the card footer block (the `<div className="mt-auto pt-4 border-t border-gray-100" …>` at ~line 2355), render the control inside that footer (internal events only — external events aren't operated):
```tsx
{!event.isExternal && (
  <div className="mt-2">
    <SlackChannelControl eventId={event.id} title={event.title} slackChannel={event.slackChannel} onChange={() => setReload((x) => x + 1)} />
  </div>
)}
```
(Use the card's existing reload trigger — confirm the state setter name in `EventsPage` near the other card actions; it's `setReload` if present, else the list-refetch used by `toggleBookmark`/`setTags`.)

- [ ] **Step 3: Type-check + build**

Run: `npx tsc -b 2>&1 | head -20 && npm run build 2>&1 | tail -5`
Expected: no type errors; build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/components/SlackChannelControl.tsx src/components/EventsPage.tsx
git commit -m "feat(slack): SlackChannelControl on the event card footer"
```

---

### Task 5: Deploy + Slack config + verify (operational)

- [ ] **Step 1:** Add Slack scopes `groups:write` + `users:read.email` in the app; reinstall.
- [ ] **Step 2:** Ship (push to main / cherry-pick per preference) → Cloud Build deploys.
- [ ] **Step 3:** On a card footer: **Create** → confirm a new private `#evt-<slug>` appears in Slack with owners invited (or a skipped toast), and the card flips to the linked state. **Pick existing** → links. **Unlink** → clears. Then pin `:eventhub:` in that channel → the capture routes to this event.

---

## Self-Review

**Spec coverage:** slugifyChannel (Task 1); create-private + owner-invite + set-link server-side (Task 2); link-existing + unlink via same endpoint (Task 2/3); `slackChannel` on list item (Task 3); card-footer control with Create(editable evt-<slug>)/Pick-existing/Linked(open-in-Slack app_redirect + Unlink) (Task 4); scopes + no-migration + cloud-functions-only (Global Constraints, Task 5). Covered.

**Placeholder scan:** none — full code in every step. One flagged lookup: Task 4 Step 2 says "confirm the reload setter name in EventsPage" — resolve to the actual refetch trigger during execution (not a placeholder value, a named existing symbol).

**Type consistency:** `linkSlackChannel(eventId, { channelId } | { create: { name } })` and `unlinkSlackChannel(eventId)` signatures identical across Tasks 3–4; endpoint body shape `{ eventId, channelId?, create? }` matches Task 2 handler; `EventListItem.slackChannel: string | null` used consistently; `slugifyChannel(title)` return `evt-<slug>` consumed in Task 4.
