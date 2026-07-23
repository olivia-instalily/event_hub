# "I'm attending" External-Event Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the disabled "I'm attending" card in the create-event flow into a working flow that logs an external event (Industry or PE type), reusing the existing external-conference form and data layer, and surface the type in the calendar filter.

**Architecture:** Add an "External" tag group (`Ext. Industry`, `Ext. PE`) to the taxonomy. Reuse `ExternalConferenceForm` (add a type selector) and `addExternalConference` (persist the tag) for both the calendar "+" button and the create flow. Wire the create flow's "I'm attending" card to open that modal via an App-level callback (mirroring the existing `onBackfill` pattern). Add Industry/PE sub-toggles to the calendar's External filter.

**Tech Stack:** React + TypeScript, Vitest, Supabase JS client (PostgREST), Tailwind.

## Global Constraints

- No DB migration — reuse existing `event.tag` / `event.tags` / `event.is_external` columns.
- Tag labels are exactly `Ext. Industry` and `Ext. PE`. Type pills read `Industry` / `PE`.
- "External" tag group color = **purple**; move "Internal" off purple (tag palette → rose; badge variant → red).
- Calendar sub-toggle labels read short `Industry` / `PE` (stored tag stays the full `Ext. *`).
- All changes are frontend + `src/lib/tags.ts` → auto-deploy on push; nothing manual to run.
- Follow existing file patterns; do not restructure unrelated code.

---

### Task 1: Taxonomy — "External" group, recolor Internal, type→tag helpers

**Files:**
- Modify: `src/lib/tags.ts`
- Test: `tests/tags.test.ts` (create)

**Interfaces:**
- Produces:
  - `TAG_CATEGORIES` gains `{ name: 'External', tags: ['Ext. Industry', 'Ext. PE'] }`
  - `type ExternalType = 'Industry' | 'PE'`
  - `const EXTERNAL_TYPE_TAGS: Record<ExternalType, string>` = `{ Industry: 'Ext. Industry', PE: 'Ext. PE' }`
  - `const EXTERNAL_SUBTYPE_TAGS: string[]` = `['Ext. Industry', 'Ext. PE']`
  - `function externalTagOf(tags: string[]): string | null`

- [ ] **Step 1: Write the failing test**

Create `tests/tags.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  EVENT_TAGS, tagColor, tagBadgeVariant,
  EXTERNAL_TYPE_TAGS, EXTERNAL_SUBTYPE_TAGS, externalTagOf,
} from "../src/lib/tags";

describe("external taxonomy", () => {
  it("registers the two external tags", () => {
    expect(EVENT_TAGS).toContain("Ext. Industry");
    expect(EVENT_TAGS).toContain("Ext. PE");
  });
  it("colors external tags purple", () => {
    expect(tagColor("Ext. Industry")).toContain("purple");
    expect(tagColor("Ext. PE")).toContain("purple");
    expect(tagBadgeVariant("Ext. PE")).toBe("purple");
  });
  it("moves Internal off purple", () => {
    expect(tagColor("Internal team social")).not.toContain("purple");
    expect(tagColor("Internal team social")).toContain("rose");
    expect(tagBadgeVariant("Company milestone")).not.toBe("purple");
  });
  it("maps a type to its tag", () => {
    expect(EXTERNAL_TYPE_TAGS.Industry).toBe("Ext. Industry");
    expect(EXTERNAL_TYPE_TAGS.PE).toBe("Ext. PE");
    expect(EXTERNAL_SUBTYPE_TAGS).toEqual(["Ext. Industry", "Ext. PE"]);
  });
  it("extracts the external subtype tag from a tag list", () => {
    expect(externalTagOf(["Ext. PE"])).toBe("Ext. PE");
    expect(externalTagOf(["Client summit"])).toBeNull();
    expect(externalTagOf([])).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/tags.test.ts`
Expected: FAIL — `EXTERNAL_TYPE_TAGS`/`externalTagOf` not exported; "External" tags missing.

- [ ] **Step 3: Add the External category and recolor Internal**

In `src/lib/tags.ts`, change `TAG_CATEGORIES`:

```ts
export const TAG_CATEGORIES: TagCategory[] = [
  { name: 'Hosted', tags: ['Client summit', 'Brand & community event', 'Co-hosted partner event', 'Campus'] },
  { name: 'Sponsorship', tags: ['Sponsorship'] },
  { name: 'Internal', tags: ['Internal team social', 'Company milestone'] },
  { name: 'External', tags: ['Ext. Industry', 'Ext. PE'] },
];
```

Update `PRESET` (Internal 1→6 = rose; add External = 1 = purple):

```ts
const PRESET: Record<string, number> = {
  // Hosted → green
  'Client summit': 2, 'Brand & community event': 2, 'Co-hosted partner event': 2, Campus: 2,
  // Sponsorship → amber
  Sponsorship: 7,
  // Internal → rose
  'Internal team social': 6, 'Company milestone': 6,
  // External → purple
  'Ext. Industry': 1, 'Ext. PE': 1,
};
```

Update `BADGE_PRESET` (Internal purple→red; add External purple):

```ts
const BADGE_PRESET: Record<string, BadgeVariant> = {
  'Client summit': 'green', 'Brand & community event': 'green', 'Co-hosted partner event': 'green', Campus: 'green',
  Sponsorship: 'yellow',
  'Internal team social': 'red', 'Company milestone': 'red',
  'Ext. Industry': 'purple', 'Ext. PE': 'purple',
};
```

- [ ] **Step 4: Add the type→tag helpers**

Append to the end of `src/lib/tags.ts`:

```ts
// External-event types shown as pills in the create/attending flow, each mapped to its taxonomy tag.
export type ExternalType = 'Industry' | 'PE';
export const EXTERNAL_TYPE_TAGS: Record<ExternalType, string> = {
  Industry: 'Ext. Industry',
  PE: 'Ext. PE',
};
export const EXTERNAL_SUBTYPE_TAGS: string[] = Object.values(EXTERNAL_TYPE_TAGS);
// The external subtype tag on an event's tag list, or null (legacy/untyped external).
export function externalTagOf(tags: string[]): string | null {
  return tags.find((t) => EXTERNAL_SUBTYPE_TAGS.includes(t)) ?? null;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/tags.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/tags.ts tests/tags.test.ts
git commit -m "feat(tags): add External taxonomy group (Ext. Industry/PE), recolor Internal"
```

---

### Task 2: Persist the tag on external conferences

**Files:**
- Modify: `src/lib/db.ts:2056-2075`

**Interfaces:**
- Consumes: nothing new (plain string tag).
- Produces: `ExternalConferenceInput` gains `tag: string`; `addExternalConference` writes it to `event.tag` and `event.tags`.

- [ ] **Step 1: Add `tag` to the input type**

Change `ExternalConferenceInput` (`src/lib/db.ts:2056-2059`):

```ts
export interface ExternalConferenceInput {
  name: string; startDate: string; endDate?: string | null;
  why?: string | null; quarter?: string | null; location?: string | null; infoUrl?: string | null;
  tag: string; // taxonomy tag, e.g. "Ext. Industry" | "Ext. PE"
}
```

- [ ] **Step 2: Write the tag on insert**

In `addExternalConference`, change the insert object (`src/lib/db.ts:2069-2075`) so `tag`/`tags` carry the value (replace the `tags: []` line):

```ts
  const { error } = await supabase.from('event').insert({
    id, name, event_date: input.startDate, end_date: input.endDate || null,
    is_external: true, lightweight: true, is_template: false, macro_stage: null,
    location: input.location?.trim() || null, why: input.why?.trim() || null,
    quarter: input.quarter?.trim() || null, info_url: input.infoUrl?.trim() || null,
    tag: input.tag, tags: [input.tag],
  });
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "db.ts|error TS" | head`
Expected: no `db.ts` errors. (Callers break until Task 3 — that's expected; only confirm no errors *inside* db.ts. The one expected error is in `ExternalConferenceForm.tsx` for the missing `tag` arg, fixed in Task 3.)

- [ ] **Step 4: Commit**

```bash
git add src/lib/db.ts
git commit -m "feat(db): persist tag on addExternalConference"
```

---

### Task 3: Type selector in the external-event modal

**Files:**
- Modify: `src/components/ExternalConferenceForm.tsx:98-155`

**Interfaces:**
- Consumes: `ExternalType`, `EXTERNAL_TYPE_TAGS` from `src/lib/tags.ts`; `addExternalConference({ ..., tag })` from Task 2.
- Produces: modal now requires a type before save and passes the mapped tag.

- [ ] **Step 1: Import the type helpers**

At the top of `src/components/ExternalConferenceForm.tsx`, add to the existing imports:

```ts
import { EXTERNAL_TYPE_TAGS, type ExternalType } from "../lib/tags";
```

- [ ] **Step 2: Add type state**

Inside the component (near the other `useState` calls, e.g. after `const [name, setName] = useState("");`):

```ts
  const [type, setType] = useState<ExternalType | null>(null);
```

- [ ] **Step 3: Require the type and pass the tag on save**

In `save()`, add the guard after the existing `badRange` check and pass the tag into `addExternalConference`:

```ts
  const save = async () => {
    if (!name.trim()) { setErr("Name is required."); return; }
    if (!type) { setErr("Pick a type — Industry or PE."); return; }
    if (!start) { setErr("Start date is required."); return; }
    if (badRange) { setErr("End date must be on or after the start date."); return; }
    setBusy(true); setErr(null);
    try {
      const id = await addExternalConference({ name, startDate: start, endDate: end || null, why, quarter: effectiveQuarter || null, location, infoUrl, tag: EXTERNAL_TYPE_TAGS[type] });
      for (const p of picked) {
        try {
          if (p.kind === "existing") await linkAttendeeToEvent(id, p.id);
          else await addAttendee(id, { name: p.name, email: p.email || null });
        } catch { /* skip one bad attendee */ }
      }
      onCreated();
    } catch (e: any) { setErr(e?.message ?? String(e)); setBusy(false); }
  };
```

- [ ] **Step 4: Render the Type pills at the top of the form**

In the returned JSX, insert this as the FIRST child inside `<div className="space-y-3 max-h-[65vh] overflow-y-auto pr-1 -mr-1">` (before the Name `<label>`):

```tsx
        <div>
          <span className="text-[13px] text-gray-500">Type<span className="text-red-500">*</span></span>
          <div className="mt-1 flex gap-2">
            {(["Industry", "PE"] as ExternalType[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setType(t)}
                className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${type === t ? "border-purple-500 bg-purple-50 text-purple-800" : "border-gray-300 text-gray-600 hover:bg-gray-50"}`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
```

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "ExternalConferenceForm|error TS" | head`
Expected: no errors (the Task 2 caller error is now resolved).

- [ ] **Step 6: Manual verification**

Run the app (`/run` skill or `npm run dev`). On the Calendar page, click the purple **+** → the modal shows a **Type** row (Industry/PE) at top. Try Save with no type → inline "Pick a type" error. Pick PE, fill Name + Start date, Save → a purple external event appears on the calendar.

- [ ] **Step 7: Commit**

```bash
git add src/components/ExternalConferenceForm.tsx
git commit -m "feat(external): require Industry/PE type in the external-event modal"
```

---

### Task 4: Wire "I'm attending" into the create-event flow

**Files:**
- Modify: `src/components/EventsPage.tsx:785, 811-822, 1311-1314` (and the `CreateEventModal` props type)
- Modify: `src/App.tsx:86-113, 304-314`

**Interfaces:**
- Consumes: `ExternalConferenceForm` (existing), `onChooseAttending` callback.
- Produces: `CreateEventModal` gains prop `onAttending: () => void`; App renders `ExternalConferenceForm` when `attendingOpen` is set.

- [ ] **Step 1: Add `'attending'` to the choice union**

`src/components/EventsPage.tsx:785`:

```ts
  const [choice, setChoice] = useState<'planning' | 'attending' | 'backfill' | null>(null);
```

- [ ] **Step 2: Add the `onAttending` prop to CreateEventModal**

Find the `CreateEventModal` props type (the object type destructured in its signature, which already includes `onBackfill`) and add:

```ts
  onAttending: () => void;
```

Add `onAttending` to the destructured parameter list alongside `onBackfill`.

- [ ] **Step 3: Handle 'attending' in continueFromChoose**

`src/components/EventsPage.tsx:811-822`, add an `else if` branch:

```ts
  const continueFromChoose = () => {
    if (choice === 'planning') {
      if (pendingDrop) { setPlanKind('solo'); const fs = pendingDrop; setPendingDrop(null); void handleBriefDrop(fs); }
      else setMode('planFork');
    } else if (choice === 'attending') {
      // External event we attend — its own minimal flow (opposite of planning). Hand off to the
      // external-event modal at the app root; the type (Industry/PE) is chosen inside it.
      setPendingDrop(null);
      onAttending();
    } else if (choice === 'backfill') {
      const fs = pendingDrop; setPendingDrop(null);
      if (fs?.length) void (async () => { const c = await Promise.all(fs.map(classifyDropFile)); onBackfill(c.find((x) => x.kind === "brief")?.text ?? undefined, fs); })();
      else onBackfill();
    }
  };
```

- [ ] **Step 4: Enable the "I'm attending" card + new copy**

`src/components/EventsPage.tsx:1311-1314`, replace the disabled button:

```tsx
              <button onClick={() => setChoice('attending')} className={`border rounded-xl p-6 text-left transition-colors ${choice === 'attending' ? 'border-border bg-gray-100' : 'border-gray-300 hover:bg-gray-50'}`}>
                <p className="text-lg font-medium">I&apos;m attending</p>
                <p className="text-sm text-gray-500 mt-1">A third party runs it; we attend an external event — e.g. an industry conference or a PE event.</p>
              </button>
```

- [ ] **Step 5: Pass `onAttending` from App and render the modal**

`src/App.tsx` — add state near the other create-flow state (after line 87):

```ts
  const [attendingOpen, setAttendingOpen] = useState(false);
```

Add the prop to `<CreateEventModal>` (`src/App.tsx:305-313`), mirroring `onBackfill`:

```tsx
          onAttending={() => { setCreateOpen(false); setCreateFiles(null); setCreateAsTemplate(false); setAttendingOpen(true); }}
```

Render the modal after the `{backfill && (...)}` block (`src/App.tsx:323`):

```tsx
      {attendingOpen && (
        <ExternalConferenceForm
          onClose={() => setAttendingOpen(false)}
          onCreated={() => { setAttendingOpen(false); }}
        />
      )}
```

Add the import at the top of `src/App.tsx`:

```ts
import { ExternalConferenceForm } from './components/ExternalConferenceForm';
```

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "App.tsx|EventsPage.tsx|error TS" | head`
Expected: no errors.

- [ ] **Step 7: Manual verification**

Run the app. Click **Create Event** → choose **I'm attending** → **Continue**. The external-event modal opens (with the Type row). Create one → it lands on both the Calendar (purple) and the Events page external section.

- [ ] **Step 8: Commit**

```bash
git add src/components/EventsPage.tsx src/App.tsx
git commit -m "feat(create): wire I'm attending to the external-event modal"
```

---

### Task 5: Calendar Industry/PE sub-toggles

**Files:**
- Modify: `src/components/CalendarPage.tsx:1-79`

**Interfaces:**
- Consumes: `EXTERNAL_SUBTYPE_TAGS`, `EXTERNAL_TYPE_TAGS`, `externalTagOf` from `src/lib/tags.ts` (Task 1, already tested).
- Produces: calendar filters external events by selected subtypes.

- [ ] **Step 1: Import the helpers**

Add to `src/components/CalendarPage.tsx` imports:

```ts
import { EXTERNAL_SUBTYPE_TAGS, EXTERNAL_TYPE_TAGS, externalTagOf, type ExternalType } from "../lib/tags";
```

- [ ] **Step 2: Add subtype state**

After `const [showExternal, setShowExternal] = useState(true);` (line 18):

```ts
  const [subtypes, setSubtypes] = useState<Set<string>>(new Set(EXTERNAL_SUBTYPE_TAGS));
  const toggleSub = (tag: string) => setSubtypes((prev) => { const n = new Set(prev); n.has(tag) ? n.delete(tag) : n.add(tag); return n; });
```

- [ ] **Step 3: Filter shown events by subtype**

Replace line 31:

```ts
  const shown = showExternal
    ? merged.filter((e) => { if (!e.isExternal) return true; const t = externalTagOf(e.tags); return t ? subtypes.has(t) : true; })
    : events; // Future/In-Process/Past never filter — only External + its subtypes
```

- [ ] **Step 4: Render the sub-toggles when External is on**

Immediately AFTER the External `<button>` (closes at line 75) and BEFORE the add-`+` button (line 76), insert:

```tsx
        {showExternal && (["Industry", "PE"] as ExternalType[]).map((t) => {
          const tag = EXTERNAL_TYPE_TAGS[t];
          const on = subtypes.has(tag);
          return (
            <button
              key={t}
              onClick={() => toggleSub(tag)}
              aria-pressed={on}
              title={`Toggle ${t} external events`}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] transition-colors ${on ? "border-purple-400 bg-purple-50 text-purple-800" : "border-border bg-white text-gray-400 hover:bg-gray-50"}`}
            >
              <span className={`w-2 h-2 rounded-full ${on ? "bg-purple-500" : "bg-purple-200"}`} /> {t}
            </button>
          );
        })}
```

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "CalendarPage.tsx|error TS" | head`
Expected: no errors.

- [ ] **Step 6: Manual verification**

Run the app → Calendar. With **External** on, **Industry** and **PE** pills appear to its right, both active. Toggle **PE** off → only Industry (and legacy untyped) externals remain; toggle External off → both pills disappear and all externals hide. Confirm an untagged legacy external still shows whenever External is on.

- [ ] **Step 7: Commit**

```bash
git add src/components/CalendarPage.tsx
git commit -m "feat(calendar): Industry/PE sub-toggles under the External filter"
```

---

## Self-Review

**Spec coverage:**
- §1 Taxonomy → Task 1 ✓ (External group, purple; Internal rose/red)
- §2 Create chooser enable + copy + handoff → Task 4 ✓
- §3 Modal type selector → Task 3 ✓
- §4 Persist tag → Task 2 ✓
- §5 Calendar sub-toggles → Task 5 ✓ (legacy-untyped-always-shown handled in Step 3/4)
- "Appears in both Calendar + Events" → no code change needed (both already call `listExternalConferences`); verified manually in Task 4 Step 7 ✓

**Placeholder scan:** none — every code/test step has full content.

**Type consistency:** `ExternalType` (`'Industry' | 'PE'`), `EXTERNAL_TYPE_TAGS`, `EXTERNAL_SUBTYPE_TAGS`, `externalTagOf` defined in Task 1 and consumed with the same names/signatures in Tasks 3–5. `ExternalConferenceInput.tag` added in Task 2 and supplied in Task 3. `onAttending` added and passed in Task 4.

**Note on tests:** Tasks 2–5 are DB-write / UI wiring with no pure-logic seam beyond what Task 1 already unit-tests (`externalTagOf` covers the calendar filter logic), so they're verified by `tsc` + manual steps — consistent with this repo's test surface (pure logic in `tests/`, no component/DB mock harness).
