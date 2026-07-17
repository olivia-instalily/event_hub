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
