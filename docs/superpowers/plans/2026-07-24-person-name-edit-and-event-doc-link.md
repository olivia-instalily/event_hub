# Person name editing + event header Doc/Drive link — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user rename a person from the PersonDetail panel, and add one prominent Doc/Drive link in the event header (mirroring the series folder link).

**Architecture:** Feature 1 is pure app code — extend `updateAttendee` with a `name` field and make the PersonDetail name click-to-edit via the existing `EditableTitle`. Feature 2 adds an `event.doc_link` column, threads `docLink` through `EventPlanning`/`updateEvent`, and introduces a shared `DocLinkControl` component reused by both the event header and the series dashboard.

**Tech Stack:** React + TypeScript, Supabase/PostgREST (`src/lib/db.ts`), Vitest (node environment, pure-function tests only — no RTL/jsdom).

## Global Constraints

- Tests run in the **node** environment; only pure `.test.ts` logic is tested. UI wiring is verified manually. (`vitest.config.ts`)
- URL validation rule (verbatim from series): a link is kept only if it is truthy and `startsWith("http")`, else stored as `null`. (`SeriesDashboard.tsx:46`)
- Column grants mirror the reference-links migration: `GRANT UPDATE (<col>) ON event TO anon, authenticated;` (`20260721000000_event_reference_links.sql:5`)
- **Deploy parity:** Task 1 (migration) does NOT auto-deploy — it must be run against live Cloud SQL manually. All other tasks are app code that auto-deploys with Cloud Run.

---

### Task 1: Migration — `event.doc_link` column + grant

**Files:**
- Create: `supabase/migrations/20260724000000_event_doc_link.sql`

**Interfaces:**
- Produces: an `event.doc_link` TEXT column (nullable), UPDATE-granted to `anon, authenticated`.

- [ ] **Step 1: Write the migration**

```sql
-- Single Doc/Drive link shown prominently in the event header (mirrors the series folderUrl).
-- Distinct from reference_links, which is a list shown in the Resources area.
ALTER TABLE event ADD COLUMN IF NOT EXISTS doc_link text;
GRANT UPDATE (doc_link) ON event TO anon, authenticated;
```

- [ ] **Step 2: Apply locally and verify the column exists**

Run: `supabase db reset` (or apply the single migration against the local stack), then:
Run: `psql "$LOCAL_DB_URL" -c "\d event" | grep doc_link`
Expected: a row showing `doc_link | text`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260724000000_event_doc_link.sql
git commit -m "migration: event.doc_link column + grant"
```

> **DEPLOY PARITY:** After merge, this migration must be run against the live Cloud SQL DB manually — it will NOT ride along with the Cloud Run app deploy.

---

### Task 2: Pure URL helper `normalizeDocUrl`

**Files:**
- Create: `src/lib/docLink.ts`
- Test: `src/lib/docLink.test.ts`

**Interfaces:**
- Produces: `export function normalizeDocUrl(input: string): string | null` — trims input; returns it if it starts with `http`, else `null`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { normalizeDocUrl } from "./docLink";

describe("normalizeDocUrl", () => {
  it("keeps an http(s) url, trimmed", () => {
    expect(normalizeDocUrl("  https://docs.google.com/x  ")).toBe("https://docs.google.com/x");
    expect(normalizeDocUrl("http://example.com")).toBe("http://example.com");
  });
  it("rejects non-http and empty input", () => {
    expect(normalizeDocUrl("")).toBeNull();
    expect(normalizeDocUrl("   ")).toBeNull();
    expect(normalizeDocUrl("docs.google.com/x")).toBeNull();
    expect(normalizeDocUrl("mailto:a@b.com")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/docLink.test.ts`
Expected: FAIL — cannot resolve `./docLink`.

- [ ] **Step 3: Write minimal implementation**

```ts
/** Normalize a pasted Doc/Drive link: keep only trimmed http(s) URLs, else null. */
export function normalizeDocUrl(input: string): string | null {
  const u = input.trim();
  return u && u.startsWith("http") ? u : null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/docLink.test.ts`
Expected: PASS (4 assertions).

- [ ] **Step 5: Commit**

```bash
git add src/lib/docLink.ts src/lib/docLink.test.ts
git commit -m "feat(links): pure normalizeDocUrl helper"
```

---

### Task 3: db.ts — `name` on `updateAttendee`, `docLink` on event read/write

**Files:**
- Modify: `src/lib/db.ts:1298-1310` (`updateAttendee`)
- Modify: `src/lib/db.ts:680-698` (`updateEvent`)
- Modify: `src/lib/db.ts:2585-2605` (`EventPlanning` interface)
- Modify: `src/lib/db.ts:2716-2719` (`getEventPlanning` select) and `:2811` (mapping)

**Interfaces:**
- Produces:
  - `updateAttendee(id, { name?: string | null, ... })` — writes `attendee.name`.
  - `updateEvent(eventId, { docLink?: string | null, ... })` — writes `event.doc_link`.
  - `EventPlanning.docLink: string | null`.

- [ ] **Step 1: Add `name` to `updateAttendee`**

In `src/lib/db.ts:1300`, extend the `fields` type and add the patch line:

```ts
export async function updateAttendee(
  id: string,
  fields: { name?: string | null; note?: string | null; linkedinUrl?: string | null; title?: string | null; org?: string | null; type?: string | null },
): Promise<void> {
  const patch: Record<string, unknown> = {};
  if ('name' in fields) patch.name = fields.name;
  if ('note' in fields) patch.note = fields.note;
  if ('linkedinUrl' in fields) patch.linkedin_url = fields.linkedinUrl;
  if ('title' in fields) patch.title = fields.title;   // speaker role
  if ('org' in fields) patch.org = fields.org;         // speaker company
  if ('type' in fields) patch.type = fields.type;      // Client / Hire / Partner / … (post-event tagging)
  const { error } = await supabase.from('attendee').update(patch).eq('id', id);
  if (error) throw error;
}
```

- [ ] **Step 2: Add `docLink` to `updateEvent`**

In `src/lib/db.ts:682-691`, add `docLink?: string | null;` to the `fields` type, and after the `endTime` patch line (`:698` area) add:

```ts
    if ('docLink' in fields) patch.doc_link = fields.docLink;
```

- [ ] **Step 3: Add `docLink` to the `EventPlanning` interface**

In `src/lib/db.ts:2605`, next to `referenceLinks: ReferenceLink[];`, add:

```ts
  docLink: string | null;   // single prominent Doc/Drive link in the header (distinct from referenceLinks)
```

- [ ] **Step 4: Select and map `doc_link` in `getEventPlanning`**

In the `.select('… reference_links, …')` string at `src/lib/db.ts:2719`, add `doc_link` (e.g. right after `reference_links,`). Then near the `referenceLinks:` mapping at `:2811`, add:

```ts
    docLink: (row as any).doc_link ?? null,
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors from `db.ts`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/db.ts
git commit -m "feat(db): attendee name edit + event docLink read/write"
```

---

### Task 4: `DocLinkControl` shared component

**Files:**
- Create: `src/components/DocLinkControl.tsx`

**Interfaces:**
- Consumes: `normalizeDocUrl` from `src/lib/docLink.ts` (Task 2).
- Produces: `DocLinkControl` — three-state link control (empty → "Add", filled → open link + edit, editing → input + Save/clear).

```tsx
export function DocLinkControl(props: {
  url: string | null;
  onSave: (url: string | null) => void;
  label: string;                    // e.g. "Doc" or "Folder"
  icon: React.ReactNode;            // e.g. <FileText className="w-4 h-4" />
  placeholder?: string;             // e.g. "Paste Google Doc / Drive link…"
}): JSX.Element
```

- [ ] **Step 1: Write the component**

This mirrors `SeriesDashboard.tsx:70-84` but parameterized. Create `src/components/DocLinkControl.tsx`:

```tsx
import { useState } from "react";
import { ExternalLink, X } from "lucide-react";
import { normalizeDocUrl } from "../lib/docLink";

/** Three-state single-link control: empty → Add; filled → open + edit; editing → input + Save/clear. */
export function DocLinkControl({ url, onSave, label, icon, placeholder = "Paste link…" }: {
  url: string | null;
  onSave: (url: string | null) => void;
  label: string;
  icon: React.ReactNode;
  placeholder?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [input, setInput] = useState("");
  const commit = () => { onSave(normalizeDocUrl(input)); setEditing(false); };

  if (editing) {
    return (
      <span className="inline-flex items-center gap-1">
        <input autoFocus value={input} onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(false); }}
          placeholder={placeholder}
          className="w-64 px-2 py-1 border border-border rounded text-[13px] focus:outline-none focus:ring-2 focus:ring-gray-300" />
        <button onClick={commit} className="text-[13px] text-gray-600 hover:text-gray-900">Save</button>
        <button onClick={() => setEditing(false)} className="text-gray-400 hover:text-gray-700"><X className="w-4 h-4" /></button>
      </span>
    );
  }
  if (url) {
    return (
      <span className="inline-flex items-center gap-2">
        <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-[13px] text-gray-700 hover:text-gray-900 border border-border rounded-lg px-2.5 py-1 hover:bg-gray-50 transition-colors">{icon} {label} <ExternalLink className="w-3.5 h-3.5 text-gray-400" /></a>
        <button onClick={() => { setInput(url); setEditing(true); }} className="text-[12px] text-gray-400 hover:text-gray-700">edit</button>
      </span>
    );
  }
  return (
    <button onClick={() => { setInput(""); setEditing(true); }} className="inline-flex items-center gap-1.5 text-[13px] text-gray-500 hover:text-gray-900 border border-dashed border-gray-300 rounded-lg px-2.5 py-1 hover:bg-gray-50 transition-colors">{icon} Add {label.toLowerCase()}</button>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/DocLinkControl.tsx
git commit -m "feat(links): reusable DocLinkControl (three-state single link)"
```

---

### Task 5: Use `DocLinkControl` in the series dashboard (refactor, no behavior change)

**Files:**
- Modify: `src/components/SeriesDashboard.tsx:36-37,46,66-85`

**Interfaces:**
- Consumes: `DocLinkControl` (Task 4).

- [ ] **Step 1: Replace the inline folder control**

Remove the local `folderEdit`/`folderInput` state (`:36-37`) and `saveFolder` (`:46`). Import at top: `import { DocLinkControl } from "./DocLinkControl";` and `import { Folder } from "lucide-react";` (Folder is already imported — keep one import). Replace the `<div className="shrink-0">…</div>` block at `:69-84` with:

```tsx
        <div className="shrink-0">
          <DocLinkControl
            url={campaign.folderUrl}
            onSave={(u) => save({ ...campaign, folderUrl: u })}
            label="Folder"
            icon={<Folder className="w-4 h-4" />}
            placeholder="Paste Drive folder link…"
          />
        </div>
```

Remove now-unused imports (`X`, `ExternalLink`) from `SeriesDashboard.tsx` only if no longer referenced elsewhere in the file (grep first).

- [ ] **Step 2: Verify unused-import cleanliness + typecheck**

Run: `npx tsc --noEmit`
Expected: no errors, no unused-import complaints.

- [ ] **Step 3: Manual verification**

Run the app, open a series: add a folder link, confirm it opens; edit it; clear it (empty save → back to "Add folder"). Behavior identical to before.

- [ ] **Step 4: Commit**

```bash
git add src/components/SeriesDashboard.tsx
git commit -m "refactor(series): folder link via shared DocLinkControl"
```

---

### Task 6: Add the Doc link to the event header

**Files:**
- Modify: `src/components/EventPlanningPage.tsx:4405-4406` (header control row), imports near `:47,63`.

**Interfaces:**
- Consumes: `DocLinkControl` (Task 4), `EventPlanning.docLink` + `updateEvent({ docLink })` (Task 3).

- [ ] **Step 1: Import the control and icon**

Near the other component imports (`:47` area) add:

```tsx
import { DocLinkControl } from "./DocLinkControl";
```

Ensure `FileText` is imported from `lucide-react` in this file's icon import (add it if absent).

- [ ] **Step 2: Render it in the header, next to Luma**

Immediately after the `<LumaAttach … />` line at `:4406`, add:

```tsx
              <DocLinkControl
                url={plan.docLink}
                onSave={(u) => { setPlan((p) => (p ? { ...p, docLink: u } : p)); void updateEvent(eventId, { docLink: u }); }}
                label="Doc"
                icon={<FileText className="w-4 h-4" />}
                placeholder="Paste Google Doc / Drive link…"
              />
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors (`plan.docLink` resolves from Task 3).

- [ ] **Step 4: Manual verification**

Run the app, open an event: the header shows "Add doc"; paste a Doc link → it renders as an openable "Doc" chip; reload → it persists (proves the write + `getEventPlanning` read); edit and clear work. The Resources area is unaffected.

- [ ] **Step 5: Commit**

```bash
git add src/components/EventPlanningPage.tsx
git commit -m "feat(event): single Doc/Drive link in the header"
```

---

### Task 7: Make the person's name editable in PersonDetail

**Files:**
- Modify: `src/components/PeoplePage.tsx:233` (name heading), imports near `:27`.

**Interfaces:**
- Consumes: `updateAttendee({ name })` (Task 3), `EditableTitle` (`src/components/EditableTitle.tsx`), `PersonDetail`'s existing `onSaved(patch: Partial<PersonView>)` prop (`:150`).

- [ ] **Step 1: Import EditableTitle**

Add near the top imports of `PeoplePage.tsx`:

```tsx
import { EditableTitle } from "./EditableTitle";
```

- [ ] **Step 2: Replace the read-only name heading**

At `src/components/PeoplePage.tsx:233`, replace:

```tsx
                <h2 className="text-2xl mt-2">{displayName(person)}</h2>
```

with a click-to-edit heading that commits via `updateAttendee` and propagates through `onSaved`:

```tsx
                <EditableTitle
                  value={person.name ?? ""}
                  onChange={(name) => { void updateAttendee(person.id, { name }); onSaved({ name }); }}
                  className="text-2xl mt-2"
                />
```

`EditableTitle` already trims and no-ops on empty/unchanged (`EditableTitle.tsx:12-16`), satisfying the "don't wipe to blank" guard.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. (`onSaved` accepts `Partial<PersonView>`; `name` is a valid key.)

- [ ] **Step 4: Manual verification**

Run the app, open a person whose name is their email: click the name, type the real name, press Enter → heading updates, and the list card/table row (`:652`, `:881`) reflect it after `onSaved` propagates. Reload → persists.

- [ ] **Step 5: Commit**

```bash
git add src/components/PeoplePage.tsx
git commit -m "feat(people): edit a person's name from the detail panel"
```

---

## Self-Review

**Spec coverage:**
- Feature 1 (edit name): Task 3 (helper) + Task 7 (UI). ✓
- Feature 2 (single header Doc link, dedicated column, mirror series): Task 1 (migration), Task 3 (read/write), Task 4 (shared control), Task 5 (series reuse), Task 6 (event header). ✓
- Resources area untouched: no task modifies `ResourcesSection`/`reference_links`. ✓
- Deploy-parity flag on the migration: Task 1 note. ✓

**Placeholder scan:** none — every code step shows full code and exact commands.

**Type consistency:** `docLink: string | null` used identically across the `EventPlanning` interface (Task 3), `updateEvent` (Task 3), and both call sites (Tasks 6). `normalizeDocUrl` signature matches its consumer in `DocLinkControl` (Tasks 2, 4). `updateAttendee({ name })` and `onSaved({ name })` both key off `PersonView.name`.

## Notes / Out of scope
- No inline name editing in cards/table; detail panel only.
- No Drive picker / link previews.
- The `RoleSelect`/crew-role "flagging" question raised separately is NOT part of this plan — pending clarification.
