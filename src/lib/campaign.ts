// Campaign structure stored in event_series.extras.campaign, plus pure derivations used by the
// dashboard tabs and briefs. No DB access here — all functions take data and return values.
export type Drive = "recruiting" | "culture" | "client";

export interface Wave { id: string; name: string; start: string | null; end: string | null; eventIds: string[]; }

// Per-wave color, assigned by wave ORDER and reused everywhere a wave appears (Plan, People, Briefs,
// presence viz) so a wave reads the same across the whole dashboard. Light versions of the general
// site palette; cycles if there are more waves than colors. Full literal classes for Tailwind's scan.
export interface WaveColor { name: string; dot: string; strong: string; soft: string; bg: string; border: string; text: string; ring: string; }
export const WAVE_COLORS: WaveColor[] = [
  { name: "green",  dot: "bg-green-400",  strong: "bg-green-600",  soft: "bg-green-200",  bg: "bg-green-50",  border: "border-green-200",  text: "text-green-700",  ring: "ring-green-300" },
  { name: "yellow", dot: "bg-amber-400",  strong: "bg-amber-600",  soft: "bg-amber-200",  bg: "bg-amber-50",  border: "border-amber-200",  text: "text-amber-700",  ring: "ring-amber-300" },
  { name: "purple", dot: "bg-purple-400", strong: "bg-purple-600", soft: "bg-purple-200", bg: "bg-purple-50", border: "border-purple-200", text: "text-purple-700", ring: "ring-purple-300" },
  { name: "blue",   dot: "bg-blue-400",   strong: "bg-blue-600",   soft: "bg-blue-200",   bg: "bg-blue-50",   border: "border-blue-200",   text: "text-blue-700",   ring: "ring-blue-300" },
  { name: "pink",   dot: "bg-pink-400",   strong: "bg-pink-600",   soft: "bg-pink-200",   bg: "bg-pink-50",   border: "border-pink-200",   text: "text-pink-700",   ring: "ring-pink-300" },
  { name: "teal",   dot: "bg-teal-400",   strong: "bg-teal-600",   soft: "bg-teal-200",   bg: "bg-teal-50",   border: "border-teal-200",   text: "text-teal-700",   ring: "ring-teal-300" },
  { name: "orange", dot: "bg-orange-400", strong: "bg-orange-600", soft: "bg-orange-200", bg: "bg-orange-50", border: "border-orange-200", text: "text-orange-700", ring: "ring-orange-300" },
];
export const waveColor = (index: number): WaveColor => WAVE_COLORS[((index % WAVE_COLORS.length) + WAVE_COLORS.length) % WAVE_COLORS.length];
export const waveColorById = (waves: { id: string }[], waveId: string): WaveColor => waveColor(Math.max(0, waves.findIndex((w) => w.id === waveId)));
export type CrewRole = "eng" | "biz" | "leadership" | "none"; // drives hue; "none" = unspecified
export type CrewStatus = "confirmed" | "proposed";            // drives shade
export const CREW_ROLES: CrewRole[] = ["eng", "biz", "leadership", "none"];
export const ROLE_LABEL: Record<CrewRole, string> = { eng: "Eng", biz: "Biz", leadership: "Leadership", none: "Unspecified" };
// Presence span WITHIN a wave (defaults to the full wave when absent → enables the step-down).
export type PresenceSpan = { from?: string | null; to?: string | null };
export interface CampaignPerson {
  id: string;
  profileId?: string | null;   // linked account, OR:
  name?: string; email?: string; // free-text person (email optional, @instalily.ai)
  waveIds: string[];
  travel: "flying" | "local";
  lodging?: string | null;
  travelDetail?: string | null;
  eventIds?: string[];         // optional: specific events attended (else all events in their waves)
  // Wave-presence encoding (all optional; default eng / proposed / full-wave):
  role?: CrewRole;              // person-level (a person is one role)
  status?: CrewStatus;         // person-level fallback (per-wave override in statusByWave)
  spans?: Record<string, PresenceSpan>;         // per-wave presence span (waveId → {from,to})
  statusByWave?: Record<string, CrewStatus>;    // per-wave confirmed/proposed override
  travelByWave?: Record<string, "flying" | "local">; // per-wave travel (fly for one wave, local for another)
  plannedCount?: number | null; // anonymous headcount: bodies-without-names ("N planned")
}
export interface Campaign {
  drive: Drive;
  travelRatePerWave: number | null;
  accommodationRatePerNight: number | null; // lodging cost per person per night
  waves: Wave[];
  people: CampaignPerson[];
  anchorEventIds: string[];
}

export const emptyCampaign = (): Campaign => ({ drive: "recruiting", travelRatePerWave: null, accommodationRatePerNight: null, waves: [], people: [], anchorEventIds: [] });

// Coerce a possibly-partial jsonb blob into a well-formed Campaign (older/absent fields default).
export function normalizeCampaign(raw: any): Campaign {
  const c = raw && typeof raw === "object" ? raw : {};
  return {
    drive: (["recruiting", "culture", "client"].includes(c.drive) ? c.drive : "recruiting") as Drive,
    travelRatePerWave: typeof c.travelRatePerWave === "number" ? c.travelRatePerWave : null,
    accommodationRatePerNight: typeof c.accommodationRatePerNight === "number" ? c.accommodationRatePerNight : null,
    waves: Array.isArray(c.waves) ? c.waves.map((w: any) => ({ id: String(w.id), name: w.name ?? "", start: w.start ?? null, end: w.end ?? null, eventIds: Array.isArray(w.eventIds) ? w.eventIds : [] })) : [],
    people: Array.isArray(c.people) ? c.people.map((p: any) => ({ id: String(p.id), profileId: p.profileId ?? null, name: p.name, email: p.email, waveIds: Array.isArray(p.waveIds) ? p.waveIds : [], travel: p.travel === "local" ? "local" : "flying", lodging: p.lodging ?? null, travelDetail: p.travelDetail ?? null, eventIds: Array.isArray(p.eventIds) ? p.eventIds : undefined, role: CREW_ROLES.includes(p.role) ? p.role : "eng", status: p.status === "proposed" ? "proposed" : "confirmed", spans: p.spans && typeof p.spans === "object" ? p.spans : undefined, statusByWave: p.statusByWave && typeof p.statusByWave === "object" ? p.statusByWave : undefined, travelByWave: p.travelByWave && typeof p.travelByWave === "object" ? p.travelByWave : undefined, plannedCount: typeof p.plannedCount === "number" ? p.plannedCount : null })) : [],
    anchorEventIds: Array.isArray(c.anchorEventIds) ? c.anchorEventIds : [],
  };
}

export function personLabel(p: CampaignPerson): string {
  return (p.name && p.name.trim()) || p.email || (p.profileId ? "Teammate" : "Unknown");
}

// ── Wave presence (stepped headcount over time) ──────────────────────────────
// Pure derivations for the wave-presence visualization. All read the existing campaign data plus the
// optional role/status/span fields; nothing here touches the DB.
export const crewRole = (p: CampaignPerson): CrewRole => (p.role && CREW_ROLES.includes(p.role) ? p.role : "eng");
export const crewStatus = (p: CampaignPerson): CrewStatus => (p.status === "proposed" ? "proposed" : "confirmed");
export const bodyCount = (p: CampaignPerson): number => (p.plannedCount && p.plannedCount > 0 ? p.plannedCount : 1);
export const isAnonymous = (p: CampaignPerson): boolean => !p.profileId && !(p.name && p.name.trim()) && !p.email;
// Per-wave status / travel (fall back to the person-level value, then the defaults).
export const waveStatus = (p: CampaignPerson, waveId: string): CrewStatus => p.statusByWave?.[waveId] ?? crewStatus(p);
export const waveTravel = (p: CampaignPerson, waveId: string): "flying" | "local" => p.travelByWave?.[waveId] ?? (p.travel === "local" ? "local" : "flying");
// A person's span within a wave is "partial" when it's narrower than the wave's own bounds.
export function isPartialInWave(p: CampaignPerson, wave: Wave): boolean {
  const s = p.spans?.[wave.id];
  if (!s || !wave.start || !wave.end) return false;
  const from = s.from && s.from > wave.start ? s.from : wave.start;
  const to = s.to && s.to < wave.end ? s.to : wave.end;
  return from > wave.start || to < wave.end;
}

// Inclusive list of YYYY-MM-DD days from start to end (empty if either missing or end < start).
export function eachDay(start: string | null, end: string | null): string[] {
  if (!start || !end || end < start) return start && !end ? [start] : [];
  const out: string[] = [];
  const d = new Date(start + "T12:00:00");
  const last = new Date(end + "T12:00:00");
  while (d <= last) { out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`); d.setDate(d.getDate() + 1); }
  return out;
}

// A person's presence span within a wave, clamped to the wave's own bounds. Defaults to the full wave.
export function spanInWave(p: CampaignPerson, wave: Wave): { from: string; to: string } | null {
  if (!wave.start || !wave.end) return null;
  const s = p.spans?.[wave.id];
  const from = s?.from && s.from > wave.start ? s.from : wave.start;
  const to = s?.to && s.to < wave.end ? s.to : wave.end;
  if (to < from) return null;
  return { from, to };
}

export type StackKey = `${CrewRole}-${CrewStatus}`;
// Stack order bottom→top: all confirmed (the locked floor), then all proposed on top.
export const STACK_KEYS: StackKey[] = [
  ...CREW_ROLES.map((r) => `${r}-confirmed` as StackKey),
  ...CREW_ROLES.map((r) => `${r}-proposed` as StackKey),
];
export type DayColumn = Record<StackKey, number>;
const emptyColumn = (): DayColumn => Object.fromEntries(STACK_KEYS.map((k) => [k, 0])) as DayColumn;

// The people (or anonymous bodies) present on a given day of a wave — for the hover tooltip.
export interface DaySlicePerson { key: StackKey; role: CrewRole; status: CrewStatus; label: string; count: number; anon: boolean; }
export function daySlice(wave: Wave, people: CampaignPerson[], day: string): DaySlicePerson[] {
  const out: DaySlicePerson[] = [];
  for (const p of people) {
    if (!p.waveIds.includes(wave.id)) continue;
    const span = spanInWave(p, wave);
    if (!span || day < span.from || day > span.to) continue;
    const role = crewRole(p), status = waveStatus(p, wave.id), anon = isAnonymous(p);
    out.push({ key: `${role}-${status}` as StackKey, role, status, count: bodyCount(p), anon, label: anon ? `${bodyCount(p)} planned` : personLabel(p) });
  }
  // Order for the tooltip: confirmed before proposed, eng before biz.
  return out.sort((a, b) => STACK_KEYS.indexOf(a.key) - STACK_KEYS.indexOf(b.key));
}

// The stepped profile: for each day of the wave, the count per {role × status}.
export function wavePresence(wave: Wave, people: CampaignPerson[]): { days: string[]; columns: DayColumn[]; peak: number } {
  const days = eachDay(wave.start, wave.end);
  const columns = days.map((day) => {
    const col = emptyColumn();
    for (const s of daySlice(wave, people, day)) col[s.key] += s.count;
    return col;
  });
  const peak = columns.reduce((m, c) => Math.max(m, STACK_KEYS.reduce((s, k) => s + c[k], 0)), 0);
  return { days, columns, peak };
}

// Wave duration in days (min 1) — drives band width. Undated waves → 0 (rendered as a bare band).
export function waveDurationDays(w: Wave): number {
  const days = eachDay(w.start, w.end);
  return days.length;
}

// Effective wave bounds: use the wave's own start/end when set; otherwise fall back to the span of its
// events (first event date → last). So adding events before setting a length still gives a real band.
export function waveBounds(wave: Wave, eventDates: Record<string, string | null>): { start: string | null; end: string | null } {
  const dates = wave.eventIds.map((id) => eventDates[id]).filter((d): d is string => !!d).sort();
  return { start: wave.start ?? dates[0] ?? null, end: wave.end ?? dates[dates.length - 1] ?? null };
}

// Peak headcount = the most bodies present on ANY single day across the waves — computed from presence
// spans (someone present only 2 of 4 days doesn't inflate the peak on days they're absent).
export function campaignPeak(c: Campaign, eventDates: Record<string, string | null> = {}): number {
  return c.waves.reduce((max, w) => {
    const b = waveBounds(w, eventDates);
    return Math.max(max, wavePresence({ ...w, start: b.start, end: b.end }, c.people).peak);
  }, 0);
}

// Traveling / local counts by DISTINCT people, from the per-wave travel flag: a person counts as
// "traveling" if they fly for any wave they're on, else "local".
export function crewTravelCounts(c: Campaign): { traveling: number; local: number } {
  let traveling = 0;
  for (const p of c.people) {
    const flies = p.waveIds.some((wid) => waveTravel(p, wid) === "flying");
    if (flies) traveling++;
  }
  return { traveling, local: c.people.length - traveling };
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

// Estimated nights one person stays: for each wave they FLY to, the nights of their presence span
// (span days − 1; a single-day presence is a day trip = 0 nights). Locals never need lodging.
export function personNights(c: Campaign, person: CampaignPerson, eventDates: Record<string, string | null> = {}): number {
  let nights = 0;
  for (const wid of person.waveIds) {
    if (waveTravel(person, wid) !== "flying") continue;
    const w = c.waves.find((x) => x.id === wid);
    if (!w) continue;
    const b = waveBounds(w, eventDates);
    const span = spanInWave(person, { ...w, start: b.start, end: b.end });
    if (!span) continue;
    nights += Math.max(0, eachDay(span.from, span.to).length - 1);
  }
  return nights;
}

// Accommodation estimate: total traveler-nights across everyone × the per-night rate.
export function accommodationEstimate(c: Campaign, eventDates: Record<string, string | null> = {}): { nights: number; cost: number } {
  const rate = c.accommodationRatePerNight ?? 0;
  const nights = c.people.reduce((s, p) => s + personNights(c, p, eventDates), 0);
  return { nights, cost: nights * rate };
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
