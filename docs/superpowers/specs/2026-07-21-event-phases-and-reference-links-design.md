# Event phases (default + editor) & reference links — design

**Status:** Approved design (2026-07-21)
**Scope:** two independent event-page enhancements: (1) a smarter default phase set when an event is
created from a drop without explicit phases, plus an event-side phase editor; (2) a reference-links
area on the event for open-only docs/sheets/folders (never processed).

---

## Part 1 — Phases: date-aware default + editor

### Current state
An event's phases are an ordered `{ name, order }[]` set once at creation (from the brief, or a
fallback). Deliverables group under a phase; the timeline/phase-rail is built from them. There is **no
event-side phase editor** today — only templates can add phases. A dropped event with no explicit
phases currently ends up with a single **Wrap** phase.

### Default (on create-from-drop, no explicit phases)
A shared helper `defaultPhases(date: string | null): {name,order}[]`:
- **past** (`date` set and `date < today`) → `[{ name: "Wrap", order: 0 }]`
- **future or undated** → `[{ name: "Plan", order: 0 }, { name: "Wrap", order: 1 }]`

Applied in every create path that currently defaults phases when the ingest yields none: the
EventsPage create-from-review flow, `backfillEvent` (past → Wrap), and the Series wave/pending
drop-create (`SeriesPlan.createFromDrop`). Explicit phases from a brief are unchanged.

### Event-side phase editor
A small phase editor on the event planning page: **add**, **rename**, **remove**, **reorder** phases.
- Persist via a db helper `setEventPhases(eventId, phases: {name,order}[])` (or reuse `setEventPattern`,
  which already writes `phases`). Reorder = reassign `order`.
- **Task reassignment (no orphans):** deliverables carry their phase by *name*. On **rename**, update
  every deliverable whose `phase` matches the old name to the new name. On **remove**, reassign that
  phase's deliverables to the previous phase in order (or the first remaining phase; if none remain,
  clear to the fallback). Never leave a deliverable pointing at a deleted phase.
- Location: a compact editor on the event page near the phase rail / timeline (exact placement follows
  the existing planning-page layout).

### Rules
- Renaming/removing a phase must keep deliverables consistent (reassignment above).
- At least one phase always remains (removing the last is disallowed / no-op).
- The default only applies when there are **no** explicit phases; a brief's phases win.

---

## Part 2 — Reference links (open-only resources)

### Concept
A place to attach **reference** material to an event — a Google Doc, Sheet, Slides, a Drive folder, any
URL — that teammates can open. **Never processed / ingested / wrapped** (distinct from
`source_materials`, which feed extraction). Purely a list of links for others to open.

### Data model — new column (migration)
```sql
-- migration: add reference_links to event
ALTER TABLE event ADD COLUMN IF NOT EXISTS reference_links jsonb NOT NULL DEFAULT '[]'::jsonb;
GRANT UPDATE (reference_links) ON event TO anon, authenticated;
```
Shape: `ReferenceLink = { id: string; label: string; url: string }`. (`anon` grant matches the existing
per-column grant convention; `authenticated` already has blanket write, but the explicit grant keeps
the pattern consistent.)

### db
- `EventPlanning` gains `referenceLinks: ReferenceLink[]`; `getEventPlanning` selects `reference_links`
  and maps it (default `[]`).
- `setEventReferenceLinks(eventId, links: ReferenceLink[]): Promise<void>` — writes the column.

### UI (event page)
- A **"Resources"** area (link icon) listing each reference link as a clickable row (label →
  `target="_blank" rel="noreferrer"`, plus the URL/host as subtext).
- Add a link: label + URL inputs → append. Remove per row. No processing, no ingest — purely stored
  and opened.
- Empty state: "No linked resources yet — add a Google Doc, sheet, or folder."

### Rules
- Reference links are never fed to `extractBrief`/ingest and never become deliverables/source materials.
- Basic URL sanity (must look like an http(s) URL); label optional (fall back to the host).

---

## Components / files
- `src/lib/db.ts` — `EventPlanning.referenceLinks`, `getEventPlanning` mapping, `setEventReferenceLinks`, `setEventPhases` (or reuse `setEventPattern`).
- `src/lib/eventPhases.ts` (or inline in db/EventsPage) — `defaultPhases(date)` helper (pure, unit-tested).
- `src/components/EventsPage.tsx`, `src/lib/db.ts` (`backfillEvent`), `src/components/SeriesPlan.tsx` — apply `defaultPhases` in the create-from-drop paths.
- `src/components/EventPlanningPage.tsx` — the phase editor + the Resources (reference-links) area.
- `supabase/migrations/<ts>_event_reference_links.sql` — the new column + grant.

## Testing
- Pure: `defaultPhases` (past → [Wrap]; future/undated → [Plan, Wrap]) unit-tested with vitest.
- Phase-editor reassignment logic (rename → deliverables follow; remove → reassign) — pure helper unit-tested if extracted; otherwise `tsc` + manual.
- Reference links — `tsc` + manual (no committed budget/link fixture in the repo).

## Deploy parity
- **Part 1** is frontend + `db.ts` only (phases already a granted `event` column via the auth blanket grant) — ships via the SPA build. No migration.
- **Part 2 REQUIRES a manual step:** the `reference_links` migration (new column + grant) must be applied to prod before/with the deploy, or `getEventPlanning` (which will select the column) 400s. This is a manual deploy step per the deploy-parity rules.
