# Vendor category · supplier · description — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a vendor decision's category (title), supplier, and an optional description editable in the Vendors tab, with the category chosen from a combobox of categories used across events so the same category groups together.

**Architecture:** No migration — reuse `engagement.category` (category), the selected `engagement_candidate.vendor_name` (supplier), and `engagement.note` (description). A pure `dedupeCategories` helper feeds a new `CategoryCombobox`. Three thin `db.ts` helpers do the writes; renaming a category also re-labels its mirrored budget line. All editing lives in the existing `DecisionCard`.

**Tech Stack:** React + TypeScript, Supabase (PostgREST) via `src/lib/db.ts`, Vitest, Tailwind.

## Global Constraints

- No DB migration — reuse existing columns only.
- Description scope is **per-engagement** (`engagement.note`), not global to the supplier.
- Category rename affects **only this engagement** (and its mirrored budget line), never a global rename.
- Category combobox: pick an existing category or create a new one (free text allowed).
- Empty description recedes to a "+ add description" affordance (no hollow field).
- Standing rule: do NOT push/deploy — commit locally only.

---

### Task 1: `dedupeCategories` pure helper

**Files:**
- Create: `src/lib/vendorCategories.ts`
- Test: `src/lib/vendorCategories.test.ts`

**Interfaces:**
- Produces: `dedupeCategories(raw: (string | null | undefined)[]): string[]` — trims, drops blanks, de-dupes case-insensitively (keeping first-seen casing), sorts case-insensitively.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/vendorCategories.test.ts
import { describe, it, expect } from "vitest";
import { dedupeCategories } from "./vendorCategories";

describe("dedupeCategories", () => {
  it("trims, drops blanks/nulls, and sorts case-insensitively", () => {
    expect(dedupeCategories(["  Venue ", "", null, "AV", undefined, "  "])).toEqual(["AV", "Venue"]);
  });
  it("de-dupes case-insensitively, keeping the first-seen casing", () => {
    expect(dedupeCategories(["Catering", "catering", "CATERING"])).toEqual(["Catering"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/vendorCategories.test.ts`
Expected: FAIL — `Cannot find module './vendorCategories'` / `dedupeCategories is not a function`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/vendorCategories.ts
// Distinct vendor categories for the combobox: trim, drop blanks, case-insensitive de-dupe
// (keep the first-seen casing as the display value), sorted case-insensitively.
export function dedupeCategories(raw: (string | null | undefined)[]): string[] {
  const seen = new Map<string, string>(); // lowercased key → first-seen display
  for (const r of raw) {
    const s = (r ?? "").trim();
    if (!s) continue;
    const k = s.toLowerCase();
    if (!seen.has(k)) seen.set(k, s);
  }
  return [...seen.values()].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/vendorCategories.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/vendorCategories.ts src/lib/vendorCategories.test.ts
git commit -m "feat(vendors): dedupeCategories helper for the category combobox"
```

---

### Task 2: db helpers — list categories, rename category, set description

**Files:**
- Modify: `src/lib/db.ts` (add three exported functions near the other engagement helpers, e.g. after `deleteEngagement` ~line 3061)

**Interfaces:**
- Consumes: `dedupeCategories` (Task 1); existing `supabase`, `listBudgetLines`, `updateBudgetLine`, and the private `categoryKey` helper already in `db.ts`.
- Produces:
  - `listEngagementCategories(): Promise<string[]>`
  - `setEngagementCategory(engagementId: string, category: string): Promise<void>`
  - `setEngagementNote(engagementId: string, note: string | null): Promise<void>`

- [ ] **Step 1: Add the import for `dedupeCategories`**

At the top of `src/lib/db.ts`, alongside the other `./` imports (e.g. after `import { labelsMatch } from './capturePromote';`):

```ts
import { dedupeCategories } from './vendorCategories';
```

- [ ] **Step 2: Add the three helpers**

Insert after `deleteEngagement` (~line 3061):

```ts
/** Distinct vendor categories used across all engagements — feeds the category combobox. */
export async function listEngagementCategories(): Promise<string[]> {
  const { data, error } = await supabase.from('engagement').select('category');
  if (error) { console.warn('listEngagementCategories', error.message); return []; }
  return dedupeCategories((data ?? []).map((r: any) => r.category));
}

/** Rename a vendor decision's category (its title). Renames ONLY this engagement; if the event has a
 *  budget line mirrored under the old category label, re-label it too so Budget stays consistent.
 *  (Caveat: if several engagements shared that category, they still point at their own labels.) */
export async function setEngagementCategory(engagementId: string, category: string): Promise<void> {
  const next = category.trim();
  if (!next) return;
  const { data: eng } = await supabase.from('engagement').select('event_id, category').eq('id', engagementId).maybeSingle();
  const { error } = await supabase.from('engagement').update({ category: next }).eq('id', engagementId);
  if (error) throw new Error(error.message);
  const oldCat = (eng as any)?.category as string | null;
  const eventId = (eng as any)?.event_id as string | null;
  if (oldCat && eventId && categoryKey(oldCat) !== categoryKey(next)) {
    const { data: bud } = await supabase.from('budget').select('id').eq('event_id', eventId).maybeSingle();
    if (bud) {
      const lines = await listBudgetLines((bud as any).id);
      const match = lines.find((l) => l.label && categoryKey(l.label) === categoryKey(oldCat));
      if (match) await updateBudgetLine(match.id, { label: next });
    }
  }
}

/** Set (or clear with null) a vendor decision's description. */
export async function setEngagementNote(engagementId: string, note: string | null): Promise<void> {
  const { error } = await supabase.from('engagement').update({ note: note && note.trim() ? note.trim() : null }).eq('id', engagementId);
  if (error) throw new Error(error.message);
}
```

- [ ] **Step 3: Verify it type-checks**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -v "db.ts(16" | grep vendorCategories; npx tsc --noEmit -p tsconfig.json 2>&1 | grep "db.ts" | grep -i "engagementCategor\|engagementNote"`
Expected: no output (the new functions type-check; the pre-existing unrelated `db.ts(16) 'Phase'` error from another workstream is ignored via the grep).

- [ ] **Step 4: Commit**

```bash
git add src/lib/db.ts
git commit -m "feat(vendors): db helpers to list categories, rename category (+budget line), set note"
```

---

### Task 3: Vendor field editors + wire into DecisionCard

**Files:**
- Create: `src/components/vendorFields.tsx` (`CategoryCombobox`, `DescriptionLine`, `SupplierName`)
- Modify: `src/components/EventPlanningPage.tsx` — `VendorDecisions` (~line 777, load + pass categories) and `DecisionCard` (~line 496–620, use the editors)

**Interfaces:**
- Consumes: `listEngagementCategories`, `setEngagementCategory`, `setEngagementNote`, `updateCandidate` (all in `db.ts`); `EngagementWithCandidates` (has `category`, `note`, `candidates[]` with `id`, `vendorName`, `isSelected`).
- Produces (in `vendorFields.tsx`):
  - `CategoryCombobox({ value, options, onCommit }: { value: string | null; options: string[]; onCommit: (category: string) => void | Promise<void> })`
  - `DescriptionLine({ value, onCommit }: { value: string | null; onCommit: (note: string | null) => void | Promise<void> })`
  - `SupplierName({ value, onCommit }: { value: string | null; onCommit: (name: string) => void | Promise<void> })`

- [ ] **Step 1: Create `src/components/vendorFields.tsx`**

```tsx
import { useState, useRef, useEffect } from "react";
import { Pencil } from "lucide-react";

// Click-to-edit category "title". Typing filters `options` (categories used across events); pick one
// or create a new one. Commit on Enter or option click; Escape/blur cancels. Steers toward reusing an
// existing category so the same group stays together.
export function CategoryCombobox({ value, options, onCommit }: {
  value: string | null; options: string[]; onCommit: (category: string) => void | Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [q, setQ] = useState(value ?? "");
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (editing) setQ(value ?? ""); }, [editing, value]);
  useEffect(() => {
    if (!editing) return;
    const onDown = (e: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setEditing(false); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [editing]);

  const commit = async (c: string) => { const t = c.trim(); setEditing(false); if (t && t !== (value ?? "")) await onCommit(t); };
  const matches = options.filter((o) => o.toLowerCase().includes(q.trim().toLowerCase()));
  const exact = options.some((o) => o.toLowerCase() === q.trim().toLowerCase());

  if (!editing) {
    return (
      <button onClick={() => setEditing(true)} className="group inline-flex items-center gap-1.5 text-lg font-medium text-left hover:text-gray-700" title="Edit category">
        {value ?? "Uncategorized"}
        <Pencil className="w-3.5 h-3.5 text-gray-300 group-hover:text-gray-500" />
      </button>
    );
  }
  return (
    <div ref={boxRef} className="relative inline-block">
      <input
        autoFocus value={q} onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") void commit(q); if (e.key === "Escape") setEditing(false); }}
        placeholder="Category (e.g. Catering)"
        className="text-lg font-medium border border-gray-300 rounded-md px-2 py-0.5 focus:outline-none focus:ring-2 focus:ring-gray-300 w-56"
      />
      {(matches.length > 0 || (q.trim() && !exact)) && (
        <div className="absolute z-20 mt-1 w-64 bg-white border border-border rounded-lg shadow-lg overflow-hidden">
          {matches.map((o) => (
            <button key={o} onClick={() => void commit(o)} className="block w-full text-left px-3 py-1.5 text-sm hover:bg-gray-50">{o}</button>
          ))}
          {q.trim() && !exact && (
            <button onClick={() => void commit(q)} className="block w-full text-left px-3 py-1.5 text-sm text-violet-700 hover:bg-violet-50 border-t border-gray-100">+ Create “{q.trim()}”</button>
          )}
        </div>
      )}
    </div>
  );
}

// Optional per-vendor description. Empty → a subtle "+ add description"; present → click-to-edit text.
export function DescriptionLine({ value, onCommit }: { value: string | null; onCommit: (note: string | null) => void | Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value ?? "");
  useEffect(() => { if (editing) setText(value ?? ""); }, [editing, value]);
  const commit = async () => { setEditing(false); const t = text.trim(); if (t !== (value ?? "")) await onCommit(t || null); };
  if (editing) {
    return (
      <input
        autoFocus value={text} onChange={(e) => setText(e.target.value)} onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") void commit(); if (e.key === "Escape") setEditing(false); }}
        placeholder="Description (e.g. breakfast)"
        className="mt-0.5 w-full max-w-md text-sm text-gray-600 border border-gray-200 rounded-md px-2 py-0.5 focus:outline-none focus:ring-1 focus:ring-gray-300"
      />
    );
  }
  return value
    ? <button onClick={() => setEditing(true)} className="mt-0.5 block text-sm text-gray-500 hover:text-gray-700 text-left" title="Edit description">{value}</button>
    : <button onClick={() => setEditing(true)} className="mt-0.5 block text-[13px] text-gray-400 hover:text-gray-600 text-left">+ add description</button>;
}

// Inline-editable supplier name (the selected candidate).
export function SupplierName({ value, onCommit }: { value: string | null; onCommit: (name: string) => void | Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value ?? "");
  useEffect(() => { if (editing) setText(value ?? ""); }, [editing, value]);
  const commit = async () => { setEditing(false); const t = text.trim(); if (t && t !== (value ?? "")) await onCommit(t); };
  if (editing) {
    return (
      <input autoFocus value={text} onChange={(e) => setText(e.target.value)} onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") void commit(); if (e.key === "Escape") setEditing(false); }}
        className="text-sm border border-gray-200 rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-gray-300" />
    );
  }
  return <button onClick={() => setEditing(true)} className="text-sm font-medium hover:underline" title="Edit supplier">{value ?? "—"}</button>;
}
```

- [ ] **Step 2: Load categories in `VendorDecisions` and pass to each card**

In `src/components/EventPlanningPage.tsx`, in `VendorDecisions` (~line 777), add state + load, and pass `allCategories` to each `DecisionCard`.

Add near the top of `VendorDecisions`:

```tsx
  const [allCategories, setAllCategories] = useState<string[]>([]);
  useEffect(() => { listEngagementCategories().then(setAllCategories).catch(() => {}); }, [initial]);
```

Then, where it renders each `<DecisionCard ... />`, add the prop:

```tsx
            allCategories={allCategories}
```

- [ ] **Step 3: Add imports + the `allCategories` prop to `DecisionCard`**

At the top of `EventPlanningPage.tsx`, add:

```tsx
import { CategoryCombobox, DescriptionLine, SupplierName } from "./vendorFields";
```

Add `listEngagementCategories, setEngagementCategory, setEngagementNote` to the existing `from "../lib/db"` import block, and `updateCandidate` is already imported.

Change the `DecisionCard` signature (~line 496) to accept `allCategories`:

```tsx
function DecisionCard({ initial, eventId, location, onDelete, onChange, allCategories = [] }: { initial: EngagementWithCandidates; eventId: string; location?: string | null; onDelete: () => void; onChange?: (e: EngagementWithCandidates) => void; allCategories?: string[] }) {
```

- [ ] **Step 4: Replace the header block with the editors**

In `DecisionCard`, replace the heading block (~line 611–618):

```tsx
          <p className="text-lg font-medium">{eng.category ?? "Uncategorized"}</p>
          {contracted && (
            <p className="text-sm text-gray-600">
              Confirmed: <span className="font-medium">{money(eng.confirmedAmount)}</span>
              {selected?.vendorName ? ` · ${selected.vendorName}` : ""}
            </p>
          )}
```

with:

```tsx
          <CategoryCombobox
            value={eng.category}
            options={allCategories}
            onCommit={async (c) => { setEng((e) => ({ ...e, category: c })); await setEngagementCategory(eng.id, c); }}
          />
          {selected && (
            <p className="text-sm text-gray-600 mt-0.5">
              {contracted && <>Confirmed: <span className="font-medium">{money(eng.confirmedAmount)}</span> · </>}
              <SupplierName
                value={selected.vendorName}
                onCommit={async (name) => { patchCand(selected.id, { vendorName: name }); await updateCandidate(selected.id, { vendorName: name }); }}
              />
            </p>
          )}
          <DescriptionLine
            value={eng.note}
            onCommit={async (n) => { setEng((e) => ({ ...e, note: n })); await setEngagementNote(eng.id, n); }}
          />
```

- [ ] **Step 5: Type-check + build**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -v "db.ts(16"`
Expected: no output (ignoring the unrelated pre-existing `db.ts(16) 'Phase'` error).
Run: `npm run build 2>&1 | tail -2`
Expected: `✓ built`.

- [ ] **Step 6: Manual verification (Playwright, local dev server)**

With the dev server running, open an event with a vendor decision on the Vendors tab (`http://127.0.0.1:5173/?event=<id>` → Vendors). Verify:
- The category heading is now clickable; clicking shows an input + a dropdown of existing categories; picking one or creating a new one updates the heading.
- Renaming a category that has a mirrored budget line: switch to Budget and confirm the line re-labeled.
- The supplier name (when a candidate is selected) is click-to-edit and persists.
- "+ add description" appears when empty; adding text persists and shows as a description; clearing it returns to "+ add description".

- [ ] **Step 7: Commit**

```bash
git add src/components/vendorFields.tsx src/components/EventPlanningPage.tsx
git commit -m "feat(vendors): editable category combobox, supplier, and description in DecisionCard"
```

---

## Self-Review

**Spec coverage:**
- Category = `engagement.category`, editable via combobox → Task 3 (CategoryCombobox) + Task 2 (`setEngagementCategory`). ✓
- Supplier = selected candidate `vendor_name`, editable → Task 3 (SupplierName + `updateCandidate`). ✓
- Description = `engagement.note`, optional with "+ add description" → Task 3 (DescriptionLine) + Task 2 (`setEngagementNote`). ✓
- Combobox sources categories across events → Task 1 (`dedupeCategories`) + Task 2 (`listEngagementCategories`). ✓
- Category rename re-labels the mirrored budget line, per-engagement only → Task 2 (`setEngagementCategory`). ✓
- No migration → all tasks reuse existing columns. ✓
- Out of scope (C browse, global rename, supplier autocomplete, Slack mapping) → not present. ✓

**Placeholder scan:** none — every step has concrete code/commands.

**Type consistency:** `setEngagementCategory(engagementId, category)`, `setEngagementNote(engagementId, note)`, `listEngagementCategories()`, `dedupeCategories(raw)`, and the `CategoryCombobox`/`DescriptionLine`/`SupplierName` prop shapes are used identically across Tasks 2 and 3. `EngagementWithCandidates.note`/`.category`/`.candidates[].vendorName` match the db.ts type.
