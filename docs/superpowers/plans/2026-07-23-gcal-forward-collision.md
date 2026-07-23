# GCal Forward Collision Handling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make future EventHub events reliably sync to Google Calendar — auto-adopt confident collisions, and surface a "needs review" state (red icon + reason + Link/Create) for ambiguous ones instead of silently dead-ending.

**Architecture:** Move the collision decision into the `gcal-sync` edge function's `auto` action: classify each calendar's window (create / confident / ambiguous), auto-adopt+create when all clear, else store `gcal_match_pending` (with a reason) and return `needs_confirmation`. The frontend gains a third UI state on `GcalLinkControl`/`GCalSync` driven by `plan.gcalMatchPending`, resolved via the existing `resolveGcalMatch`.

**Tech Stack:** TypeScript, React 18, Vite, Supabase (Deno edge functions + a dual-maintained Node/GCF twin), vitest.

## Global Constraints

- `gcal-sync` is **DUAL-MAINTAINED**: every logic change goes in BOTH `supabase/functions/gcal-sync/index.ts` (Deno, helpers inlined verbatim) and `cloud-functions/src/functions/gcal-sync.ts` (Node, imports `./gcal-helpers.js`). They must stay byte-equivalent in behavior.
- The cloud function **requires a redeploy** to reach prod; the Deno/UI/`db.ts` changes ride the normal app build. No migrations (`gcal_match_pending` column already exists), no new secrets.
- "Confident" = exactly one name-similar, unowned window candidate with **full title token-containment** AND **same calendar date** AND (timed events) time overlap. Everything else with ≥1 candidate is ambiguous. This must stay identical to the tested logic in `scripts/backfill-gcal.classify.mjs` / `tests/backfill-gcal.test.ts`.
- Never rewrite an existing calendar event except: (a) confident-adopt (existing `link` patch-to-canonical behavior) or (b) create-new. No new destructive paths.

---

### Task 1: Shared classifier emits a `reason` (pure, tested)

Extend the already-tested backfill classifier so ambiguous verdicts carry a human-readable reason. This is the canonical logic the edge function mirrors.

**Files:**
- Modify: `scripts/backfill-gcal.classify.mjs`
- Test: `tests/backfill-gcal.test.ts`

**Interfaces:**
- Produces: `classify(ev, windowItems)` returns
  `{ bucket: "create" }` |
  `{ bucket: "confident", candidate }` |
  `{ bucket: "ambiguous", candidates, reason }` where `reason: string`.

- [ ] **Step 1: Add failing tests for `reason`**

Append to `tests/backfill-gcal.test.ts` inside `describe("classify", …)`:

```typescript
  test("ambiguous reason names the day-off case", () => {
    const r = classify(ev(), [cand({ start: { date: "2026-03-11" }, end: { date: "2026-03-12" } })]);
    expect(r.reason).toMatch(/day/i);
  });

  test("ambiguous reason names the multiple-match case", () => {
    const r = classify(ev(), [cand({ id: "g1" }), cand({ id: "g2" })]);
    expect(r.reason).toMatch(/2 possible|multiple/i);
  });

  test("ambiguous reason names the loose-title case", () => {
    const r = classify(ev({ name: "Spring Founder Mixer" }), [cand({ summary: "Fall Founder Mixer" })]);
    expect(r.reason).toMatch(/loosely|title/i);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/backfill-gcal.test.ts`
Expected: FAIL — the three new tests report `r.reason` is `undefined`.

- [ ] **Step 3: Implement `reason` in the classifier**

In `scripts/backfill-gcal.classify.mjs`, replace the final `return { bucket: "ambiguous", candidates: matches };` line of `classify` with reason derivation:

```javascript
  // Ambiguous — explain why so the UI can flag it.
  let reason;
  if (matches.length > 1) {
    reason = `${matches.length} possible matches nearby`;
  } else {
    const only = matches[0];
    reason = candidateDate(only) !== ev.event_date
      ? `"${only.summary}" is on ${candidateDate(only)}, a day off`
      : `title only loosely matches "${only.summary}"`;
  }
  return { bucket: "ambiguous", candidates: matches, reason };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/backfill-gcal.test.ts`
Expected: PASS — all 14 tests green.

- [ ] **Step 5: Commit**

```bash
git add scripts/backfill-gcal.classify.mjs tests/backfill-gcal.test.ts
git commit -m "feat(gcal): classifier emits an ambiguity reason"
```

---

### Task 2: Deno edge function — classify + rewrite `auto`

Rewrite the `auto` branch of the Deno function to auto-adopt/create when clear and hold-with-reason when ambiguous. Add the `nameContained` helper inline.

**Files:**
- Modify: `supabase/functions/gcal-sync/index.ts` (inlined helpers ~lines 32-46; `findCandidate` ~203-230; `auto` branch ~302-318)

**Interfaces:**
- Consumes: existing `nameSimilar`, `isOwned`, `timeOverlap`, `eventSpan`, `candidateSpan`, `gcalListWindow`, `buildBody`, `gcalPatch`, `upsertOn`, `Candidate`.
- Produces: `classifyCalendar(token, calId, ev): Promise<{ kind: "create" } | { kind: "confident"; candidate: Candidate } | { kind: "ambiguous"; candidate: Candidate; reason: string }>` (pending stores the single top `candidate`; `reason` explains ambiguity).

- [ ] **Step 1: Add `nameContained` next to `nameSimilar`**

In `supabase/functions/gcal-sync/index.ts`, immediately after the `nameSimilar` function (after line ~46), add:

```typescript
// Full containment only — the "strong" signal separating a confident match from an ambiguous one.
export function nameContained(a: string, b: string): boolean {
  const ta = tokens(a), tb = tokens(b);
  if (!ta.size || !tb.size) return false;
  const [small, big] = ta.size <= tb.size ? [ta, tb] : [tb, ta];
  for (const t of small) if (!big.has(t)) return false;
  return true;
}
```

- [ ] **Step 2: Add `classifyCalendar`, replacing `findCandidate`**

Replace the entire `findCandidate` function (lines ~203-230) with a classifier that gathers all matches and buckets them. Add a `candidateDate` helper just above it:

```typescript
function candidateDate(item: GCalListItem): string {
  return item.start.date ?? (item.start.dateTime ?? "").slice(0, 10);
}

type CalVerdict =
  | { kind: "create" }
  | { kind: "confident"; candidate: Candidate }
  | { kind: "ambiguous"; candidate: Candidate; reason: string };

async function classifyCalendar(token: string, calId: string, ev: any): Promise<CalVerdict> {
  const date: string = ev.event_date;
  const addDays = (d: string, n: number) => { const x = new Date(d + "T00:00:00"); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
  const items = await gcalListWindow(token, calId, addDays(date, -1), addDays(date, 2));

  // Name-similar, not-already-ours candidates in the ±1-day window. (No time-overlap filter here:
  // a same-name event a day off is a near-miss we want reviewed, not silently duplicated.)
  const matches = items.filter((it) => nameSimilar(ev.name ?? "", it.summary ?? "") && !isOwned(it.description));
  const asCand = (it: GCalListItem): Candidate => ({ gcalEventId: it.id, summary: it.summary, start: it.start.dateTime ?? it.start.date ?? "", htmlLink: it.htmlLink });

  if (matches.length === 0) return { kind: "create" };

  if (matches.length === 1) {
    const only = matches[0];
    const strong = nameContained(ev.name ?? "", only.summary ?? "") && candidateDate(only) === date && timeOverlap(eventSpan(ev), candidateSpan(only));
    if (strong) return { kind: "confident", candidate: asCand(only) };
    const reason = candidateDate(only) !== date ? `"${only.summary}" is on ${candidateDate(only)}, a day off` : `title only loosely matches "${only.summary}"`;
    return { kind: "ambiguous", candidate: asCand(only), reason };
  }

  return { kind: "ambiguous", candidate: asCand(matches[0]), reason: `${matches.length} possible matches nearby` };
}
```

- [ ] **Step 3: Rewrite the `auto` branch**

Replace the `auto` branch (lines ~302-318, from `if (action === "auto" && …)` through the closing `}` before the `link` branch) with:

```typescript
    // ── action: auto (first sync) — classify each calendar, then act ──────────
    if (action === "auto" && Object.keys(ids).length === 0) {
      const [vP, vC] = await Promise.all([
        classifyCalendar(token, cals[0], ev),
        classifyCalendar(token, cals[1], ev),
      ]);
      const verdicts: Record<string, CalVerdict> = { [cals[0]]: vP, [cals[1]]: vC };

      // Any ambiguity → hold the whole event for review; write nothing to Calendar.
      if (vP.kind === "ambiguous" || vC.kind === "ambiguous") {
        const pending: Record<string, (Candidate & { reason?: string }) | null> = {};
        for (const calId of cals) {
          const v = verdicts[calId];
          pending[calId] = v.kind === "ambiguous" ? { ...v.candidate, reason: v.reason } : null;
        }
        await sb.from("event").update({ gcal_match_pending: pending }).eq("id", eventId);
        return json({ ok: true, status: "needs_confirmation", candidates: pending });
      }

      // All clear: adopt confident candidates, create where none. (Same write-back as `link`.)
      const settled = await Promise.allSettled(cals.map((calId) => {
        const v = verdicts[calId];
        if (v.kind === "confident") {
          return gcalPatch(token, calId, v.candidate.gcalEventId, buildBody(ev, appLink)).then((patched) => {
            if (!patched.id) throw new Error(`gcalPatch failed on ${calId}: ${patched.error?.message ?? "unknown"}`);
            return { calId, gid: patched.id as string, htmlLink: (patched.htmlLink ?? null) as string | null };
          });
        }
        return upsertOn(token, calId, ev, ids, appLink);
      }));

      const nextIds: Record<string, string> = { ...ids };
      let primaryHtmlLink: string | null = null;
      const errors: string[] = [];
      for (const outcome of settled) {
        if (outcome.status === "fulfilled") { const r = outcome.value; nextIds[r.calId] = r.gid; if (r.calId === PRIMARY) primaryHtmlLink = r.htmlLink; }
        else errors.push(String((outcome.reason as any)?.message ?? outcome.reason));
      }
      await sb.from("event").update({ gcal_event_ids: nextIds, gcal_event_id: nextIds[PRIMARY] ?? null, gcal_html_link: primaryHtmlLink ?? (ev as any).gcal_html_link ?? null, gcal_match_pending: null }).eq("id", eventId);
      return errors.length > 0
        ? json({ ok: false, status: "partial", gcalEventIds: nextIds, errors }, 207)
        : json({ ok: true, status: "synced", gcalEventIds: nextIds, htmlLink: primaryHtmlLink });
    }
```

Note: the `link` and `create` branches below are unchanged — `resolveGcalMatch('link')` still adopts `pending[calId]` (the stored candidate), `'create'` still force-creates.

- [ ] **Step 4: Type-check the Deno function**

Run: `npx tsc --noEmit -p supabase/functions/gcal-sync 2>/dev/null || npx tsc --noEmit supabase/functions/gcal-sync/index.ts --skipLibCheck --moduleResolution bundler --module esnext --target es2022 2>&1 | head`
Expected: no errors referencing `classifyCalendar`/`nameContained` (Deno remote-import errors on the `esm.sh` line are acceptable — they're environmental, not logic).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/gcal-sync/index.ts
git commit -m "feat(gcal): auto action classifies collisions (adopt/create/hold)"
```

---

### Task 3: Node/GCF twin — mirror Task 2 exactly

Apply the identical behavior to the Node twin so deploy parity holds.

**Files:**
- Modify: `cloud-functions/src/functions/gcal-helpers.ts` (add `nameContained`)
- Modify: `cloud-functions/src/functions/gcal-sync.ts` (`findCandidate` ~154-176; `auto` branch ~255-273)

**Interfaces:**
- Consumes: `gcal-helpers.js` exports (`nameSimilar`, `isOwned`, `timeOverlap`, `Span`, and new `nameContained`).
- Produces: identical `classifyCalendar` + `CalVerdict` as Task 2.

- [ ] **Step 1: Add `nameContained` to gcal-helpers.ts**

Append to `cloud-functions/src/functions/gcal-helpers.ts`, reusing its `tokens` helper (it is defined inside `nameSimilar`; lift it to module scope if not already). Add after `nameSimilar`:

```typescript
export function nameContained(a: string, b: string): boolean {
  const tok = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean));
  const ta = tok(a), tb = tok(b);
  if (!ta.size || !tb.size) return false;
  const [small, big] = ta.size <= tb.size ? [ta, tb] : [tb, ta];
  for (const t of small) if (!big.has(t)) return false;
  return true;
}
```

- [ ] **Step 2: Import `nameContained` in the twin**

In `cloud-functions/src/functions/gcal-sync.ts` line 5, add `nameContained` to the import:

```typescript
import { gcalTitle, isEligible, timeOverlap, nameSimilar, nameContained, isOwned, Span } from './gcal-helpers.js';
```

- [ ] **Step 3: Replace `findCandidate` with `classifyCalendar`**

Replace `findCandidate` (lines ~154-176) with the same `candidateDate` + `CalVerdict` + `classifyCalendar` block from Task 2 Step 2 (identical code; the surrounding helpers `gcalListWindow`, `eventSpan`, `candidateSpan`, `Candidate` already exist in this file).

- [ ] **Step 4: Rewrite the `auto` branch**

Replace the twin's `auto` branch (lines ~255-273) with the Task 2 Step 3 logic, adapted to Express responses (`res.json(...)` / `res.status(207).json(...)` and `return;` instead of `return json(...)`), matching the style of the existing `link` branch in this file:

```typescript
    // ── action: auto (first sync) — classify each calendar, then act ──────────
    if (action === 'auto' && Object.keys(ids).length === 0) {
      const [vP, vC] = await Promise.all([classifyCalendar(token, cals[0], ev), classifyCalendar(token, cals[1], ev)]);
      const verdicts: Record<string, CalVerdict> = { [cals[0]]: vP, [cals[1]]: vC };

      if (vP.kind === 'ambiguous' || vC.kind === 'ambiguous') {
        const pending: Record<string, (Candidate & { reason?: string }) | null> = {};
        for (const calId of cals) { const v = verdicts[calId]; pending[calId] = v.kind === 'ambiguous' ? { ...v.candidate, reason: v.reason } : null; }
        await sb.from('event').update({ gcal_match_pending: pending }).eq('id', eventId);
        res.json({ ok: true, status: 'needs_confirmation', candidates: pending });
        return;
      }

      const settled = await Promise.allSettled(cals.map((calId) => {
        const v = verdicts[calId];
        if (v.kind === 'confident') {
          return gcalPatch(token, calId, v.candidate.gcalEventId, buildBody(ev, appLink)).then((patched) => {
            if (!patched.id) throw new Error(`gcalPatch failed on ${calId}: ${patched.error?.message ?? 'unknown'}`);
            return { calId, gid: patched.id as string, htmlLink: (patched.htmlLink ?? null) as string | null };
          });
        }
        return upsertOn(token, calId, ev, ids, appLink);
      }));

      const nextIds: Record<string, string> = { ...ids };
      let primaryHtmlLink: string | null = null;
      const errors: string[] = [];
      for (const outcome of settled) {
        if (outcome.status === 'fulfilled') { const r = outcome.value; nextIds[r.calId] = r.gid; if (r.calId === PRIMARY) primaryHtmlLink = r.htmlLink; }
        else errors.push(String((outcome as any).reason?.message ?? (outcome as any).reason));
      }
      await sb.from('event').update({ gcal_event_ids: nextIds, gcal_event_id: nextIds[PRIMARY] ?? null, gcal_html_link: primaryHtmlLink ?? (ev as any).gcal_html_link ?? null, gcal_match_pending: null }).eq('id', eventId);
      if (errors.length > 0) { res.status(207).json({ ok: false, status: 'partial', gcalEventIds: nextIds, errors }); } else { res.json({ ok: true, status: 'synced', gcalEventIds: nextIds, htmlLink: primaryHtmlLink }); }
      return;
    }
```

- [ ] **Step 5: Build the cloud functions**

Run: `cd cloud-functions && npm run build 2>&1 | tail -20 && cd ..`
Expected: TypeScript compiles with no errors.

- [ ] **Step 6: Commit**

```bash
git add cloud-functions/src/functions/gcal-sync.ts cloud-functions/src/functions/gcal-helpers.ts
git commit -m "feat(gcal): mirror auto-classify collision handling in GCF twin"
```

---

### Task 4: `db.ts` types — pending `reason` + return shape

Give the frontend typed access to the pending reason and sync status.

**Files:**
- Modify: `src/lib/db.ts` (`EventPlanning.gcalMatchPending` type ~line 2627; `syncEventToGoogleCalendar` return type ~line 1897)

**Interfaces:**
- Produces: `EventPlanning.gcalMatchPending: Record<string, { gcalEventId: string; summary: string; start: string; htmlLink: string; reason?: string } | null> | null`; `syncEventToGoogleCalendar` return includes `status?: 'synced' | 'needs_confirmation' | 'partial'` and `candidates?: Record<string, { summary: string; start: string; htmlLink: string; reason?: string } | null>`.

- [ ] **Step 1: Add `reason` to the pending candidate type**

In `src/lib/db.ts` line ~2627, change:

```typescript
  gcalMatchPending: Record<string, { gcalEventId: string; summary: string; start: string; htmlLink: string } | null> | null;
```
to add `reason?: string`:
```typescript
  gcalMatchPending: Record<string, { gcalEventId: string; summary: string; start: string; htmlLink: string; reason?: string } | null> | null;
```

- [ ] **Step 2: Widen the `syncEventToGoogleCalendar` return type**

In `src/lib/db.ts` line ~1897, change the `candidates?: unknown[]` field so callers can read status/candidates:

```typescript
): Promise<{ ok?: boolean; status?: 'synced' | 'needs_confirmation' | 'partial'; gcalEventId?: string; calendarId?: string; htmlLink?: string | null; candidates?: Record<string, { gcalEventId?: string; summary: string; start: string; htmlLink: string; reason?: string } | null>; gcalEventIds?: Record<string, string>; errors?: unknown[] }> {
```

- [ ] **Step 3: Type-check**

Run: `npx tsc -b 2>&1 | head -20`
Expected: no new type errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/db.ts
git commit -m "feat(gcal): type pending reason + sync status on db helpers"
```

---

### Task 5: `GcalLinkControl` — red "needs review" state

Add the third state to the title-card control.

**Files:**
- Modify: `src/components/GcalLinkControl.tsx`

**Interfaces:**
- Consumes: `resolveGcalMatch(eventId, 'link' | 'create')` from `db.ts` (already exported); a new `matchPending` prop of type `Record<string, { summary: string; reason?: string } | null> | null`.
- Produces: `GcalLinkControl` accepting `matchPending`.

- [ ] **Step 1: Import `resolveGcalMatch` and extend props**

In `src/components/GcalLinkControl.tsx` line 3, change the import:

```typescript
import { syncEventToGoogleCalendar, deleteEventFromGoogleCalendar, resolveGcalMatch } from "../lib/db";
```

Add to the props type (after `hasDate: boolean;`):

```typescript
  matchPending?: Record<string, { summary: string; reason?: string } | null> | null;
```

Add to the destructured params (after `hasDate,`): `matchPending = null,`.

- [ ] **Step 2: Add the resolve handler and derived reason**

Inside the component, after the `relink`/`delink` handlers, add:

```typescript
  const pendingReason = matchPending
    ? Object.values(matchPending).find((c) => c && c.reason)?.reason ?? "a possible existing match was found"
    : null;
  const resolve = async (decision: "link" | "create") => {
    setBusy(true); setErr(null);
    try { await resolveGcalMatch(eventId, decision); onChange(); }
    catch (e: any) { setErr(e?.message ?? String(e)); }
    finally { setBusy(false); }
  };
```

- [ ] **Step 3: Render the review branch (before the `synced` branch)**

Insert this block immediately before `if (synced) {` (line ~48):

```tsx
  if (!synced && matchPending) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[13px] text-gray-600">
        <Calendar className="w-5 h-5 text-red-500" title="Needs review before syncing" />
        <span className="text-red-600">{pendingReason}.</span>
        <button onClick={() => resolve("link")} disabled={busy} className="text-emerald-600 hover:text-emerald-700 font-medium disabled:opacity-50">{busy ? "…" : "Link"}</button>
        <button onClick={() => resolve("create")} disabled={busy} className="text-gray-600 hover:text-gray-800 disabled:opacity-50">Create new</button>
        {err && <span className="text-[12px] text-red-600">{err}</span>}
      </span>
    );
  }
```

- [ ] **Step 4: Type-check**

Run: `npx tsc -b 2>&1 | head -20`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/GcalLinkControl.tsx
git commit -m "feat(gcal): red needs-review state on GcalLinkControl"
```

---

### Task 6: `GCalSync` — stop false "synced", surface review

Fix `add()` to respect `needs_confirmation` and show the review affordance.

**Files:**
- Modify: `src/components/GCalSync.tsx`

**Interfaces:**
- Consumes: `resolveGcalMatch` from `db.ts`; a new `matchPending` prop like Task 5.
- Produces: `GCalSync` accepting `matchPending`.

- [ ] **Step 1: Import + props + state**

Line 4, change import to include `resolveGcalMatch`:

```typescript
import { syncEventToGoogleCalendar, syncEventToLinear, resolveGcalMatch } from "../lib/db";
```

Add to the props type + destructure (after `synced,`): `matchPending?: Record<string, { summary: string; reason?: string } | null> | null;` and `matchPending = null,`. Add state near the other `useState`s:

```typescript
  const [pending, setPending] = useState<boolean>(!!matchPending);
  const pendingReason = matchPending ? (Object.values(matchPending).find((c) => c && c.reason)?.reason ?? "a possible existing match was found") : "a possible existing match was found";
```

- [ ] **Step 2: Make `add()` honor `needs_confirmation`**

Replace the body of `add` (lines ~57-71) with:

```typescript
  const add = async () => {
    setBusy(true); setErr(null);
    try {
      const res = await syncEventToGoogleCalendar(eventId);
      if (res.status === "needs_confirmation") { setPending(true); onSynced?.(); return; }
      setLink(res.htmlLink ?? null); setDone(true); setJustSynced(true); onSynced?.();
    } catch (e: any) { setErr(e?.message ?? String(e)); }
    finally { setBusy(false); }
  };
  const resolve = async (decision: "link" | "create") => {
    setBusy(true); setErr(null);
    try {
      await resolveGcalMatch(eventId, decision);
      if (decision === "create" || decision === "link") { setPending(false); setDone(true); setJustSynced(true); onSynced?.(); }
    } catch (e: any) { setErr(e?.message ?? String(e)); }
    finally { setBusy(false); }
  };
```

- [ ] **Step 3: Render review affordance in both variants**

At the very top of the returned JSX in the inline variant (the `if (variant !== "action")` block) and the action variant, add — before the existing "add" affordance — a guard that renders the review row when `pending && !done`:

```tsx
      {pending && !done && (
        <span className="inline-flex items-center gap-1.5 text-[13px]">
          <CalendarPlus className="w-4 h-4 text-red-500" />
          <span className="text-red-600">{pendingReason}.</span>
          <button onClick={() => resolve("link")} disabled={busy} className="text-emerald-600 hover:text-emerald-700 font-medium disabled:opacity-50">Link</button>
          <button onClick={() => resolve("create")} disabled={busy} className="text-gray-600 hover:text-gray-800 disabled:opacity-50">Create new</button>
        </span>
      )}
```

(Place it so it replaces/precedes the "Add to Google Calendar" button while `pending` is true; the existing button still shows when not pending.)

- [ ] **Step 4: Type-check**

Run: `npx tsc -b 2>&1 | head -20`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/GCalSync.tsx
git commit -m "fix(gcal): GCalSync respects needs_confirmation instead of false-synced"
```

---

### Task 7: Thread `matchPending` from parents

Pass `plan.gcalMatchPending` into both controls.

**Files:**
- Modify: `src/components/EventPlanningPage.tsx` (both `GcalLinkControl` usages ~lines 4423, 4428; `GCalSync` usage ~line 3876)
- Modify: `src/components/EventSetup.tsx` (`GCalSync` usage ~line 179)

**Interfaces:**
- Consumes: `plan.gcalMatchPending` (already hydrated by `getEventPlanning`).

- [ ] **Step 1: Pass to both `GcalLinkControl` instances**

In `src/components/EventPlanningPage.tsx`, add `matchPending={plan.gcalMatchPending}` to each `<GcalLinkControl … />` (lines ~4423 and ~4428):

```tsx
<GcalLinkControl eventId={eventId} synced={!!plan.gcalEventId} htmlLink={plan.gcalHtmlLink} hasDate={!!plan.date} matchPending={plan.gcalMatchPending} onChange={() => setReload((x) => x + 1)} />
```

- [ ] **Step 2: Pass to the `GCalSync` in EventPlanningPage**

At the `<GCalSync … />` usage (~line 3876), add `matchPending={plan.gcalMatchPending}`.

- [ ] **Step 3: Pass to the `GCalSync` in EventSetup**

In `src/components/EventSetup.tsx` (~line 179), add `matchPending={plan.gcalMatchPending}` to the `<GCalSync … />` (confirm the local plan object is named `plan`; adjust to the actual variable).

- [ ] **Step 4: Type-check + build**

Run: `npx tsc -b 2>&1 | head -20 && npm run build 2>&1 | tail -5`
Expected: no errors; build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/components/EventPlanningPage.tsx src/components/EventSetup.tsx
git commit -m "feat(gcal): thread gcalMatchPending into calendar controls"
```

---

### Task 8: Deploy cloud function + verify

**Files:** none (operational).

- [ ] **Step 1: Deploy the GCF twin**

Deploy `gcal-sync` via the project's deploy path (see `scripts/deploy.sh` / the memory `deploy-parity-rules`). Confirm which mechanism serves prod (`supabase functions deploy gcal-sync` for the Supabase edge fn, and the Cloud Functions deploy for the twin). Ask the user to run the interactive auth step with `!` if credentials are needed.

- [ ] **Step 2: Manual verification (local)**

With `supabase start` + `npm run dev`: create a local calendar event (unowned) that matches a new EventHub event's title+date → confirm the red "needs review" state with a reason appears; click **Link** → event adopts + turns green; repeat with a fresh event and click **Create new** → a new event is created + green. Create a non-matching event → confirm it auto-syncs green with no prompt.

- [ ] **Step 3: Update memory**

Update `memory/gcal-backfill.md`: the forward `needs_confirmation` gap is now CLOSED (auto-adopt confident / red review state for ambiguous), pending prod deploy of the twin.

## Self-Review

**Spec coverage:** auto classify (Tasks 2/3) ✓; confident auto-adopt (Tasks 2/3) ✓; ambiguous hold+reason (Tasks 1/2/3) ✓; red review UI (Task 5) ✓; false-synced fix (Task 6) ✓; threading (Task 7) ✓; dual-maintenance (Tasks 2+3) ✓; no migration (noted) ✓; deploy parity (Task 8) ✓; testing of classifier (Task 1) ✓.

**Placeholder scan:** EventSetup variable name ("confirm the local plan object is named `plan`") and deploy mechanism (Task 8) are the only "confirm at execution" notes — both are lookups against existing code, not unresolved design. All code steps contain complete code.

**Type consistency:** `CalVerdict`, `classifyCalendar`, `nameContained`, `candidateDate` are used identically in Tasks 2 and 3; `matchPending` prop shape matches the `gcalMatchPending` type from Task 4 across Tasks 5–7; `reason` optional field is consistent end to end.
