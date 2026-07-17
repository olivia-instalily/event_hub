# Series / Campaign Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A four-tab series/campaign dashboard (Plan · People & logistics · Budget · Briefs) over the existing `event_series`, plus a nav reorg that folds People + Vendors into a Contacts tab and adds a Series tab.

**Architecture:** Campaign structure (drive, waves, people, travel, anchors) lives in `event_series.extras.campaign` (jsonb — no migration); event membership stays on `event.series_id`. Pure derivations (headcount, travel estimate, per-person brief) live in `src/lib/campaign.ts` and are unit-tested; persistence helpers in `db.ts`; UI in focused `Series*` components. Budget is a read-only estimate that never touches committed spend.

**Tech Stack:** React 18 + Vite + TypeScript, Tailwind, `@instalily/ui` (Tabs, Button), supabase-js (PostgREST as the `authenticated` role), vitest (node env).

## Global Constraints

- Store the campaign in `event_series.extras.campaign`; membership authoritative on `event.series_id`.
- A campaign person is a linked `profileId` OR free-text `{name, email}` (optional `@instalily.ai` email; no notifications).
- People-planning ≠ budget: assigning a person to a wave never charges travel; the flying/local flag is independent.
- Travel is an ESTIMATE: `Σ over waves ( flyers on that wave × travelRatePerWave )`; locals add $0; per-wave (charged each wave a person flies in for). Never flows into committed spend.
- Combined budget = read-only sum of member events' `event_budget_target` + travel estimate.
- Headcount = **distinct** people (someone on two waves counts once).
- Briefs are filtered views from real data; unset lodging/travel shows "to confirm" — never invented.
- Empty states: unstaffed waves → "not yet staffed"; events without a budget → "—". No 0s/errors.
- New top nav order: Home · Events · Contacts · Series · Budget · Calendar (People/Vendors folded into Contacts; `people` stays an internal event-scoped page).
- Anchor events: `campaign.anchorEventIds` (toggled on the Plan tab), rendered visually distinct.

---

### Task 1: Campaign model + pure derivations (TDD)

**Files:**
- Create: `src/lib/campaign.ts`
- Create: `src/lib/campaign.test.ts`

**Interfaces:**
- Produces: `Drive`, `Wave`, `CampaignPerson`, `Campaign`, `emptyCampaign()`, `personLabel(p)`,
  `distinctPeople(c)`, `peakHeadcount(c)`, `travelerLocalCounts(c)`, `travelEstimate(c)`,
  `memberBudgetTotal(events)`, `personBrief(c, personId, eventsById)`.
- `BriefEvent = { id: string; name: string; date: string | null; location: string | null }`.
- `personBrief` returns `{ person: CampaignPerson; label: string; waves: { wave: Wave; events: BriefEvent[] }[]; lodging: string; travelDetail: string; traveling: boolean } | null`.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/campaign.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  emptyCampaign, personLabel, distinctPeople, peakHeadcount, travelerLocalCounts,
  travelEstimate, memberBudgetTotal, personBrief, type Campaign,
} from "./campaign";

function fixture(): Campaign {
  return {
    drive: "recruiting",
    travelRatePerWave: 500,
    anchorEventIds: ["e-hack"],
    waves: [
      { id: "w1", name: "Wave 1", start: "2026-09-01", end: "2026-09-07", eventIds: ["e-hack", "e-mixer"] },
      { id: "w2", name: "Wave 2", start: "2026-09-08", end: "2026-09-14", eventIds: ["e-hack"] },
    ],
    people: [
      { id: "p1", profileId: "prof-a", waveIds: ["w1", "w2"], travel: "flying" },       // 2 waves, flies both
      { id: "p2", name: "Cathy", email: "cathy@instalily.ai", waveIds: ["w1"], travel: "local" },
      { id: "p3", name: "Sam", waveIds: ["w2"], travel: "flying", lodging: "Hotel X" },
    ],
  };
}

describe("headcount", () => {
  it("counts distinct people once even across multiple waves", () => {
    expect(distinctPeople(fixture())).toBe(3);
  });
  it("peak = max distinct people on any single wave", () => {
    expect(peakHeadcount(fixture())).toBe(2); // w1: p1,p2  w2: p1,p3
  });
  it("splits travelers vs locals by distinct people", () => {
    expect(travelerLocalCounts(fixture())).toEqual({ traveling: 2, local: 1 });
  });
});

describe("travelEstimate", () => {
  it("charges flyers per wave × rate; locals add $0", () => {
    // w1 flyers: p1 → 1 ; w2 flyers: p1,p3 → 2 ; (1+2)*500 = 1500
    expect(travelEstimate(fixture())).toBe(1500);
  });
  it("is 0 when rate is null", () => {
    expect(travelEstimate({ ...fixture(), travelRatePerWave: null })).toBe(0);
  });
});

describe("memberBudgetTotal", () => {
  it("sums event_budget_target, skipping nulls", () => {
    expect(memberBudgetTotal([{ eventBudgetTarget: 1000 }, { eventBudgetTarget: null }, { eventBudgetTarget: 250 }])).toBe(1250);
  });
});

describe("personLabel", () => {
  it("prefers profile-less name, else the linked-profile placeholder", () => {
    expect(personLabel({ id: "x", name: "Cathy", waveIds: [], travel: "local" })).toBe("Cathy");
    expect(personLabel({ id: "x", profileId: "prof-a", waveIds: [], travel: "flying" })).toBe("Teammate");
  });
});

describe("personBrief", () => {
  const eventsById = {
    "e-hack": { id: "e-hack", name: "Hackathon", date: "2026-09-03", location: "Toronto" },
    "e-mixer": { id: "e-mixer", name: "Mixer", date: "2026-09-05", location: "Toronto" },
  };
  it("filters to the person's waves and their events; 'to confirm' when unset", () => {
    const b = personBrief(fixture(), "p3", eventsById)!;
    expect(b.waves.map((w) => w.wave.id)).toEqual(["w2"]);
    expect(b.waves[0].events.map((e) => e.id)).toEqual(["e-hack"]); // only w2's events that exist
    expect(b.lodging).toBe("Hotel X");
    expect(b.travelDetail).toBe("to confirm");
    expect(b.traveling).toBe(true);
  });
  it("respects an explicit eventIds override", () => {
    const c = fixture();
    c.people[0].eventIds = ["e-mixer"]; // p1 tagged to just the mixer
    const b = personBrief(c, "p1", eventsById)!;
    expect(b.waves.flatMap((w) => w.events.map((e) => e.id))).toEqual(["e-mixer"]);
  });
  it("returns null for an unknown person", () => {
    expect(personBrief(fixture(), "nope", eventsById)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/campaign.test.ts`
Expected: FAIL — `Cannot find module './campaign'`.

- [ ] **Step 3: Implement `src/lib/campaign.ts`**

```ts
// Campaign structure stored in event_series.extras.campaign, plus pure derivations used by the
// dashboard tabs and briefs. No DB access here — all functions take data and return values.
export type Drive = "recruiting" | "culture" | "client";

export interface Wave { id: string; name: string; start: string | null; end: string | null; eventIds: string[]; }
export interface CampaignPerson {
  id: string;
  profileId?: string | null;   // linked account, OR:
  name?: string; email?: string; // free-text person (email optional, @instalily.ai)
  waveIds: string[];
  travel: "flying" | "local";
  lodging?: string | null;
  travelDetail?: string | null;
  eventIds?: string[];         // optional: specific events attended (else all events in their waves)
}
export interface Campaign {
  drive: Drive;
  travelRatePerWave: number | null;
  waves: Wave[];
  people: CampaignPerson[];
  anchorEventIds: string[];
}

export const emptyCampaign = (): Campaign => ({ drive: "recruiting", travelRatePerWave: null, waves: [], people: [], anchorEventIds: [] });

// Coerce a possibly-partial jsonb blob into a well-formed Campaign (older/absent fields default).
export function normalizeCampaign(raw: any): Campaign {
  const c = raw && typeof raw === "object" ? raw : {};
  return {
    drive: (["recruiting", "culture", "client"].includes(c.drive) ? c.drive : "recruiting") as Drive,
    travelRatePerWave: typeof c.travelRatePerWave === "number" ? c.travelRatePerWave : null,
    waves: Array.isArray(c.waves) ? c.waves.map((w: any) => ({ id: String(w.id), name: w.name ?? "", start: w.start ?? null, end: w.end ?? null, eventIds: Array.isArray(w.eventIds) ? w.eventIds : [] })) : [],
    people: Array.isArray(c.people) ? c.people.map((p: any) => ({ id: String(p.id), profileId: p.profileId ?? null, name: p.name, email: p.email, waveIds: Array.isArray(p.waveIds) ? p.waveIds : [], travel: p.travel === "local" ? "local" : "flying", lodging: p.lodging ?? null, travelDetail: p.travelDetail ?? null, eventIds: Array.isArray(p.eventIds) ? p.eventIds : undefined })) : [],
    anchorEventIds: Array.isArray(c.anchorEventIds) ? c.anchorEventIds : [],
  };
}

export function personLabel(p: CampaignPerson): string {
  return (p.name && p.name.trim()) || p.email || (p.profileId ? "Teammate" : "Unknown");
}

export const distinctPeople = (c: Campaign): number => c.people.length; // each entry is one distinct person

export function peakHeadcount(c: Campaign): number {
  return c.waves.reduce((max, w) => Math.max(max, c.people.filter((p) => p.waveIds.includes(w.id)).length), 0);
}

export function travelerLocalCounts(c: Campaign): { traveling: number; local: number } {
  const traveling = c.people.filter((p) => p.travel === "flying").length;
  return { traveling, local: c.people.length - traveling };
}

// Per-wave travel cost: each wave charges (# flyers on that wave) × rate. Locals never counted.
export function travelEstimate(c: Campaign): number {
  const rate = c.travelRatePerWave ?? 0;
  if (!rate) return 0;
  return c.waves.reduce((sum, w) => sum + c.people.filter((p) => p.travel === "flying" && p.waveIds.includes(w.id)).length * rate, 0);
}

export function memberBudgetTotal(events: { eventBudgetTarget: number | null }[]): number {
  return events.reduce((sum, e) => sum + (e.eventBudgetTarget ?? 0), 0);
}

export interface BriefEvent { id: string; name: string; date: string | null; location: string | null; }
export interface PersonBrief {
  person: CampaignPerson; label: string;
  waves: { wave: Wave; events: BriefEvent[] }[];
  lodging: string; travelDetail: string; traveling: boolean;
}
export function personBrief(c: Campaign, personId: string, eventsById: Record<string, BriefEvent>): PersonBrief | null {
  const person = c.people.find((p) => p.id === personId);
  if (!person) return null;
  const waves = c.waves
    .filter((w) => person.waveIds.includes(w.id))
    .map((wave) => {
      const ids = person.eventIds ? wave.eventIds.filter((id) => person.eventIds!.includes(id)) : wave.eventIds;
      const events = ids.map((id) => eventsById[id]).filter(Boolean) as BriefEvent[];
      return { wave, events };
    });
  return {
    person, label: personLabel(person), waves,
    lodging: (person.lodging && person.lodging.trim()) || "to confirm",
    travelDetail: (person.travelDetail && person.travelDetail.trim()) || "to confirm",
    traveling: person.travel === "flying",
  };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/lib/campaign.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add src/lib/campaign.ts src/lib/campaign.test.ts
git commit -m "feat(series): campaign model + pure derivations (headcount, travel, brief)"
```

---

### Task 2: Series/campaign persistence helpers (db.ts)

**Files:**
- Modify: `src/lib/db.ts` (add near the other series/event helpers; import from `./campaign`)

**Interfaces:**
- Consumes: `Campaign`, `emptyCampaign`, `normalizeCampaign` from `./campaign`.
- Produces:
  - `SeriesListItem = { id: string; name: string; drive: Drive; memberCount: number }`
  - `listSeries(): Promise<SeriesListItem[]>`
  - `createSeries(name: string, drive: Drive): Promise<string>`
  - `getSeriesCampaign(seriesId): Promise<{ id: string; name: string; campaign: Campaign; events: SeriesEvent[] }>`
    where `SeriesEvent = { id: string; name: string; date: string | null; location: string | null; eventBudgetTarget: number | null }`
  - `saveCampaign(seriesId, campaign: Campaign): Promise<void>`
  - `setEventSeries(eventId: string, seriesId: string | null): Promise<void>`

- [ ] **Step 1: Add imports + helpers**

At the top of `src/lib/db.ts`, add to the campaign import (create the import line if none exists):

```ts
import { type Campaign, type Drive, emptyCampaign, normalizeCampaign } from "./campaign";
```

Add these functions near the other event/series helpers (e.g. after `listEvents`):

```ts
export interface SeriesListItem { id: string; name: string; drive: Drive; memberCount: number; }
export interface SeriesEvent { id: string; name: string; date: string | null; location: string | null; eventBudgetTarget: number | null; }

export async function listSeries(): Promise<SeriesListItem[]> {
  const { data, error } = await supabase.from("event_series").select("id, name, extras, events:event ( id )").order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((s: any) => ({
    id: s.id, name: s.name,
    drive: (normalizeCampaign(s.extras?.campaign).drive) as Drive,
    memberCount: Array.isArray(s.events) ? s.events.length : 0,
  }));
}

export async function createSeries(name: string, drive: Drive): Promise<string> {
  const id = newId("ser");
  const extras = { campaign: { ...emptyCampaign(), drive } };
  const { error } = await supabase.from("event_series").insert({ id, name: name.trim() || "Untitled campaign", extras });
  if (error) throw error;
  return id;
}

export async function getSeriesCampaign(seriesId: string): Promise<{ id: string; name: string; campaign: Campaign; events: SeriesEvent[] }> {
  const { data: s, error } = await supabase.from("event_series").select("id, name, extras").eq("id", seriesId).single();
  if (error) throw error;
  const { data: evs } = await supabase.from("event").select("id, name, event_date, location, event_budget_target").eq("series_id", seriesId).eq("is_template", false);
  const events: SeriesEvent[] = (evs ?? []).map((e: any) => ({ id: e.id, name: e.name, date: e.event_date ?? null, location: e.location ?? null, eventBudgetTarget: e.event_budget_target ?? null }));
  return { id: s.id, name: s.name, campaign: normalizeCampaign((s as any).extras?.campaign), events };
}

// Read-modify-write of extras.campaign (preserve any other extras keys).
export async function saveCampaign(seriesId: string, campaign: Campaign): Promise<void> {
  const { data: s, error: readErr } = await supabase.from("event_series").select("extras").eq("id", seriesId).single();
  if (readErr) throw readErr;
  const extras = { ...((s as any).extras ?? {}), campaign };
  const { error } = await supabase.from("event_series").update({ extras }).eq("id", seriesId);
  if (error) throw error;
}

export async function setEventSeries(eventId: string, seriesId: string | null): Promise<void> {
  const { error } = await supabase.from("event").update({ series_id: seriesId }).eq("id", eventId);
  if (error) throw error;
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/db.ts
git commit -m "feat(series): event_series campaign persistence helpers"
```

---

### Task 3: Contacts nav merge (People + Vendors → one tab)

**Files:**
- Create: `src/components/ContactsPage.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `PeoplePage` (`{ eventFilter, onBack }`, both optional-ish — pass none for unscoped), `VendorsPage` (no props).
- Produces: `ContactsPage` (no props).

- [ ] **Step 1: Create `ContactsPage.tsx`**

```tsx
import { useState } from "react";
import { Users, Briefcase } from "lucide-react";
import { PeoplePage } from "./PeoplePage";
import { VendorsPage } from "./VendorsPage";

// People and Vendors are both "contacts" — one tab with a segmented sub-view. Reuses the existing
// pages unchanged; PeoplePage renders unscoped here (no eventFilter).
export function ContactsPage() {
  const [view, setView] = useState<"people" | "vendors">("people");
  return (
    <div>
      <div className="inline-flex rounded-lg border border-border bg-white p-0.5 mb-6">
        {([["people", "People", Users], ["vendors", "Vendors", Briefcase]] as const).map(([k, label, Icon]) => (
          <button key={k} onClick={() => setView(k)} className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-colors ${view === k ? "bg-gray-900 text-white" : "text-gray-600 hover:bg-gray-50"}`}>
            <Icon className="w-4 h-4" /> {label}
          </button>
        ))}
      </div>
      {view === "people" ? <PeoplePage /> : <VendorsPage />}
    </div>
  );
}
```

Note: `PeoplePage` is `({ eventFilter, onBack }: PeoplePageProps)` — rendering `<PeoplePage />` with no props gives the unscoped list. If TS flags required props, this task also widens them to optional in `PeoplePage.tsx` (`eventFilter?: … ; onBack?: …`). Verify at Step 3.

- [ ] **Step 2: Wire nav in `App.tsx`**

In `src/App.tsx`:
- Add to imports: `import { ContactsPage } from './components/ContactsPage';`
- In the `activePage` union type add `'contacts'` (keep `'people'`/`'vendors'` — `people` is still used event-scoped; `vendors` can stay for safety but is dropped from the top nav).
- Replace the People + Vendors `TabsTrigger`s with one Contacts trigger:

```tsx
<TabsTrigger value="contacts"><Users className="w-4 h-4" /> Contacts</TabsTrigger>
```

(Remove the `value="people"` and `value="vendors"` triggers. `Briefcase` import may become unused — remove it from the lucide import if so.)

- In the page render switch, add: `{activePage === 'contacts' && <ContactsPage />}` (leave the existing `activePage === 'people'` block — it still serves the event-scoped People view via `peopleEventFilter`; leave/remove the standalone `vendors` render — Vendors now lives in Contacts).

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors (fix `PeoplePage` optional props / unused `Briefcase` if flagged).

- [ ] **Step 4: Commit**

```bash
git add src/components/ContactsPage.tsx src/App.tsx src/components/PeoplePage.tsx
git commit -m "feat(nav): fold People + Vendors into a Contacts tab"
```

---

### Task 4: Series tab + list/create

**Files:**
- Create: `src/components/SeriesListPage.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `listSeries`, `createSeries` (Task 2); `Drive` from `../lib/campaign`.
- Produces: `SeriesListPage({ onOpen }: { onOpen: (seriesId: string) => void })`.

- [ ] **Step 1: Create `SeriesListPage.tsx`**

```tsx
import { useEffect, useState } from "react";
import { Plus, Layers } from "lucide-react";
import { listSeries, createSeries, type SeriesListItem } from "../lib/db";
import type { Drive } from "../lib/campaign";

const DRIVES: Drive[] = ["recruiting", "culture", "client"];

export function SeriesListPage({ onOpen }: { onOpen: (seriesId: string) => void }) {
  const [items, setItems] = useState<SeriesListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [drive, setDrive] = useState<Drive>("recruiting");

  const load = () => { setLoading(true); listSeries().then(setItems).catch(() => {}).finally(() => setLoading(false)); };
  useEffect(() => { load(); }, []);

  const create = async () => {
    if (!name.trim()) return;
    const id = await createSeries(name, drive);
    setName(""); setCreating(false);
    onOpen(id);
  };

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl inline-flex items-center gap-2"><Layers className="w-6 h-6 text-gray-700" /> Series</h1>
        <button onClick={() => setCreating((v) => !v)} className="inline-flex items-center gap-2 px-4 py-2 bg-muted text-foreground rounded-lg hover:brightness-95 hover:shadow-sm transition"><Plus className="w-4 h-4" /> New series</button>
      </div>

      {creating && (
        <div className="mb-6 rounded-xl border border-border p-4 flex flex-wrap items-center gap-2">
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") create(); }} placeholder="Campaign name (e.g. Toronto campus activation)" className="flex-1 min-w-[16rem] px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
          <select value={drive} onChange={(e) => setDrive(e.target.value as Drive)} className="px-3 py-2 border border-border rounded-lg text-sm bg-white">
            {DRIVES.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
          <button onClick={create} disabled={!name.trim()} className="px-3 py-2 bg-gray-900 text-white rounded-lg text-sm disabled:opacity-50">Create</button>
        </div>
      )}

      {loading ? <p className="text-gray-400 py-12 text-center">Loading…</p>
        : items.length === 0 ? <p className="text-gray-400 py-12 text-center border border-dashed border-gray-300 rounded-2xl">No series yet — create one for a multi-event campaign.</p>
        : (
          <div className="rounded-xl border border-border divide-y divide-gray-100">
            {items.map((s) => (
              <button key={s.id} onClick={() => onOpen(s.id)} className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-gray-50">
                <span className="font-medium">{s.name}</span>
                <span className="text-[13px] text-gray-500">{s.drive} · {s.memberCount} event{s.memberCount === 1 ? "" : "s"}</span>
              </button>
            ))}
          </div>
        )}
    </div>
  );
}
```

- [ ] **Step 2: Wire the Series tab in `App.tsx`**

- Add imports: `import { SeriesListPage } from './components/SeriesListPage';` and `import { SeriesDashboard } from './components/SeriesDashboard';` (created in Task 5).
- Add `'series'` to the `activePage` union.
- Add state: `const [selectedSeriesId, setSelectedSeriesId] = useState<string | null>(null);`
- Add a `TabsTrigger` (after Contacts): `<TabsTrigger value="series"><Layers className="w-4 h-4" /> Series</TabsTrigger>` (import `Layers` from lucide-react). In `navTo`, when leaving Series, `setSelectedSeriesId(null)`.
- Render:

```tsx
{activePage === 'series' && (
  selectedSeriesId
    ? <SeriesDashboard seriesId={selectedSeriesId} onBack={() => setSelectedSeriesId(null)} onOpenEvent={(id) => openEvent(id, 'series')} />
    : <SeriesListPage onOpen={(id) => setSelectedSeriesId(id)} />
)}
```

- Add `'series'` to the `Page` type used by `eventOrigin` so `openEvent(id, 'series')` typechecks and Back from an event returns to the series.

- [ ] **Step 3: Typecheck (SeriesDashboard stub)**

Create a temporary stub so this task compiles independently: `src/components/SeriesDashboard.tsx`:
```tsx
export function SeriesDashboard({ seriesId, onBack }: { seriesId: string; onBack: () => void; onOpenEvent?: (id: string) => void }) {
  return <div><button onClick={onBack} className="text-sm text-gray-600">← Series</button><p className="mt-4 text-gray-400">Dashboard for {seriesId} (built next).</p></div>;
}
```
Run: `npx tsc --noEmit -p tsconfig.json` — Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/SeriesListPage.tsx src/components/SeriesDashboard.tsx src/App.tsx
git commit -m "feat(series): Series tab with list + create"
```

---

### Task 5: SeriesDashboard shell + Plan tab

**Files:**
- Modify: `src/components/SeriesDashboard.tsx` (replace the stub)
- Create: `src/components/SeriesPlan.tsx`

**Interfaces:**
- Consumes: `getSeriesCampaign`, `saveCampaign`, `setEventSeries`, `listEvents` (Task 2 + existing); `Campaign`, `Wave`, `emptyCampaign`, `normalizeCampaign` from `../lib/campaign`.
- Produces:
  - `SeriesDashboard({ seriesId, onBack, onOpenEvent })`
  - shared prop shape for tabs: `TabProps = { seriesId: string; campaign: Campaign; events: SeriesEvent[]; save: (next: Campaign) => void; onOpenEvent?: (id: string) => void }`
  - `SeriesPlan(props: TabProps)`

- [ ] **Step 1: Implement the dashboard shell**

Replace `src/components/SeriesDashboard.tsx`:

```tsx
import { useEffect, useState } from "react";
import { ChevronLeft } from "lucide-react";
import { getSeriesCampaign, saveCampaign, type SeriesEvent } from "../lib/db";
import { type Campaign, emptyCampaign } from "../lib/campaign";
import { SeriesPlan } from "./SeriesPlan";
import { SeriesPeople } from "./SeriesPeople";
import { SeriesBudget } from "./SeriesBudget";
import { SeriesBriefs } from "./SeriesBriefs";

export interface TabProps {
  seriesId: string;
  campaign: Campaign;
  events: SeriesEvent[];
  save: (next: Campaign) => void;
  onOpenEvent?: (id: string) => void;
}
type Tab = "plan" | "people" | "budget" | "briefs";
const TABS: { key: Tab; label: string }[] = [
  { key: "plan", label: "Plan" }, { key: "people", label: "People & logistics" },
  { key: "budget", label: "Budget" }, { key: "briefs", label: "Briefs" },
];

export function SeriesDashboard({ seriesId, onBack, onOpenEvent }: { seriesId: string; onBack: () => void; onOpenEvent?: (id: string) => void }) {
  const [name, setName] = useState("");
  const [campaign, setCampaign] = useState<Campaign>(emptyCampaign());
  const [events, setEvents] = useState<SeriesEvent[]>([]);
  const [tab, setTab] = useState<Tab>("plan");
  const [loading, setLoading] = useState(true);

  const load = () => { setLoading(true); getSeriesCampaign(seriesId).then((s) => { setName(s.name); setCampaign(s.campaign); setEvents(s.events); }).catch(() => {}).finally(() => setLoading(false)); };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [seriesId]);

  // Optimistic save: update local state immediately, persist in the background, reload on error.
  const save = (next: Campaign) => { setCampaign(next); saveCampaign(seriesId, next).catch(() => load()); };

  const props: TabProps = { seriesId, campaign, events, save, onOpenEvent };

  return (
    <div className="max-w-5xl mx-auto">
      <button onClick={onBack} className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900 mb-3"><ChevronLeft className="w-4 h-4" /> Series</button>
      <h1 className="text-2xl mb-1">{name}</h1>
      <p className="text-sm text-gray-500 mb-5 capitalize">{campaign.drive} drive · {events.length} event{events.length === 1 ? "" : "s"}</p>

      <div className="border-b border-gray-200 mb-6 flex gap-4">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)} className={`pb-2 text-sm border-b-2 transition-colors ${tab === t.key ? "border-gray-900 text-gray-900 font-medium" : "border-transparent text-gray-500 hover:text-gray-800"}`}>{t.label}</button>
        ))}
      </div>

      {loading ? <p className="text-gray-400 py-12 text-center">Loading…</p> : (
        <>
          {tab === "plan" && <SeriesPlan {...props} />}
          {tab === "people" && <SeriesPeople {...props} />}
          {tab === "budget" && <SeriesBudget {...props} />}
          {tab === "briefs" && <SeriesBriefs {...props} />}
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Implement `SeriesPlan.tsx`**

```tsx
import { useState } from "react";
import { Plus, X, Star, ExternalLink } from "lucide-react";
import type { TabProps } from "./SeriesDashboard";
import { type Wave } from "../lib/campaign";

const newWaveId = () => "w-" + (globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2));

export function SeriesPlan({ campaign, events, save, onOpenEvent }: TabProps) {
  const [adding, setAdding] = useState(false);
  const [wName, setWName] = useState("");

  const eventsById = Object.fromEntries(events.map((e) => [e.id, e]));
  const assignedIds = new Set(campaign.waves.flatMap((w) => w.eventIds));
  const pending = events.filter((e) => !assignedIds.has(e.id));

  const addWave = () => { if (!wName.trim()) return; save({ ...campaign, waves: [...campaign.waves, { id: newWaveId(), name: wName.trim(), start: null, end: null, eventIds: [] }] }); setWName(""); setAdding(false); };
  const patchWave = (id: string, patch: Partial<Wave>) => save({ ...campaign, waves: campaign.waves.map((w) => (w.id === id ? { ...w, ...patch } : w)) });
  const removeWave = (id: string) => save({ ...campaign, waves: campaign.waves.filter((w) => w.id !== id) });
  const assignEvent = (eventId: string, waveId: string) => save({ ...campaign, waves: campaign.waves.map((w) => ({ ...w, eventIds: w.id === waveId ? [...new Set([...w.eventIds, eventId])] : w.eventIds.filter((id) => id !== eventId) })) });
  const unassign = (eventId: string) => save({ ...campaign, waves: campaign.waves.map((w) => ({ ...w, eventIds: w.eventIds.filter((id) => id !== eventId) })) });
  const toggleAnchor = (eventId: string) => save({ ...campaign, anchorEventIds: campaign.anchorEventIds.includes(eventId) ? campaign.anchorEventIds.filter((id) => id !== eventId) : [...campaign.anchorEventIds, eventId] });

  const EventRow = ({ id, waveId }: { id: string; waveId?: string }) => {
    const e = eventsById[id]; if (!e) return null;
    const anchor = campaign.anchorEventIds.includes(id);
    return (
      <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${anchor ? "border-amber-300 bg-amber-50" : "border-gray-200"}`}>
        {anchor && <Star className="w-3.5 h-3.5 text-amber-500 shrink-0" />}
        <button onClick={() => onOpenEvent?.(id)} className="flex-1 min-w-0 text-left text-sm hover:underline inline-flex items-center gap-1"><span className="truncate">{e.name}</span><ExternalLink className="w-3 h-3 text-gray-400 shrink-0" /></button>
        <span className="text-[12px] text-gray-400 shrink-0">{e.date ?? "—"}</span>
        <button onClick={() => toggleAnchor(id)} title={anchor ? "Unmark anchor" : "Mark as anchor"} className={`shrink-0 ${anchor ? "text-amber-500" : "text-gray-300 hover:text-amber-500"}`}><Star className="w-4 h-4" /></button>
        {waveId && <button onClick={() => unassign(id)} title="Remove from wave" className="shrink-0 text-gray-300 hover:text-red-600"><X className="w-4 h-4" /></button>}
        {!waveId && campaign.waves.length > 0 && (
          <select onChange={(e2) => e2.target.value && assignEvent(id, e2.target.value)} defaultValue="" className="shrink-0 text-[12px] border border-gray-200 rounded px-1 py-0.5 bg-white">
            <option value="" disabled>Add to wave…</option>
            {campaign.waves.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {campaign.waves.map((w) => (
        <section key={w.id} className="rounded-xl border border-border p-4">
          <div className="flex items-center gap-2 mb-3">
            <input value={w.name} onChange={(e) => patchWave(w.id, { name: e.target.value })} className="font-medium border-b border-transparent hover:border-gray-200 focus:border-gray-400 focus:outline-none" />
            <input type="date" value={w.start ?? ""} onChange={(e) => patchWave(w.id, { start: e.target.value || null })} className="text-[13px] border border-gray-200 rounded px-1.5 py-0.5" />
            <span className="text-gray-400">–</span>
            <input type="date" value={w.end ?? ""} onChange={(e) => patchWave(w.id, { end: e.target.value || null })} className="text-[13px] border border-gray-200 rounded px-1.5 py-0.5" />
            <button onClick={() => removeWave(w.id)} className="ml-auto text-gray-300 hover:text-red-600" aria-label="Remove wave"><X className="w-4 h-4" /></button>
          </div>
          <div className="space-y-1.5">
            {w.eventIds.length === 0 ? <p className="text-[13px] text-gray-400">No events in this wave yet.</p> : w.eventIds.map((id) => <EventRow key={id} id={id} waveId={w.id} />)}
          </div>
        </section>
      ))}

      {adding ? (
        <div className="flex items-center gap-2">
          <input autoFocus value={wName} onChange={(e) => setWName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addWave(); }} placeholder="Wave name (e.g. Wave 1)" className="px-3 py-2 border border-border rounded-lg text-sm" />
          <button onClick={addWave} disabled={!wName.trim()} className="px-3 py-2 bg-gray-900 text-white rounded-lg text-sm disabled:opacity-50">Add</button>
          <button onClick={() => setAdding(false)} className="text-gray-400 hover:text-gray-700"><X className="w-4 h-4" /></button>
        </div>
      ) : (
        <button onClick={() => setAdding(true)} className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900"><Plus className="w-4 h-4" /> Add wave</button>
      )}

      <section>
        <h3 className="text-[15px] font-medium text-gray-700 mb-2">Pending events <span className="text-gray-400 font-normal">· not yet in a wave</span></h3>
        {pending.length === 0 ? <p className="text-[13px] text-gray-400">All member events are assigned.{events.length === 0 ? " Add events to this series from an event's page (set its series)." : ""}</p> : (
          <div className="space-y-1.5">{pending.map((e) => <EventRow key={e.id} id={e.id} />)}</div>
        )}
      </section>
    </div>
  );
}
```

- [ ] **Step 3: Typecheck (with sibling stubs)**

Create minimal stubs so the dashboard imports resolve: `SeriesPeople.tsx`, `SeriesBudget.tsx`, `SeriesBriefs.tsx`, each:
```tsx
import type { TabProps } from "./SeriesDashboard";
export function SeriesPeople(_: TabProps) { return <p className="text-gray-400">People tab (next).</p>; }
```
(name each export accordingly). Run: `npx tsc --noEmit -p tsconfig.json` — Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/SeriesDashboard.tsx src/components/SeriesPlan.tsx src/components/SeriesPeople.tsx src/components/SeriesBudget.tsx src/components/SeriesBriefs.tsx
git commit -m "feat(series): dashboard shell + Plan tab (waves, assign, anchors)"
```

---

### Task 6: People & logistics tab

**Files:**
- Modify: `src/components/SeriesPeople.tsx` (replace stub)

**Interfaces:**
- Consumes: `TabProps`; `peakHeadcount`, `travelerLocalCounts`, `personLabel`, `CampaignPerson` from `../lib/campaign`; `useProfile` from `../lib/profile`.

- [ ] **Step 1: Implement**

```tsx
import { useState } from "react";
import { Plus, X, Plane, MapPin } from "lucide-react";
import type { TabProps } from "./SeriesDashboard";
import { peakHeadcount, travelerLocalCounts, personLabel, type CampaignPerson } from "../lib/campaign";
import { useProfile } from "../lib/profile";

const newPersonId = () => "cp-" + (globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2));

export function SeriesPeople({ campaign, save }: TabProps) {
  const { profiles } = useProfile();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");

  const patchPerson = (id: string, patch: Partial<CampaignPerson>) => save({ ...campaign, people: campaign.people.map((p) => (p.id === id ? { ...p, ...patch } : p)) });
  const removePerson = (id: string) => save({ ...campaign, people: campaign.people.filter((p) => p.id !== id) });
  const toggleWave = (p: CampaignPerson, waveId: string) => patchPerson(p.id, { waveIds: p.waveIds.includes(waveId) ? p.waveIds.filter((w) => w !== waveId) : [...p.waveIds, waveId] });
  const addProfile = (profileId: string) => { const pr = profiles.find((x) => x.id === profileId); if (!pr) return; save({ ...campaign, people: [...campaign.people, { id: newPersonId(), profileId, name: pr.name, email: pr.email ?? undefined, waveIds: [], travel: "flying" }] }); };
  const addFreeText = () => { if (!name.trim()) return; save({ ...campaign, people: [...campaign.people, { id: newPersonId(), name: name.trim(), email: email.trim() || undefined, waveIds: [], travel: "flying" }] }); setName(""); setEmail(""); setAdding(false); };

  const { traveling, local } = travelerLocalCounts(campaign);

  if (campaign.waves.length === 0) return <p className="text-gray-400">Add waves on the Plan tab first, then assign people to them here.</p>;

  return (
    <div className="space-y-5">
      <div className="flex gap-6 text-sm">
        <span><span className="font-medium">{peakHeadcount(campaign)}</span> <span className="text-gray-500">peak headcount</span></span>
        <span className="inline-flex items-center gap-1"><Plane className="w-4 h-4 text-gray-400" /> <span className="font-medium">{traveling}</span> <span className="text-gray-500">traveling</span></span>
        <span className="inline-flex items-center gap-1"><MapPin className="w-4 h-4 text-gray-400" /> <span className="font-medium">{local}</span> <span className="text-gray-500">local</span></span>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="px-3 py-2 text-left font-medium text-gray-600">Person</th>
              {campaign.waves.map((w) => <th key={w.id} className="px-3 py-2 text-center font-medium text-gray-600 whitespace-nowrap">{w.name}</th>)}
              <th className="px-3 py-2 text-center font-medium text-gray-600">Travel</th>
              <th className="px-2 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {campaign.people.length === 0 && <tr><td colSpan={campaign.waves.length + 3} className="px-3 py-6 text-center text-gray-400">Not yet staffed.</td></tr>}
            {campaign.people.map((p) => (
              <tr key={p.id}>
                <td className="px-3 py-2">{personLabel(p)}{p.email && <span className="block text-[12px] text-gray-400">{p.email}</span>}</td>
                {campaign.waves.map((w) => (
                  <td key={w.id} className="px-3 py-2 text-center">
                    <input type="checkbox" checked={p.waveIds.includes(w.id)} onChange={() => toggleWave(p, w.id)} className="rounded border-gray-300" />
                  </td>
                ))}
                <td className="px-3 py-2 text-center">
                  <button onClick={() => patchPerson(p.id, { travel: p.travel === "flying" ? "local" : "flying" })} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px] ${p.travel === "flying" ? "bg-blue-50 text-blue-700" : "bg-gray-100 text-gray-600"}`}>
                    {p.travel === "flying" ? <><Plane className="w-3 h-3" /> Flying</> : <><MapPin className="w-3 h-3" /> Local</>}
                  </button>
                </td>
                <td className="px-2 py-2 text-right"><button onClick={() => removePerson(p.id)} className="text-gray-300 hover:text-red-600"><X className="w-4 h-4" /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {adding ? (
        <div className="flex flex-wrap items-center gap-2">
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" className="px-3 py-2 border border-border rounded-lg text-sm" />
          <input value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addFreeText(); }} placeholder="name@instalily.ai (optional)" className="px-3 py-2 border border-border rounded-lg text-sm" />
          <button onClick={addFreeText} disabled={!name.trim()} className="px-3 py-2 bg-gray-900 text-white rounded-lg text-sm disabled:opacity-50">Add</button>
          <button onClick={() => setAdding(false)} className="text-gray-400 hover:text-gray-700"><X className="w-4 h-4" /></button>
          <span className="text-[13px] text-gray-400">or add a teammate:</span>
          <select defaultValue="" onChange={(e) => { if (e.target.value) { addProfile(e.target.value); } }} className="px-2 py-2 border border-border rounded-lg text-sm bg-white">
            <option value="" disabled>Pick a profile…</option>
            {profiles.map((pr) => <option key={pr.id} value={pr.id}>{pr.name}</option>)}
          </select>
        </div>
      ) : (
        <button onClick={() => setAdding(true)} className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900"><Plus className="w-4 h-4" /> Add person</button>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json` — Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/SeriesPeople.tsx
git commit -m "feat(series): People & logistics tab (waves grid, travel, headcount)"
```

---

### Task 7: Budget tab (read-only estimate)

**Files:**
- Modify: `src/components/SeriesBudget.tsx` (replace stub)

**Interfaces:**
- Consumes: `TabProps`; `memberBudgetTotal`, `travelEstimate` from `../lib/campaign`.

- [ ] **Step 1: Implement**

```tsx
import type { TabProps } from "./SeriesDashboard";
import { memberBudgetTotal, travelEstimate } from "../lib/campaign";

const money = (n: number) => "$" + n.toLocaleString();

export function SeriesBudget({ campaign, events, save }: TabProps) {
  const withBudget = events.filter((e) => e.eventBudgetTarget != null);
  const memberTotal = memberBudgetTotal(events);
  const travel = travelEstimate(campaign);

  return (
    <div className="max-w-xl space-y-6">
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-[13px] text-amber-800">
        Estimate only — this never flows into committed spend. Committed budget stays on each event's own budget.
      </div>

      <section className="rounded-xl border border-border divide-y divide-gray-100">
        <div className="px-4 py-2 text-[13px] font-medium text-gray-500">Member event budgets (assigned)</div>
        {events.length === 0 && <div className="px-4 py-3 text-sm text-gray-400">No member events yet.</div>}
        {events.map((e) => (
          <div key={e.id} className="flex items-center justify-between px-4 py-2 text-sm">
            <span className="truncate">{e.name}</span>
            <span className={e.eventBudgetTarget == null ? "text-gray-400" : ""}>{e.eventBudgetTarget == null ? "—" : money(e.eventBudgetTarget)}</span>
          </div>
        ))}
        {withBudget.length > 0 && <div className="flex items-center justify-between px-4 py-2 text-sm font-medium"><span>Subtotal</span><span>{money(memberTotal)}</span></div>}
      </section>

      <section className="rounded-xl border border-border p-4 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm">Per-wave travel rate (per traveler)</span>
          <input type="number" value={campaign.travelRatePerWave ?? ""} onChange={(e) => save({ ...campaign, travelRatePerWave: e.target.value === "" ? null : Number(e.target.value) })} placeholder="—" className="w-28 px-2 py-1 border border-gray-300 rounded text-right text-sm" />
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-500">Travel estimate <span className="text-gray-400">· flyers per wave × rate (locals $0)</span></span>
          <span>{campaign.travelRatePerWave == null ? "—" : money(travel)}</span>
        </div>
      </section>

      <div className="flex items-center justify-between rounded-xl bg-gray-900 text-white px-4 py-3">
        <span className="font-medium">Combined estimate</span>
        <span className="text-lg font-medium">{money(memberTotal + travel)}</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json` — Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/SeriesBudget.tsx
git commit -m "feat(series): Budget tab — read-only estimate (events + travelers×rate)"
```

---

### Task 8: Briefs tab (per-person filtered view)

**Files:**
- Modify: `src/components/SeriesBriefs.tsx` (replace stub)

**Interfaces:**
- Consumes: `TabProps`; `personBrief`, `personLabel`, type `BriefEvent` from `../lib/campaign`.

- [ ] **Step 1: Implement**

```tsx
import { useState } from "react";
import type { TabProps } from "./SeriesDashboard";
import { personBrief, personLabel, type BriefEvent } from "../lib/campaign";

export function SeriesBriefs({ campaign, events, save }: TabProps) {
  const [selected, setSelected] = useState<string | null>(campaign.people[0]?.id ?? null);
  const eventsById: Record<string, BriefEvent> = Object.fromEntries(events.map((e) => [e.id, { id: e.id, name: e.name, date: e.date, location: e.location }]));
  const brief = selected ? personBrief(campaign, selected, eventsById) : null;

  const patchSelected = (patch: { lodging?: string; travelDetail?: string }) => {
    if (!selected) return;
    save({ ...campaign, people: campaign.people.map((p) => (p.id === selected ? { ...p, ...patch } : p)) });
  };
  const copy = () => { if (brief) void navigator.clipboard?.writeText(briefText(brief)).catch(() => {}); };

  if (campaign.people.length === 0) return <p className="text-gray-400">Add people on the People & logistics tab to generate briefs.</p>;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_2fr]">
      <div className="rounded-xl border border-border divide-y divide-gray-100 h-fit">
        {campaign.people.map((p) => (
          <button key={p.id} onClick={() => setSelected(p.id)} className={`block w-full text-left px-3 py-2 text-sm ${selected === p.id ? "bg-gray-100 font-medium" : "hover:bg-gray-50"}`}>{personLabel(p)}</button>
        ))}
      </div>

      {brief && (
        <div className="rounded-xl border border-border p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-medium">{brief.label} — trip brief</h2>
            <button onClick={copy} className="text-sm text-gray-600 hover:text-gray-900 border border-gray-300 rounded-lg px-2.5 py-1">Copy</button>
          </div>
          <p className="text-[13px] text-gray-500 mb-4">{brief.traveling ? "Traveling" : "Local"} · {brief.waves.length} wave{brief.waves.length === 1 ? "" : "s"}</p>

          {brief.waves.length === 0 ? <p className="text-sm text-gray-400">Not assigned to any wave yet.</p> : brief.waves.map(({ wave, events: evs }) => (
            <section key={wave.id} className="mb-4">
              <h3 className="text-sm font-medium">{wave.name} <span className="text-gray-400 font-normal">{wave.start ?? "—"}{wave.end ? ` → ${wave.end}` : ""}</span></h3>
              {evs.length === 0 ? <p className="text-[13px] text-gray-400 pl-2">No events.</p> : (
                <ul className="mt-1 space-y-0.5">
                  {evs.map((e) => <li key={e.id} className="text-sm pl-2"><span className="text-gray-400 text-[12px] mr-2">{e.date ?? "—"}</span>{e.name}{e.location ? <span className="text-gray-400"> · {e.location}</span> : ""}</li>)}
                </ul>
              )}
            </section>
          ))}

          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            <label className="text-[13px] text-gray-500">Lodging
              <input value={brief.person.lodging ?? ""} onChange={(e) => patchSelected({ lodging: e.target.value })} placeholder="to confirm" className="mt-1 w-full px-2 py-1 border border-gray-200 rounded text-sm" />
            </label>
            <label className="text-[13px] text-gray-500">Travel detail
              <input value={brief.person.travelDetail ?? ""} onChange={(e) => patchSelected({ travelDetail: e.target.value })} placeholder="to confirm" className="mt-1 w-full px-2 py-1 border border-gray-200 rounded text-sm" />
            </label>
          </div>
        </div>
      )}
    </div>
  );
}

function briefText(b: ReturnType<typeof personBrief> & object): string {
  const lines = [`${b.label} — trip brief`, `${b.traveling ? "Traveling" : "Local"}`, ""];
  for (const { wave, events } of b.waves) {
    lines.push(`${wave.name} (${wave.start ?? "—"}${wave.end ? ` → ${wave.end}` : ""})`);
    for (const e of events) lines.push(`  - ${e.date ?? "—"}  ${e.name}${e.location ? ` · ${e.location}` : ""}`);
  }
  lines.push("", `Lodging: ${b.lodging}`, `Travel: ${b.travelDetail}`);
  return lines.join("\n");
}
```

Note: `briefText` takes a non-null `PersonBrief`; call site guards with `if (brief)`. If TS complains about the intersection type, change the signature to `briefText(b: PersonBrief)` and `import type { PersonBrief }` from `../lib/campaign`.

- [ ] **Step 2: Typecheck + full test suite**

Run: `npx tsc --noEmit -p tsconfig.json && npx vitest run`
Expected: no type errors; all tests pass (incl. Task 1's `campaign.test.ts`).

- [ ] **Step 3: Commit**

```bash
git add src/components/SeriesBriefs.tsx
git commit -m "feat(series): Briefs tab — per-person filtered trip brief + copy"
```

---

## Self-Review

**Spec coverage:**
- Reuse `event_series` + `extras.campaign`, no migration → Tasks 1–2 ✓
- Nav: People+Vendors → Contacts; add Series → Tasks 3–4 ✓
- Plan tab (waves, member events, set/pending/anchor, link to instance, assign) → Task 5 ✓
- People & logistics (people×waves, flying/local, add profile or free-text+email, peak headcount, traveling/local, no costs) → Task 6 ✓
- Budget (read-only member sum + travelers×rate per wave, locals $0, ESTIMATE label, never committed) → Task 7 ✓
- Briefs (per-person waves+dates, events in waves / tagged, lodging+travel "to confirm", export/copy, excludes budget/vendors/others) → Task 8 ✓
- Invariants (people≠budget, distinct headcount, per-wave travel, nothing invented, empty states) → Task 1 tests + tabs ✓
- Convergence: brief is a standalone `personBrief` function, audience-extensible; attendee side not built ✓
- People model (profile OR free-text+email) → Task 1 type + Task 6 add flows ✓

**Placeholder scan:** none — every step has real code/commands. (Stubs in Tasks 4–5 are explicit, replaced by later tasks; noted as such.)

**Type consistency:** `Campaign`/`Wave`/`CampaignPerson` defined in Task 1, imported everywhere; `TabProps` defined in Task 5 (SeriesDashboard) and consumed by Tasks 5–8; `SeriesEvent` (Task 2) used by dashboard/tabs; `personBrief`/`BriefEvent`/`PersonBrief` consistent between Task 1 and Task 8; db helper names (`getSeriesCampaign`, `saveCampaign`, `setEventSeries`, `listSeries`, `createSeries`) consistent across Tasks 2/4/5.

**Deploy parity:** frontend + `db.ts` only (campaign in `extras` on the already-granted `event_series` table). No migration, no cloud function. Ships via the SPA build on push. `setEventSeries` (assigning an event to a series) is done from an event's page today or can be added later — the Plan tab surfaces already-linked members and their wave assignment.
