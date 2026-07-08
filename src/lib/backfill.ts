// Backfill a past event by dropping its debrief/brief. Pure logic: classify + match templates,
// and a category-scoped completeness check. The DB/UI wiring lives in db.ts / BackfillModal.tsx.
import { eventFocus, type EventFocus } from "./eventFocus";
import { newPhasesByRole, nearDuplicate } from "./phaseMerge";

// The merged shape pulled from a dropped brief (structure/pattern) + debrief (outcome/actuals).
export interface BackfillExtract {
  name: string;
  date: string | null;
  location: string | null;
  format: string | null;
  tag: string | null;
  headcount: number | null;      // expected (from a brief)
  turnoutActual: number | null;  // who actually showed (from a debrief)
  budgetTotal: number | null;
  verdict: string;
  phases: string[];
  staffRoles: string[];
  lessons: string[];
  heuristics: string[];
  actuals: { line: string; amount: number | null }[];
  // Deliverables carry their PHASE (assigned by function) and, when generalized for a template,
  // the pre-strip `original` text. Kept richer than a bare title so the phase survives to creation.
  deliverables: { title: string; phase: string; original?: string }[];
  droppedForTemplate?: { title: string; reason: string }[]; // template mode: too event-specific to keep
  agenda: { time: string; title: string }[]; // run-of-show rows from a brief, if any
}

// ── Completeness: the few load-bearing fields that separate "a record" from "a stub" ──
export type SignificantField = "date" | "budget" | "turnout" | "outcome";
const FIELD_LABEL: Record<SignificantField, string> = {
  date: "Event date",
  budget: "Budget / actuals",
  turnout: "Turnout (RSVPs / checked-in)",
  outcome: "Outcome / verdict",
};
// Category-scoped: a community run club isn't incomplete for lacking a budget; an unclear type
// is judged thinly until it's classified. The template can flag subtler gaps as it matures.
const BY_CATEGORY: Record<EventFocus, SignificantField[]> = {
  hiring: ["date", "budget", "turnout", "outcome"],
  client: ["date", "budget", "turnout", "outcome"],
  neither: ["date", "turnout", "outcome"], // community/internal — budget often ~$0, not load-bearing
};

export interface Gap { field: SignificantField; label: string }
export function completenessGaps(x: BackfillExtract): { category: EventFocus; gaps: Gap[] } {
  const category = eventFocus(x.tag ? [x.tag] : [], x.format);
  const has: Record<SignificantField, boolean> = {
    date: !!x.date,
    budget: x.budgetTotal != null || x.actuals.some((a) => a.amount != null),
    turnout: x.turnoutActual != null || x.headcount != null,
    outcome: !!x.verdict.trim(),
  };
  const gaps = BY_CATEGORY[category].filter((f) => !has[f]).map((f) => ({ field: f, label: FIELD_LABEL[f] }));
  return { category, gaps };
}

// ── Template matching: classify the dropped event, find existing templates of that type ──
export interface TemplateLite {
  id: string; name: string; format: string | null; tags: string[];
  phases: string[]; staffRoles: string[]; reflections: string[];
}
export interface TemplateMatch { template: TemplateLite; score: number }

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();
export function matchTemplates(templates: TemplateLite[], q: { format: string | null; tag: string | null }): TemplateMatch[] {
  const fmt = norm(q.format), tag = norm(q.tag);
  return templates
    .map((t) => {
      let score = 0;
      const tf = norm(t.format);
      if (fmt && tf === fmt) score += 3;
      else if (fmt && tf && (tf.includes(fmt) || fmt.includes(tf))) score += 2;
      if (tag && t.tags.some((x) => norm(x) === tag)) score += 2;
      if (fmt && norm(t.name).includes(fmt)) score += 1;
      return { template: t, score };
    })
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score);
}

// A template is name-FREE: a staff role names a function, not a person. Recognize a personal name
// so it can be stripped ("Sasha (fireside kick-off)" → "fireside kick-off", "Cathy — Host" → "Host").
// Stems (leading word-boundary, inflection-tolerant so "Photographer"/"Coordinator" match), plus a
// short list of abbreviations that need an exact boundary (so they don't fire inside a name).
const ROLE_STEM = /\b(photograph|videograph|coordinat|registrat|organiz|facilitat|moderat|produc|direct|assist|greet|runner|panel|volunteer|bartend|usher|host|lead|manag|emcee|owner|staff|sound|security|cater|logistic|marketing|design|content|social|comm|booth|badge|setup|teardown|welcome|clos|check|kick|speak|support|door)/i;
const ROLE_ABBR = /\b(mc|av|ops|reg|tech|desk|hr|pr|it)\b/i;
function looksLikePerson(s: string): boolean {
  if (!s || ROLE_STEM.test(s) || ROLE_ABBR.test(s)) return false;
  const tokens = s.trim().split(/\s+/);
  return tokens.length <= 3 && tokens.every((t) => /^[A-Z][A-Za-z'’.-]*$/.test(t));
}
// Return a name-free GENERAL role, or null to omit it entirely. Only strips when the lead token(s)
// clearly look like a person and the remainder like a role — otherwise keeps the value untouched
// (never silently drops a legitimate single-word role).
export function generalizeStaffRole(role: string): string | null {
  const s = (role ?? "").replace(/\s+/g, " ").trim();
  if (!s) return null;
  const paren = s.match(/^(.*?)\s*\(([^)]+)\)\s*$/); // "Name (general role)"
  if (paren && paren[2].trim() && looksLikePerson(paren[1].trim())) return paren[2].trim();
  const sep = s.match(/^(.+?)\s+[:–—-]\s+(.+)$/); // "Name — role" / "Name: role" (spaced separator)
  if (sep && looksLikePerson(sep[1].trim()) && !looksLikePerson(sep[2].trim())) return sep[2].trim();
  return s;
}

// What the dropped event GENUINELY adds to the matched template → propose ADDING (one-directional).
// Phases align by ROLE (never a duplicate role); lessons use near-duplicate detection, not string
// equality; roles dedupe by name. Skipped duplicates are never surfaced as additions.
export interface TemplateAdditions { phases: string[]; roles: string[]; lessons: string[] }
export function templateAdditions(t: TemplateLite, x: BackfillExtract): TemplateAdditions {
  // Generalize BOTH sides so names never enter or re-suggest (dedup on the general form).
  const tr = new Set(t.staffRoles.map((r) => generalizeStaffRole(r)).filter(Boolean).map((r) => norm(r as string)));
  // Phases: only roles the template doesn't already cover (Run of show ≈ Run → reconciled, not added).
  const phases = newPhasesByRole(t.phases.map((n) => ({ name: n })), x.phases);
  // Staff roles: strip personal names, then name-dedup on the general role.
  const roles: string[] = []; const seenR = new Set<string>();
  for (const raw of x.staffRoles) { const r = generalizeStaffRole(raw); if (!r) continue; const k = norm(r); if (!tr.has(k) && !seenR.has(k)) { roles.push(r); seenR.add(k); } }
  // Lessons/heuristics: skip anything semantically near a template lesson OR an already-kept one.
  const lessons: string[] = [];
  for (const l of [...x.lessons, ...x.heuristics]) {
    if (!l) continue;
    if (t.reflections.some((tl) => nearDuplicate(tl, l))) continue;
    if (lessons.some((kept) => nearDuplicate(kept, l))) continue;
    lessons.push(l);
  }
  return { phases, roles, lessons };
}
export const hasAdditions = (a: TemplateAdditions) => a.phases.length + a.roles.length + a.lessons.length > 0;

// Cheap client-side signal that a dropped doc is a PAST event (a backfill), not a forward brief.
// Used only to PROMPT the user (past vs in-process). Keyword hits alone are noisy — a forward brief
// often has an agenda line like "Wrap-up" or "post-event survey" — so an explicit FUTURE date in the
// doc overrides them: a future date means it's a plan, not a recap.
const PAST_SIGNALS = /\b(debrief|recap|retro(spective)?|post[- ]?mortem|post[- ]?event|wrap[- ]?up|turnout (was|came)|showed up|attendance was|lessons learned|what (went|worked)|already happened|last (week|month|quarter|year))\b/i;

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

// Pull candidate calendar dates out of free text. Handles ISO (2026-08-08), month-name
// ("August 8", "Aug 8, 2026", "8 August 2026", ordinal-tolerant), and US numeric (8/8/2026, 8/8/26).
// When a year is absent we assume the current one — deliberately NOT rolling forward, so a bare
// "August 8" only counts as future when this year's occurrence hasn't passed yet.
function extractDates(text: string, now: Date): Date[] {
  const out: Date[] = [];
  const curYear = now.getFullYear();
  const push = (y: number, mo: number, d: number) => {
    if (mo < 0 || mo > 11 || d < 1 || d > 31) return;
    out.push(new Date(y, mo, d));
  };
  const mo3 = (s: string) => MONTHS[s.toLowerCase().slice(0, 3)];

  for (const m of text.matchAll(/\b(\d{4})[-/](\d{1,2})[-/](\d{1,2})\b/g))
    push(Number(m[1]), Number(m[2]) - 1, Number(m[3]));

  for (const m of text.matchAll(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(\d{4}))?\b/gi))
    push(m[3] ? Number(m[3]) : curYear, mo3(m[1]), Number(m[2]));

  for (const m of text.matchAll(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?(?:,?\s*(\d{4}))?\b/gi))
    push(m[3] ? Number(m[3]) : curYear, mo3(m[2]), Number(m[1]));

  for (const m of text.matchAll(/\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/g)) {
    const y = Number(m[3]);
    push(y < 100 ? 2000 + y : y, Number(m[1]) - 1, Number(m[2]));
  }
  return out;
}

export function looksLikeBackfill(text: string, now: Date = new Date()): boolean {
  if (!text) return false;
  // A future (or today) date wins: this is a plan, not a backfill — regardless of stray keywords.
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (extractDates(text, now).some((d) => d.getTime() >= startOfToday)) return false;
  return PAST_SIGNALS.test(text);
}
