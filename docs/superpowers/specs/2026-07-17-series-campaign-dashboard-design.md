# Series / Campaign Dashboard — design

**Status:** Approved design (2026-07-17)
**Driver:** the 3-week Toronto campus activation (a multi-week, multi-event recruiting campaign).
**Scope:** a planning workspace for a series of events, reusing the existing `event_series` primitive.
Four separate concerns as four tabs: **plan** the events, coordinate **people & logistics**, roll up
a **budget** estimate, and generate per-person **briefs**. Plus a small nav reorganization to make
room for it.

## Goals

- Group a campaign's member events under **waves** (the series' own phases) and see the whole arc.
- Coordinate **who goes when** (people × waves + flying/local) with no cost bleed.
- Show a **read-only budget estimate** (member-event budgets + travel) that never touches committed spend.
- Generate a **per-person trip brief** (their waves/dates, their events, lodging/travel) — a filtered
  view, nothing invented.
- No schema migration: store the campaign structure in `event_series.extras`.

## Non-goals (deferred — per the brief)

Fan/stack list UI, spanning-timeline visualization, the drive scoreboard's live recruiting KPIs
(needs Greenhouse — separate ticket), per-person **actual** travel costs, custom scoreboard headers,
the culture/client drives fully built, and the attendee-briefing audience (OLI-35) — see Convergence.

## Context (current state)

- `event_series` (table): `id, name, office, owning_team, type, start_date, end_date, status, verdict,
  ongoing_motion, gaps, extras (jsonb), created_at`. **No** drive/waves/people/travel. Events link to
  a series via `event.series_id`.
- **No series UI exists** — this is a net-new dashboard + entry point.
- **No per-person/attendee brief generator exists** — the staff brief here is the first one.
- Nav today: Home · Events · People · Vendors · Budget · Calendar.

## Data model — `event_series.extras.campaign` (jsonb, no migration)

Membership stays authoritative on `event.series_id`. Everything else lives in `extras.campaign`:

```ts
interface Campaign {
  drive: 'recruiting' | 'culture' | 'client';   // scoreboard framing; Toronto = 'recruiting'
  travelRatePerWave: number | null;             // per-traveler, per-wave estimate rate
  waves: Wave[];
  people: CampaignPerson[];
}
interface Wave { id: string; name: string; start: string | null; end: string | null; eventIds: string[]; }
interface CampaignPerson {
  id: string;                        // stable local id
  profileId?: string | null;         // linked account, OR:
  name?: string; email?: string;     // free-text person (optional @instalily.ai email — no notify now)
  waveIds: string[];                 // waves this person is on
  travel: 'flying' | 'local';        // per person; 'local' ⇒ $0 travel
  lodging?: string | null;           // typed once; "to confirm" when unset
  travelDetail?: string | null;      // typed once; "to confirm" when unset
  eventIds?: string[];               // OPTIONAL: specific events they're tagged to attend (else all
                                     // events in their waves)
}
```

- An event's wave = the wave whose `eventIds` contains it (an event without a wave is "pending"). A
  multi-part event (the hackathon) may appear in more than one wave's `eventIds` — one event, not split.
- A person is **linked** (`profileId`) or **free-text** (`name` + optional `email`). Both allowed so
  someone can be added before they have an account.

`db.ts` helpers (all via PostgREST as the authenticated role, patching `extras`):
- `listSeries(): SeriesListItem[]` — series + member counts.
- `createSeries({ name, drive }): id`.
- `getSeries(id): { …event_series row, campaign: Campaign, events: EventListItem[] }` (events via `series_id`).
- `saveCampaign(id, campaign: Campaign)` — read-modify-write of `extras.campaign`.
- `setEventSeries(eventId, seriesId | null)` — add/remove a member event.

## Navigation change

- **Merge People + Vendors → one `Contacts` tab** with two sub-views (People, Vendors) using the
  existing `PeoplePage` and `VendorsPage` unchanged — a `ContactsPage` wrapper with a segmented
  toggle. The two nav tabs are replaced by the single `Contacts` tab.
- **Add a `Series` tab.** New top nav: **Home · Events · Contacts · Series · Budget · Calendar**.
- `Series` tab → `SeriesListPage` (list + "New series") → selecting one opens `SeriesDashboard`.
  Routing follows the existing `activePage` state pattern in `App.tsx` (add `'contacts'` and
  `'series'`; drop `'people'`/`'vendors'` from the top nav — `PeoplePage` is still reachable
  scoped-to-an-event as today).

## The four tabs (`SeriesDashboard`)

### 1. Plan (default / hero)
Waves in order; under each, its member events with a status chip — **set** (assigned to a wave &
has a date), **pending** (member event not yet in a wave), **anchor** (the hackathon; visually
distinct, e.g. a ring/badge). Each event row links to its own planning page. Controls: create/edit
waves (name + dates), and assign a member event to a wave (and add existing events to the series).

### 2. People & logistics
A people × waves grid: rows = people, columns = waves, a cell toggles whether the person is on that
wave; a per-person **travel** toggle (flying / local). Add a person (pick a profile OR type
name + optional @instalily.ai email). Header stats: **peak headcount** (max distinct people on any
single wave) and **traveling vs local** (distinct-people counts). **No costs on this tab.**

### 3. Budget (one read-only panel)
- **Member-event budgets:** sum of each member event's *assigned* budget target (read-only; the
  series never edits member money). Events without a budget show "—".
- **Travel estimate:** `Σ over waves ( (# people on that wave with travel === 'flying') × travelRatePerWave )`.
  Locals add $0. Editable field: `travelRatePerWave`.
- **Combined = member budgets + travel estimate**, labeled **ESTIMATE**. It does **not** flow into
  committed spend — committed budget stays on the normal per-event assigned-first path. Travel is
  shown as a clearly separate line.

### 4. Briefs (per person)
Pick a person → a filtered trip brief generated from campaign data:
- **When they should be there:** the date range(s) of their assigned waves.
- **Their schedule:** the events in their waves (or, if `eventIds` is set, exactly those) — title,
  date, location, linking to the instance.
- **Lodging + travel:** their `lodging` / `travelDetail`, shown as "to confirm" when unset (never
  invented).
Exportable/shareable (copy / print-friendly view). **Excludes** budget, vendors, and other people's
logistics — only this person's need-to-know.

## Key rules / invariants

- **People-planning ≠ budget.** Assigning a person to a wave does **not** charge travel; the traveler
  count (flying flag) is independent input. (A future "pre-fill travelers from assignment" is a
  nicety, not the model.)
- **Travel is an estimate**, labeled, separate from committed spend.
- **Combined budget = read-only sum**; the series doesn't own/edit member-event money.
- **Distinct-people headcount** (someone on two waves counts once); **travel cost is per-wave**
  (charged for each wave they fly in for). Don't conflate the two.
- **Briefs are filtered views** from real campaign data; unset lodging/travel → "to confirm."
- **Empty/early states:** unstaffed waves → "not yet staffed"; events without budgets → "—". No 0s
  or errors.

## Convergence (staff brief vs attendee briefing / OLI-35)

The per-person staff trip brief and the future attendee briefing are the same mechanism (a
role-filtered, need-to-know doc from event data) for different audiences. Build the brief here as a
**standalone per-person filtered-view function** shaped so an `audience` parameter can be added later
— but do **not** build the attendee side now (OLI-35 is a separate ticket).

## Components / files

- Create: `src/components/SeriesListPage.tsx` (list + create), `src/components/SeriesDashboard.tsx`
  (tab shell), and per-tab pieces `SeriesPlan.tsx`, `SeriesPeople.tsx`, `SeriesBudget.tsx`,
  `SeriesBriefs.tsx` (kept small/focused), plus `src/lib/campaignBrief.ts` (pure per-person brief
  builder).
- Create: `src/components/ContactsPage.tsx` (segmented People/Vendors wrapper).
- Modify: `src/App.tsx` (nav: drop People/Vendors top tabs, add Contacts + Series; route them),
  `src/lib/db.ts` (series/campaign helpers + `Campaign` types).

## Testing

- **Pure logic** (`src/lib/campaignBrief.ts` + budget/headcount math), unit-tested with the existing
  vitest: per-person brief filtering (waves → dates, events in waves, tagged events, "to confirm"
  fallbacks); travel estimate (`travelers × rate`, locals $0, per-wave); distinct-people headcount
  (someone on two waves counts once); combined = member budgets + travel; empty-state values.
- Frontend wiring verified by `tsc` + manual (no component-test infra in the repo).

## Deploy parity

Frontend + `db.ts` only (campaign data via PostgREST as `authenticated`; `extras` is on the already-
granted `event_series` table). No cloud-function or migration. Ships via the SPA build on push.
