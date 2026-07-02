import { Bookmark, Calendar, CalendarDays, MapPin, LayoutGrid, List, Plus, ChevronDown, ChevronLeft, ChevronRight, Link2, X, Search, Trash2, Check, AlertCircle, ArrowRight, Sparkles, BadgeCheck } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { EventDetailPage } from "./EventDetailPage";
import { listEvents, attachLuma, updateEventTags, setEventFormat, listFormats, generateTemplate, extractBrief, createPlanningEvent, backfillEvent, deleteEvent, getEventPlanning, updateEventCover, addBudgetLines, listProfiles, addEventOwner, setHeadcount, saveSetupState, uploadAttachment, uploadDocument, addAttendee, addDeliverable, spinUpFromTemplate, updateEvent, setEventDate, setEventStaffRoles, setEventReflections, setEventAgenda, setEventPattern, type EventListItem, type EventStatus, type GeneratedTemplate, type ExtractedBrief, type WalkStep, type OutreachTemplate, type EventPlanning, setEventMaterials, type SourceMaterial } from "../lib/db";
import { TagStack } from "./TagStack";
import { FormatPicker, parseFormats, joinFormats } from "./FormatPicker";
import { LocationInput } from "./LocationEdit";
import { canonicalCity } from "../lib/cities";
import { EventPlanningPage } from "./EventPlanningPage";
import { PhaseRail, PHASE_COLORS } from "./TemplateView";
import { ConfirmModal } from "./Modal";
import { BackfillModal } from "./BackfillModal";
import { TAG_CATEGORIES, tagColor, tagBadgeVariant } from "../lib/tags";
import { emptyScoping, saveScoping, loadScoping } from "../lib/scoping";
import { matchFormat } from "../lib/formats";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@instalily/ui/select";
import { Badge } from "@instalily/ui/badge";
import { Button } from "@instalily/ui/button";
import { Input } from "@instalily/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@instalily/ui/table";
import { parseBudgetText } from "./BudgetImport";
import { filesFromDrop } from "../lib/drop";

const NOT_CAPTURED = "Not captured";

// Solo "Just us" events get tagged by audience: internal events draw from the
// Internal taxonomy category, external from the Hosted one.
const INTERNAL_TAGS = TAG_CATEGORIES.find((c) => c.name === "Internal")?.tags ?? [];
const EXTERNAL_TAGS = TAG_CATEGORIES.find((c) => c.name === "Hosted")?.tags ?? [];

// ── Event-brief (markdown/text) parsing ───────────────────────────────────────
const titleCase = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());
// Known formats, priority order. "networking"/"reception" are venues for mingling, not the
// headline format, so they're excluded — a fireside + networking reception is a "Fireside".
const FORMAT_KEYWORDS = ["fireside chat", "fireside", "happy hour", "dinner", "breakfast", "lunch", "summit", "hackathon", "workshop", "panel", "roundtable", "conference", "meetup", "demo day", "open house", "launch party", "launch", "retreat", "offsite", "mixer", "webinar"];
function detectFormatKeyword(s: string): string | null {
  const t = s.toLowerCase();
  for (const kw of FORMAT_KEYWORDS) if (t.includes(kw)) return titleCase(kw);
  return null;
}
function to24(h: string, mi: string | undefined, ap: string | undefined): string {
  let hr = Number(h) % 12;
  if ((ap ?? "").toLowerCase() === "pm") hr += 12;
  return `${String(hr).padStart(2, "0")}:${(mi ?? "00").padStart(2, "0")}`;
}
function parseTimeRange(s: string): { start: string | null; end: string | null } | null {
  const r = s.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:–|—|-|to)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
  if (r) {
    const endAp = r[6].toLowerCase();
    const startAp = (r[3] ?? endAp).toLowerCase(); // bare start time inherits the end's meridiem
    return { start: to24(r[1], r[2], startAp), end: to24(r[4], r[5], endAp) };
  }
  const one = s.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
  return one ? { start: to24(one[1], one[2], one[3]), end: null } : null;
}
function parseBudgetAmount(text: string): number | null {
  const m = text.match(/\$\s?([\d,]+(?:\.\d+)?)\s*(k|thousand|m|million)?/i);
  if (!m) return null;
  let n = Number(m[1].replace(/,/g, ""));
  const unit = (m[2] || "").toLowerCase();
  if (unit === "k" || unit === "thousand") n *= 1000;
  if (unit === "m" || unit === "million") n *= 1_000_000;
  return Number.isFinite(n) ? n : null;
}
interface ParsedBrief { title: string | null; owner: string | null; format: string | null; date: string | null; startTime: string | null; endTime: string | null; location: string | null; headcount: string | null; audience: string | null; justification: string | null; budgetTotal: number | null; }
function parseBrief(text: string): ParsedBrief {
  const lines = text.split(/\r?\n/);
  // "**Key:** value" pairs (tolerant of leading bullets and the colon inside/outside the bold).
  const labels: Record<string, string> = {};
  for (const ln of lines) {
    const m = ln.match(/^[-*\s]*\*\*\s*([^:*]+?)\s*:?\s*\*\*\s*:?\s*(.+?)\s*$/);
    if (m) labels[m[1].trim().toLowerCase()] = m[2].trim();
  }
  const h1 = lines.find((l) => /^#\s+/.test(l));
  const title = h1 ? h1.replace(/^#\s+/, "").replace(/^(event\s+brief|brief)\s*:\s*/i, "").trim() : null;
  const dateLine = labels["target date"] ?? labels["date"] ?? text;
  const tr = parseTimeRange(dateLine) ?? parseTimeRange(text);
  // Headcount: a labeled field, or a fallback "~40 people / 40 guests / 40 attendees" anywhere.
  const headcountLabel = labels["expected headcount"] ?? labels["headcount"] ?? labels["expected attendance"] ?? labels["attendance"] ?? "";
  const headcount = (headcountLabel.match(/\d[\d,]*/)?.[0] ?? text.match(/(?:~|around |about |approx\.?\s*)?(\d{2,5})\s*(?:high-signal\s+)?(?:people|guests|attendees|engineers|folks|ppl)\b/i)?.[1] ?? "").replace(/,/g, "");
  const sec = text.match(/##\s*(?:why|overview|strategic)[^\n]*\n+([\s\S]*?)(?:\n##|$)/i);
  return {
    title,
    owner: labels["owner"] ?? null,
    format: detectFormatKeyword(labels["type"] ?? "") ?? detectFormatKeyword(text),
    date: parseDatePhrase(dateLine),
    startTime: tr?.start ?? null,
    endTime: tr?.end ?? null,
    location: labels["location"] ?? null,
    headcount: headcount || null,
    audience: labels["audience"] ?? null,
    justification: sec ? sec[1].trim().replace(/\n+/g, " ") : null,
    budgetTotal: parseBudgetAmount(text),
  };
}

// ── Drop ingest: classify by CONTENT + type (not filename), extract, build a review ──
type DropKind = "cover" | "budget" | "attendees" | "brief" | "unknown";
interface Classified { kind: DropKind; name: string; text?: string; dataUrl?: string; file?: File }

// A spreadsheet is an attendee list (vs a budget) when its header has name/email-ish columns
// and no clear amount column.
function looksLikeAttendees(lines: string[]): boolean {
  if (lines.length < 2) return false;
  const header = (lines[0] ?? "").toLowerCase();
  const cells = header.split(/[,\t;]/).map((c) => c.trim());
  const hasNameOrEmail = cells.some((c) => /\b(name|first|last|email|attendee|guest|rsvp)\b/.test(c));
  const hasMoney = cells.some((c) => /\b(amount|cost|total|price|budget|\$)\b/.test(c)) || /\$/.test(lines.slice(1, 4).join(" "));
  return hasNameOrEmail && !hasMoney;
}

async function classifyDropFile(f: File): Promise<Classified> {
  if (f.type.startsWith("image/")) return { kind: "cover", name: f.name, file: f, dataUrl: await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(f); }) };
  let text = "";
  try { text = await f.text(); } catch { return { kind: "unknown", name: f.name, file: f }; }
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const delimited = lines.filter((l) => /[,\t;]/.test(l));
  const numericRows = lines.filter((l) => { const p = l.split(/[,\t;]/); return p.length > 1 && /\d/.test(p[p.length - 1] ?? ""); });
  const delimitedFrac = lines.length ? delimited.length / lines.length : 0;
  const numericFrac = lines.length ? numericRows.length / lines.length : 0;
  const hasMarkdown = /(^|\n)#{1,6}\s/.test(text) || /\*\*[^*\n]+:\*\*/.test(text);
  const tabular = lines.length >= 2 && delimitedFrac >= 0.6;
  // Filename signals — strong hints when the content heuristics are ambiguous (e.g. a budget
  // CSV whose amounts aren't in the last column, or numbers with commas that split oddly).
  const n = f.name.toLowerCase();
  const csv = /\.(csv|tsv)$/.test(n);
  const nameBudget = /budget|cost|expense|spend|financ|quote|invoice|pricing/.test(n);
  const nameAttendees = /attendee|guest|rsvp|roster|invit|registr|sign[\s_-]?up|\bpeople\b/.test(n);
  const nameBrief = /brief|spec|rfp|agenda|proposal|outline/.test(n);

  // Tabular + name/email columns (or the filename says so) → attendee list.
  if (!hasMarkdown && ((tabular && looksLikeAttendees(lines)) || (nameAttendees && (csv || tabular)))) return { kind: "attendees", name: f.name, text, file: f };
  // Strongly tabular, or a delimited file the filename calls a budget → budget.
  const strongBudget = lines.length >= 2 && delimitedFrac >= 0.7 && numericFrac >= 0.5;
  if (!hasMarkdown && (strongBudget || (nameBudget && (csv || delimitedFrac >= 0.4)))) return { kind: "budget", name: f.name, text, file: f };
  if (hasMarkdown) return { kind: "brief", name: f.name, text, file: f };
  if (strongBudget) return { kind: "budget", name: f.name, text, file: f };
  const looksProse = /[.!?]\s/.test(text) && text.split(/\s+/).length > 20 && delimitedFrac < 0.5;
  if (looksProse) return { kind: "brief", name: f.name, text, file: f };
  if (delimitedFrac >= 0.5 && numericFrac >= 0.4) return { kind: "budget", name: f.name, text, file: f };
  // Filename fallback before giving up — beats leaving an obviously-named file unsorted.
  if (nameBudget) return { kind: "budget", name: f.name, text, file: f };
  if (nameAttendees) return { kind: "attendees", name: f.name, text, file: f };
  if (nameBrief) return { kind: "brief", name: f.name, text, file: f };
  return { kind: "unknown", name: f.name, text, file: f };
}

interface IngestFields { name: string; format: string[]; date: string; startTime: string; endTime: string; headcount: string; venue: string; audience: string; components: string; justification: string }
// One taxonomy tag confidently drawn from the brief, or null → user must pick before create.
function detectTag(text: string): string | null {
  const t = text.toLowerCase();
  const hits: [RegExp, string][] = [
    [/client summit/, "Client summit"],
    [/hackathon/, "Hackathon"],
    [/co-?host|partner event/, "Co-hosted partner event"],
    [/sponsor(ship|ing)?\b/, "Sponsorship"],
    [/company milestone|\banniversary\b|\bmilestone\b/, "Company milestone"],
    [/team social|team offsite|team dinner|internal social|\boffsite\b/, "Internal team social"],
    [/brand|community/, "Brand & community event"],
  ];
  for (const [rx, tag] of hits) if (rx.test(t)) return tag;
  return null;
}

// ── Phases & deliverables from a brief's structure ────────────────────────────
interface IngestPhase { name: string; order: number }
interface IngestDeliverable { title: string; phase: string; offsetStart: number | null; offsetEnd: number | null; original?: string }

// A time cue in a sentence → a day-offset (range). Negative = before the event, 0 = day-of,
// positive = after. Returns null when there's no schedule signal (so non-tasks are skipped).
function parseOffset(s: string): { start: number; end: number | null } | null {
  const t = s.toLowerCase();
  const unit = (n: number, u: string) => (/week/.test(u) ? n * 7 : /month/.test(u) ? n * 30 : n);
  let m = t.match(/\bt\s*([+-]\d+)\b/);
  if (m) return { start: Number(m[1]), end: null };
  m = t.match(/(\d+)\s*[–—-]\s*(\d+)\s*(day|week|month)s?\s*(?:out|before|ahead|prior|in advance)/);
  if (m) { const a = unit(+m[1], m[3]); const b = unit(+m[2], m[3]); return { start: -Math.max(a, b), end: -Math.min(a, b) }; }
  m = t.match(/(\d+)\s*(day|week|month)s?\s*(?:out|before|ahead|prior|in advance)/);
  if (m) return { start: -unit(+m[1], m[2]), end: null };
  m = t.match(/(\d+)\s*(day|week|month)s?\s*(?:after|later|following|post)/);
  if (m) return { start: unit(+m[1], m[2]), end: null };
  if (/\bday-?of\b|\bday of\b|on the day/.test(t)) return { start: 0, end: null };
  if (/week of\b/.test(t)) return { start: -3, end: 0 };
  if (/post-?event|afterwards?|follow-?up|thank-?you|thank you|recap|debrief|after the event/.test(t)) return { start: 2, end: null };
  return null;
}

function parsePhasesAndDeliverables(text: string): { phases: IngestPhase[]; deliverables: IngestDeliverable[] } {
  const phases: IngestPhase[] = [];
  const deliverables: IngestDeliverable[] = [];
  let current: string | null = null;
  let order = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const h = line.match(/^(#{1,6})\s+(.*)/);
    if (h) {
      if (h[1].length === 1) { current = null; continue; } // H1 = brief title, not a phase
      current = h[2].replace(/[*_`]/g, "").trim();
      phases.push({ name: current, order: order++ });
      continue;
    }
    const content = (line.match(/^[-*]\s+(.*)/)?.[1] ?? line).replace(/\*\*/g, "").trim();
    if (!content) continue;
    const off = parseOffset(content);
    if (off && current) deliverables.push({ title: content.slice(0, 120), phase: current, offsetStart: off.start, offsetEnd: off.end });
  }
  // Fallback: no sections → infer phases from offsets (pre-event / day-of / post-event).
  if (!phases.length) {
    for (const raw of text.split(/\r?\n/)) {
      const content = (raw.trim().match(/^[-*]\s+(.*)/)?.[1] ?? raw.trim()).replace(/\*\*/g, "").trim();
      const off = content ? parseOffset(content) : null;
      if (!off) continue;
      const phase = off.start < 0 ? "Pre-event" : off.start === 0 ? "Day-of" : "Post-event";
      deliverables.push({ title: content.slice(0, 120), phase, offsetStart: off.start, offsetEnd: off.end });
    }
    const names = Array.from(new Set(deliverables.map((d) => d.phase)));
    ["Pre-event", "Day-of", "Post-event"].forEach((n, i) => { if (names.includes(n)) phases.push({ name: n, order: i }); });
  }
  // Drop repeats: phases by name, deliverables by phase+title (a brief may restate a task).
  const phSeen = new Set<string>();
  const uniqPhases = phases.filter((p) => { const k = p.name.toLowerCase(); return phSeen.has(k) ? false : (phSeen.add(k), true); });
  const dSeen = new Set<string>();
  const uniqDeliverables = deliverables.filter((d) => { const k = `${d.phase}|${d.title}`.toLowerCase(); return dSeen.has(k) ? false : (dSeen.add(k), true); });
  return { phases: uniqPhases, deliverables: uniqDeliverables };
}

const offLabel = (d: IngestDeliverable): string => {
  if (d.offsetStart == null) return "no date";
  const f = (n: number) => (n === 0 ? "T0" : n > 0 ? `T+${n}` : `T${n}`);
  return d.offsetEnd != null && d.offsetEnd !== d.offsetStart ? `${f(d.offsetStart)}→${f(d.offsetEnd)}` : f(d.offsetStart);
};

// ── Semantic prose routing: fan a brief out to vendor/venue, staff, reflections, agenda ──
const VENDOR_KEYWORDS: [RegExp, string][] = [
  [/\bvenue|rooftop|\bhall\b|ballroom|\bspace\b/, "Venue"],
  [/\bcater|\bfood\b|menu|grazing|passed app|\bapps?\b/, "Catering"],
  [/\bbar\b|drinks?|beverage|cocktail/, "Bar"],
  [/\ba\/?v\b|audio|\bsound\b|\bmic\b|projector|screen/, "A/V"],
  [/photograph|videograph|\bphoto\b/, "Photography"],
  [/\bdecor\b|signage|\bflowers?\b/, "Decor & signage"],
  [/\bswag\b|\bmerch\b|giveaway|branded/, "Swag"],
  [/security|check-?in|\bdoor\b|greeter/, "Staffing"],
  [/\brental|furniture|\btent\b|tables?\b/, "Rentals"],
  [/transport|shuttle|parking/, "Transportation"],
];
interface ProseRoles { vendors: string[]; staff: string[]; reflections: string[]; agenda: { time: string; title: string }[] }
function parseProseRoles(text: string): ProseRoles {
  const lower = text.toLowerCase();
  const vendors = Array.from(new Set(VENDOR_KEYWORDS.filter(([rx]) => rx.test(lower)).map(([, c]) => c)));

  // Staff roles (the role, never a name): "recruit 3 pace-group leads", "a photographer".
  const staff = new Set<string>();
  const roleRx = /\b(?:\d+|a|an|two|three|four|several|some)\s+([a-z][a-z'-]*(?:\s+[a-z][a-z'-]*){0,2}?\s*(?:leads?|hosts?|mcs?|moderators?|volunteers?|captains?|coordinators?|ambassadors?|greeters?|photographers?|djs?|staff|stewards?))\b/gi;
  for (const m of text.matchAll(roleRx)) staff.add(m[1].replace(/\s+/g, " ").trim().toLowerCase());

  // Reflections / guardrails — principle sentences, deduped (a brief often repeats a mantra).
  const normRef = (s: string) => s.toLowerCase().replace(/\s+/g, " ").replace(/[.!?,;:]+$/, "").trim();
  const refSeen = new Set<string>();
  const reflections: string[] = [];
  for (const s of text.split(/(?<=[.!?])\s+|\n/).map((x) => x.replace(/^[-*#\s>]+/, "").trim())) {
    if (!(s.length > 12 && s.length < 200 && /\bnot a\b|\bnot an\b|keep it|should feel|the point is|avoid\b|remember that|it'?s about|rather than|no\s+\w+,/i.test(s))) continue;
    const key = normRef(s);
    if (refSeen.has(key)) continue;
    refSeen.add(key); reflections.push(s);
    if (reflections.length >= 6) break;
  }

  // Agenda / run-of-show: a time + an activity per line, deduped by time+activity.
  const agSeen = new Set<string>();
  const agenda: { time: string; title: string }[] = [];
  for (const l of text.split(/\r?\n/)) {
    const m = l.trim().match(/^[-*\s]*((?:\d{1,2})(?::\d{2})?\s*(?:am|pm)?)\s*[:–—-]\s*(.+)/i);
    if (!m) continue;
    const item = { time: m[1].trim(), title: m[2].replace(/\*\*/g, "").trim().slice(0, 80) };
    const key = `${item.time}|${item.title}`.toLowerCase();
    if (agSeen.has(key)) continue;
    agSeen.add(key); agenda.push(item);
    if (agenda.length >= 20) break;
  }

  return { vendors, staff: Array.from(staff), reflections, agenda };
}

// Parse a name/email-ish spreadsheet into attendee rows.
function parseAttendees(text: string): { name: string; email: string | null }[] {
  const rows = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => l.split(/[,\t;]/).map((c) => c.trim().replace(/^"|"$/g, "")));
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.toLowerCase());
  const nameIdx = header.findIndex((h) => /name/.test(h) && !/user ?name/.test(h));
  const emailIdx = header.findIndex((h) => /e-?mail/.test(h));
  const hasHeader = nameIdx >= 0 || emailIdx >= 0;
  const body = hasHeader ? rows.slice(1) : rows;
  const ni = nameIdx >= 0 ? nameIdx : 0;
  const ei = emailIdx >= 0 ? emailIdx : rows[0].findIndex((c) => /@/.test(c));
  // Dedupe by email when present, else by name — lists often have repeat rows.
  const seen = new Set<string>();
  return body
    .map((r) => ({ name: (r[ni] ?? "").trim(), email: ei >= 0 ? (r[ei] ?? "").trim() || null : null }))
    .filter((a) => a.name)
    .filter((a) => { const k = (a.email || a.name).toLowerCase(); return seen.has(k) ? false : (seen.add(k), true); });
}

interface Ingest {
  fields: IngestFields;
  tag: string | null;        // single taxonomy tag — required before create
  isTemplate: boolean;       // partial specificity (no date / open slots) → template, else event
  attendees: { name: string; email: string | null }[];
  phases: IngestPhase[];     // brief's sections → ordered phase bands
  deliverables: IngestDeliverable[]; // dated tasks placed on the timeline within a phase
  vendors: string[];         // vendor/venue slots → seed vendor decisions
  staff: string[];           // staff roles (role, not name)
  reflections: string[];     // guardrails / principles → carried reflections
  agenda: { time: string; title: string }[]; // run-of-show
  walkthrough: WalkStep[];   // phased narrative-with-reasoning (the template's "face")
  heuristics: string[];      // rules-of-thumb (show-rate, sizing) → callouts + budget rules
  outreach: OutreachTemplate[]; // invite/outreach copy with [bracket] merge fields
  materials: { name: string; file: File; kind: string }[]; // the original dropped files → attached for reference
  unsorted: string[];        // filenames we couldn't classify — never guessed
  hasBrief: boolean;
  cover: string | null;      // data URL for preview
  coverFile: File | null;    // original image, uploaded to storage on create
  budgetLines: { label: string; amount: number | null }[];
  budgetSource: "file" | "brief" | null;
  budgetLowConfidence: boolean;
  conflict: { brief: number; file: number; fileLines: { label: string; amount: number | null }[]; briefLines: { label: string; amount: number | null }[] } | null;
  flags: IngestFlag[];       // soft conflicts: disagreeing values surfaced, never silently merged
  slotHints: Partial<Record<keyof IngestFields, string>>; // [bracket] placeholders → per-field hint text
  owner: string | null;
  warnings: string[];
  droppedForTemplate: { title: string; reason: string }[]; // template mode: tasks removed as too event-specific
  sourceId: string | null;   // set when reviewing an EXISTING event/template → save UPDATES it (no duplicate)
}

// Rebuild the review (ingest) from an already-saved event/template, so its generation page
// can be reopened without reprocessing the brief. Mirrors what the extractor + ingest produced.
function ingestFromPlan(plan: EventPlanning): Ingest {
  const sc = loadScoping(plan.id);
  return {
    fields: {
      name: plan.title,
      format: parseFormats(plan.format),
      date: plan.date ?? '',
      startTime: plan.startTime ?? '',
      endTime: plan.endTime ?? '',
      headcount: plan.headcount != null ? String(plan.headcount) : (sc.headcount ?? ''),
      venue: plan.location ?? '',
      audience: sc.audience ?? '',
      components: (sc.components ?? []).join(', '),
      justification: sc.strategicJustification || plan.description || '',
    },
    tag: plan.tags[0] ?? null,
    isTemplate: plan.isTemplate,
    attendees: [],
    phases: plan.phases.map((p) => ({ name: p.name, order: p.order })),
    deliverables: plan.deliverables.map((d) => ({ title: d.title, phase: d.phase ?? 'Planning', offsetStart: d.offsetStart, offsetEnd: d.offsetEnd })),
    vendors: plan.engagements.map((e) => e.category).filter((c): c is string => !!c),
    staff: plan.staffRoles,
    reflections: plan.reflections,
    agenda: plan.agenda,
    walkthrough: plan.walkthrough,
    heuristics: plan.heuristics,
    outreach: plan.outreach,
    materials: [], // already-uploaded source materials live on the event; resume doesn't re-attach
    unsorted: [],
    hasBrief: true,
    cover: plan.coverImageUrl ?? null,
    coverFile: null,
    budgetLines: (plan.budget?.lines ?? []).filter((l) => l.label).map((l) => ({ label: l.label as string, amount: l.confirmedAmount ?? l.target })),
    budgetSource: plan.budget?.lines.length ? 'file' : null,
    budgetLowConfidence: false,
    conflict: null,
    flags: [],
    slotHints: {},
    owner: plan.owner ?? null,
    warnings: [],
    droppedForTemplate: [], // a re-opened saved event has no pending generalization diff
    sourceId: plan.id, // reviewing an existing event/template → re-save updates it
  };
}


// A disagreement between two dropped sources. Surfaced with optional one-click resolutions
// (each applies a field patch); dismissing just clears it. Not a blocker, unlike the budget conflict.
interface IngestFlag { id: string; message: string; actions?: { label: string; patch: Partial<IngestFields> }[] }

// Lightweight parse of a free-text event description into title + date — used by the
// "Skip & create" path (the generate path parses server-side). Format/type is handled
// separately by the format-catalog auto-detect.
const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
function parseEventDescription(text: string): { title: string | null; date: string | null } {
  const titleMatch = text.match(/\b(?:titled?|called)[:\s]+([^,;\n]+)/i);
  return { title: titleMatch ? titleMatch[1].trim() : null, date: parseDatePhrase(text) };
}
// Planning is forward-looking — a parsed date in the past rolls to its next occurrence.
function ensureUpcoming(iso: string | null): string | null {
  if (!iso) return iso;
  const d = new Date(iso + "T00:00:00");
  if (Number.isNaN(d.getTime())) return iso;
  const now = new Date();
  const todayMid = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (d >= todayMid) return iso;
  d.setFullYear(now.getFullYear());
  if (d < todayMid) d.setFullYear(now.getFullYear() + 1);
  return d.toISOString().slice(0, 10);
}
function parseDatePhrase(text: string): string | null {
  const iso = (y: number, mo: number, d: number) => `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const inferYear = (mo: number, d: number) => {
    const now = new Date();
    const cand = new Date(now.getFullYear(), mo - 1, d);
    const todayMid = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return cand < todayMid ? now.getFullYear() + 1 : now.getFullYear();
  };
  const t = text.toLowerCase();
  let m = t.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = t.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(\d{4}))?/);
  if (m) { const mo = MONTHS[m[1]]; const d = Number(m[2]); return iso(m[3] ? Number(m[3]) : inferYear(mo, d), mo, d); }
  m = t.match(/\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?\b/);
  if (m) {
    const mo = Number(m[1]); const d = Number(m[2]);
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) { let y = m[3] ? Number(m[3]) : inferYear(mo, d); if (y < 100) y += 2000; return iso(y, mo, d); }
  }
  return null;
}

/**
 * A thin sliver of the event's dominant cover color in the lines view. On row hover
 * (group/row) it draws out into a small square of the actual Luma cover. Dominant
 * color is sampled from the image (downscaled to 1px); falls back to the tag color
 * if the image can't be read (e.g. CORS) or there's no cover.
 */
function LumaSwatch({ url, fallback }: { url: string | null; fallback: string }) {
  const [color, setColor] = useState<string | null>(null);
  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const c = document.createElement("canvas");
        c.width = 1; c.height = 1;
        const ctx = c.getContext("2d");
        if (!ctx) return;
        ctx.drawImage(img, 0, 0, 1, 1);
        const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
        if (!cancelled) setColor(`rgb(${r}, ${g}, ${b})`);
      } catch { /* tainted canvas (CORS) → keep the tag-color fallback */ }
    };
    img.src = url;
    return () => { cancelled = true; };
  }, [url]);

  return (
    <span
      className={`relative block h-7 w-1.5 group-hover/row:h-10 group-hover/row:w-10 rounded-[3px] overflow-hidden shrink-0 transition-all duration-200 ease-out ${color ? "" : fallback}`}
      style={color ? { backgroundColor: color } : undefined}
      aria-hidden
    >
      {url && (
        <img src={url} alt="" className="absolute inset-0 w-full h-full object-cover opacity-0 group-hover/row:opacity-100 transition-opacity duration-200" style={{ filter: "saturate(1.4) contrast(1.05)" }} />
      )}
    </span>
  );
}

// Month-grid calendar of the (filtered) events, placed on their dates. Click an event to open it.
function CalendarView({ events, onOpen }: { events: EventListItem[]; onOpen: (id: string) => void }) {
  const pad = (n: number) => String(n).padStart(2, "0");
  const now = new Date();
  const [cursor, setCursor] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const todayIso = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

  const byDay = useMemo(() => {
    const map = new Map<string, EventListItem[]>();
    for (const e of events) { if (!e.date) continue; const arr = map.get(e.date); if (arr) arr.push(e); else map.set(e.date, [e]); }
    return map;
  }, [events]);
  const undated = events.filter((e) => !e.date);
  // Hover preview (with cover) — fixed-positioned so it escapes the grid's overflow clipping.
  const [preview, setPreview] = useState<{ e: EventListItem; top: number; left: number } | null>(null);
  const onChipEnter = (ev: React.MouseEvent, e: EventListItem) => {
    const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    setPreview({ e, top: r.bottom + 6, left: Math.min(r.left, window.innerWidth - 288) });
  };
  const dotColor = (e: EventListItem) => e.macroStage === "Wrapped" || e.status === "past" ? "bg-gray-400" : e.status === "in-process" ? "bg-amber-500" : "bg-blue-500";

  const first = new Date(cursor.y, cursor.m, 1);
  const startDow = first.getDay();
  const daysInMonth = new Date(cursor.y, cursor.m + 1, 0).getDate();
  const cells: (string | null)[] = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(`${cursor.y}-${pad(cursor.m + 1)}-${pad(d)}`);
  while (cells.length % 7) cells.push(null);

  const shift = (delta: number) => setCursor((c) => { const d = new Date(c.y, c.m + delta, 1); return { y: d.getFullYear(), m: d.getMonth() }; });
  const monthLabel = first.toLocaleDateString("en-US", { month: "long", year: "numeric" });

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-lg">{monthLabel}</h3>
        <div className="flex items-center gap-1">
          <button onClick={() => shift(-1)} className="p-1.5 rounded-lg border border-border hover:bg-gray-50" aria-label="Previous month"><ChevronLeft className="w-4 h-4" /></button>
          <button onClick={() => setCursor({ y: now.getFullYear(), m: now.getMonth() })} className="px-2.5 py-1 rounded-lg border border-border text-sm hover:bg-gray-50">Today</button>
          <button onClick={() => shift(1)} className="p-1.5 rounded-lg border border-border hover:bg-gray-50" aria-label="Next month"><ChevronRight className="w-4 h-4" /></button>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-px bg-border rounded-xl overflow-hidden border border-border">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <div key={d} className="bg-gray-50 text-[11px] text-gray-500 text-center py-1.5">{d}</div>
        ))}
        {cells.map((iso, i) => (
          <div key={i} className={`bg-white min-h-[104px] p-1.5 ${iso === todayIso ? "ring-2 ring-inset ring-gray-900/15" : ""}`}>
            {iso && <div className={`text-[11px] mb-1 ${iso === todayIso ? "font-semibold text-gray-900" : "text-gray-400"}`}>{Number(iso.slice(8))}</div>}
            {iso && (byDay.get(iso) ?? []).map((e) => (
              <button
                key={e.id}
                onClick={() => onOpen(e.id)}
                onMouseEnter={(ev) => onChipEnter(ev, e)}
                onMouseLeave={() => setPreview(null)}
                className="flex items-center gap-1 w-full text-left text-[11px] rounded px-1 py-0.5 mb-0.5 bg-gray-100 text-gray-800 hover:bg-gray-200 transition-colors"
              >
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotColor(e)}`} />
                <span className="truncate">{e.startTime ? `${e.startTime} ` : ""}{e.title}</span>
              </button>
            ))}
          </div>
        ))}
      </div>
      {undated.length > 0 && (
        <div className="mt-3 text-[13px] text-gray-500">
          <span className="text-gray-400">No date ({undated.length}):</span>{" "}
          {undated.slice(0, 10).map((e) => (
            <button key={e.id} onClick={() => onOpen(e.id)} className="underline decoration-dotted underline-offset-2 mr-2 hover:text-gray-900">{e.title}</button>
          ))}
          {undated.length > 10 && <span className="text-gray-400">+{undated.length - 10} more</span>}
        </div>
      )}

      {/* Hover preview — cover (if any) + the essentials. Fixed so it isn't clipped by the grid. */}
      {preview && (
        <div className="fixed z-50 w-72 rounded-xl border border-border bg-white shadow-xl overflow-hidden pointer-events-none" style={{ top: preview.top, left: preview.left }}>
          {preview.e.coverImageUrl && (
            <img src={preview.e.coverImageUrl} alt="" className="h-28 w-full object-cover" style={{ objectPosition: preview.e.coverPosition ?? "50% 50%" }} />
          )}
          <div className="p-3">
            <p className="font-medium text-sm text-gray-900">{preview.e.title}</p>
            <p className="text-[12px] text-gray-500 mt-0.5">
              {[preview.e.date, preview.e.startTime && preview.e.endTime ? `${preview.e.startTime}–${preview.e.endTime}` : preview.e.startTime, preview.e.location].filter(Boolean).join(" · ") || "—"}
            </p>
            <div className="flex items-center gap-2 mt-1.5 text-[11px] text-gray-400">
              {preview.e.format && <span className="px-1.5 py-0.5 bg-gray-100 rounded text-gray-600">{preview.e.format}</span>}
              {preview.e.macroStage === "Wrapped" ? <span>wrapped</span> : preview.e.attendeeCount != null ? <span>{preview.e.attendeeCount} checked in</span> : preview.e.rsvp != null ? <span>{preview.e.rsvp} RSVPs</span> : null}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

interface EventsPageProps {
  selectedEventId: string | null;
  setSelectedEventId: (id: string | null) => void;
  onViewPeople: (filter: { id: string; name: string; tag?: string | null; status?: 'all' | 'registered' | 'checkedIn' | 'waitlisted' | 'speakers' }) => void;
  openCreate?: boolean; // open the Create Event modal on mount (set when navigated here via a Create button)
  initialFiles?: File[] | null; // files dropped anywhere on the page → ingest straight into review
  looksPast?: boolean; // the global drop sniffed a past event → ask (backfill vs in-process) first
  onFilesConsumed?: () => void; // called once the dropped files have been handed to the modal
}

/** Create-event entry flow: choose ownership, describe, optionally start from a past event. */
/** Small editable chip list (vendor categories, progress workstreams). */
function ChipEditor({ items, onChange, placeholder }: { items: string[]; onChange: (v: string[]) => void; placeholder: string }) {
  const [draft, setDraft] = useState('');
  const add = () => { const v = draft.trim(); if (!v || items.includes(v)) { setDraft(''); return; } onChange([...items, v]); setDraft(''); };
  return (
    <div className="flex flex-wrap items-center gap-2">
      {items.map((it) => (
        <span key={it} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-sm bg-gray-100 text-gray-700">
          {it}
          <button onClick={() => onChange(items.filter((x) => x !== it))} className="text-gray-400 hover:text-gray-900"><X className="w-3 h-3" /></button>
        </span>
      ))}
      <span className="inline-flex gap-1">
        <input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') add(); }} placeholder={placeholder} className="px-2 py-1 w-36 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
        <button onClick={add} className="px-2 py-1 text-sm bg-gray-200 rounded hover:bg-gray-300">Add</button>
      </span>
    </div>
  );
}

/** Seed the "describe the event" box from a past event's specs, ending with a
 *  prompt for the user to fill in what's different this time. */
function templateDescription(e: EventListItem): string {
  const specs: string[] = [];
  if (e.format) specs.push(`Format: ${e.format}`);
  if (e.location) specs.push(`Location: ${e.location}`);
  const size = e.capacity ?? e.rsvp ?? e.attendeeCount;
  if (size != null) specs.push(`Size: ~${size} guests`);
  if (e.tags.length) specs.push(`Themes: ${e.tags.join(", ")}`);
  const heading = e.seriesName ? `Modeled on “${e.title}” (${e.seriesName}).` : `Modeled on “${e.title}”.`;
  return [heading, ...specs, "", "What’s different this time: "].join("\n");
}

/** Site-styled select dropdown — replaces the native <select> so the menu matches the
 *  rest of the UI (white panel, black border, rounded) instead of the OS picker. */
// Brand select (from @instalily/ui). Keeps the same { value, options, onChange, className }
// API as the old hand-rolled dropdown, so the Locations/Owners/Date call sites are unchanged.
function SelectMenu({ value, options, onChange, className = "" }: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
  className?: string;
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as string)} items={options}>
      <SelectTrigger className={`w-full ${className}`}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Tag filter — same brand Select as the Location/Owner/Date filters. The taxonomy is the
 *  fixed set of 7 tags grouped by category; each option shows as its colored pill. */
function TagFilter({ value, onChange, className = "" }: { value: string; onChange: (v: string) => void; className?: string }) {
  // Flat {value,label} list so the trigger (SelectValue) resolves the selected tag's label.
  const items = [
    { value: "all", label: "All Tags" },
    ...TAG_CATEGORIES.flatMap((c) => c.tags.map((t) => ({ value: t, label: t }))),
  ];
  return (
    <Select value={value} onValueChange={(v) => onChange(v as string)} items={items}>
      <SelectTrigger className={`w-full ${className}`}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All Tags</SelectItem>
        {TAG_CATEGORIES.map((cat) => (
          <SelectGroup key={cat.name}>
            <SelectLabel>{cat.name}</SelectLabel>
            {cat.tags.map((t) => (
              <SelectItem key={t} value={t}><Badge variant={tagBadgeVariant(t)}>{t}</Badge></SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  );
}

function CreateEventModal({ events, initialFiles, resumeIngest, onFilesConsumed, onClose, onCreated, onCacheReview, onBackfill }: { events: EventListItem[]; initialFiles?: File[] | null; resumeIngest?: Ingest | null; onFilesConsumed?: () => void; onClose: () => void; onCreated: (eventId: string) => void; onCacheReview?: (ingest: Ingest) => void; onBackfill: (text?: string, files?: File[]) => void }) {
  // Files dropped on the page open the modal already processing — the first paint is the
  // "reading…" state. A resumed review (re-opened after generating) lands straight back on
  // the review screen with the cached extraction, no reprocessing.
  const [mode, setMode] = useState<'choose' | 'planFork' | 'audience' | 'planning' | 'review' | 'backfill' | 'processing'>(
    () => (initialFiles && initialFiles.length ? 'processing' : resumeIngest ? 'review' : 'choose'),
  );
  // Set on the planning fork: solo (InstaLILY hosts alone) vs cohost (sharing hosting & cost).
  const [planKind, setPlanKind] = useState<'solo' | 'cohost'>('solo');
  // Solo path only: internal vs external audience, then the specific taxonomy tag to apply.
  const [audience, setAudience] = useState<'internal' | 'external' | null>(null);
  const [eventTag, setEventTag] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  // The spec text we auto-filled from the selected template; lets us swap/clear it
  // when the selection changes without clobbering anything the user typed.
  const [autofilledDesc, setAutofilledDesc] = useState('');
  const [templateSearch, setTemplateSearch] = useState('');
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [draft, setDraft] = useState<GeneratedTemplate | null>(null);
  const [meta, setMeta] = useState({ name: '', date: '', startTime: '', endTime: '', location: '', lumaUrl: '', coHost: '' });
  const [bf, setBf] = useState({ name: '', date: '', location: '', description: '', lumaUrl: '' });
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const descRef = useRef<HTMLTextAreaElement>(null);

  // Format catalog + the event's formats. Auto-detected from the name/description (any
  // catalog format whose term appears verbatim) until the user edits the field themselves.
  const [formatCatalog, setFormatCatalog] = useState<string[]>([]);
  const [formats, setFormats] = useState<string[]>([]);
  const [formatTouched, setFormatTouched] = useState(false);
  useEffect(() => { listFormats().then(setFormatCatalog).catch(() => {}); }, []);
  // Files dropped anywhere on the page (global drop) → ingest immediately into the review.
  useEffect(() => { if (initialFiles && initialFiles.length) { void handleBriefDrop(initialFiles); onFilesConsumed?.(); } /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  // Dropped event-brief artifacts: a text brief prefills now; a cover image + budget sheet
  // are stashed and applied right after the event is created.
  const [briefDragOver, setBriefDragOver] = useState(false);
  const [ingest, setIngest] = useState<Ingest | null>(resumeIngest ?? null);
  const [pastHint, setPastHint] = useState<string | null>(null); // brief text, when a drop reads as a PAST event
  // Files dropped on the first (choose) screen, held until the user picks one of the three.
  const [pendingDrop, setPendingDrop] = useState<File[] | null>(null);
  const [choice, setChoice] = useState<'planning' | 'backfill' | null>(null);
  const dragDepth = useRef(0);
  const chooseFileRef = useRef<HTMLInputElement>(null);
  const chooseFolderRef = useRef<HTMLInputElement>(null);
  const [attachOpen, setAttachOpen] = useState(false);
  const [attachPos, setAttachPos] = useState<{ left: number; top: number } | null>(null);
  const attachRef = useRef<HTMLDivElement>(null);
  const attachMenuRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!attachOpen || !attachRef.current) return;
    const r = attachRef.current.getBoundingClientRect();
    setAttachPos({ left: r.left, top: r.bottom + 4 });
  }, [attachOpen]);
  useEffect(() => {
    if (!attachOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (attachRef.current?.contains(t) || attachMenuRef.current?.contains(t)) return;
      setAttachOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [attachOpen]);

  // Continue from the choose screen: ingest the dropped files (if any) per the selection,
  // else proceed through the normal flow.
  const continueFromChoose = () => {
    if (choice === 'planning') {
      if (pendingDrop) { setPlanKind('solo'); const fs = pendingDrop; setPendingDrop(null); void handleBriefDrop(fs); }
      else setMode('planFork');
    } else if (choice === 'backfill') {
      // Backfill is its OWN flow (opposite direction from create) — hand off to the backfill modal,
      // passing along any dropped brief's text. Never run a past event through the create flow.
      const fs = pendingDrop; setPendingDrop(null);
      if (fs?.length) void (async () => { const c = await Promise.all(fs.map(classifyDropFile)); onBackfill(c.find((x) => x.kind === "brief")?.text ?? undefined, fs); })();
      else onBackfill();
    }
  };
  // Classify every dropped input by content, extract per type, and assemble a single review.
  const handleBriefDrop = async (files: File[]) => {
    setMode('processing');
    const classified = await Promise.all(files.map(classifyDropFile));
    // Every dropped file, kept to attach to the event for reference.
    const materials = classified.filter((c) => c.file).map((c) => ({ name: c.name, file: c.file as File, kind: c.kind }));
    const briefs = classified.filter((c) => c.kind === "brief");
    const budgets = classified.filter((c) => c.kind === "budget");
    const covers = classified.filter((c) => c.kind === "cover");
    const attendeeFiles = classified.filter((c) => c.kind === "attendees");
    // Nothing is dropped silently: unknowns AND the unused extras of any multi-file type
    // (we only consume the first brief/budget/cover) land in the unsorted pile.
    const extras = [...briefs.slice(1), ...budgets.slice(1), ...covers.slice(1)].map((c) => c.name);
    const unsorted = [...classified.filter((c) => c.kind === "unknown").map((c) => c.name), ...extras];
    const warnings: string[] = [];
    if (briefs.length > 1) warnings.push(`${briefs.length} files looked like briefs — using the first; the rest are in unsorted.`);
    if (budgets.length > 1) warnings.push(`${budgets.length} files looked like budgets — using the first; the rest are in unsorted.`);
    if (covers.length > 1) warnings.push(`${covers.length} images dropped — using the first as the cover; the rest are in unsorted.`);
    const attendees = attendeeFiles.flatMap((c) => (c.text ? parseAttendees(c.text) : []));

    const b = briefs[0]?.text ? parseBrief(briefs[0].text!) : null;
    // Prefer Claude's structured extraction — it's far better at intent (a real overview vs
    // boilerplate, DEFINITE deliverables even when untimed, guardrails vs prose). The local
    // regex parse stays as the fallback when the function fails or isn't configured.
    let ex: ExtractedBrief | null = null;
    if (briefs[0]?.text) { try { ex = await extractBrief(briefs[0].text!); } catch (e) { console.warn("extract-brief failed — falling back to the offline regex parser:", e); ex = null; } }
    if (briefs.length > 0 && !ex) warnings.push("Used the offline parser (AI extraction unavailable) — double-check the details.");
    // The extractor returns "" (not null) for unstated strings; treat blank as absent.
    const nn = (s: string | null | undefined): string | null => (s && s.trim() ? s : null);
    // Map the extracted/detected format onto the existing catalog (closest match), so we
    // reuse "Run" rather than minting "Run + coffee". Fetch the catalog fresh — on a global
    // drop the modal mounts and processes before the catalog state has loaded.
    const catalog = await listFormats().catch(() => formatCatalog);
    const rawFmt = nn(ex?.format) ?? b?.format ?? null;
    const fmt = rawFmt ? matchFormat(rawFmt, catalog) : null;
    // Keep the raw parsed date (not forced upcoming) so a past date routes to backfill.
    // Partial specificity: a value that's *only* a placeholder ("[venue TBD]", "[city]")
    // is an open slot — keep the field present but empty, and note it for the user.
    // Keep the bracket's inner text as a per-field hint so the input can show what the
    // template expected (e.g. "[downtown rooftop]" → placeholder "downtown rooftop").
    const slotHints: Partial<Record<keyof IngestFields, string>> = {};
    const openSlot = (v: string | null, key: keyof IngestFields): string => {
      const m = v?.trim().match(/^\[([^\]]*)\]$/);
      if (m) { slotHints[key] = m[1].trim() || key; return ""; }
      return v ?? "";
    };
    const fields: IngestFields = {
      name: openSlot(nn(ex?.title) ?? b?.title ?? null, "name"),
      format: fmt ? [fmt] : [],
      date: nn(ex?.date) ?? b?.date ?? "",
      startTime: nn(ex?.startTime) ?? b?.startTime ?? "",
      endTime: nn(ex?.endTime) ?? b?.endTime ?? "",
      headcount: openSlot(ex?.headcount != null ? String(ex.headcount) : (b?.headcount ?? null), "headcount"),
      venue: openSlot(nn(ex?.location) ?? b?.location ?? null, "venue"),
      audience: openSlot(nn(ex?.audience) ?? b?.audience ?? null, "audience"),
      components: "",
      justification: openSlot(nn(ex?.overview) ?? b?.justification ?? null, "justification"),
    };
    if (Object.keys(slotHints).length) warnings.push(`Open slots to fill: ${Object.keys(slotHints).join(", ")}.`);

    const rawFileLines = budgets[0]?.text ? parseBudgetText(budgets[0].text!) : [];
    // Drop duplicate budget rows (same label + amount).
    const blSeen = new Set<string>();
    const fileLines = rawFileLines.filter((l) => { const k = `${l.label.trim().toLowerCase()}|${l.amount ?? ""}`; return blSeen.has(k) ? false : (blSeen.add(k), true); });
    const briefTotal = ex?.budgetTotal ?? b?.budgetTotal ?? null;
    const fileTotal = fileLines.reduce((s, r) => s + (r.amount ?? 0), 0);
    const briefLines = briefTotal != null ? [{ label: "Estimated total (brief)", amount: briefTotal }] : [];

    let budgetLines: { label: string; amount: number | null }[] = [];
    let budgetSource: "file" | "brief" | null = null;
    let budgetLowConfidence = false;
    let conflict: Ingest["conflict"] = null;
    if (fileLines.length && briefTotal != null && Math.abs(fileTotal - briefTotal) > 1) {
      conflict = { brief: briefTotal, file: fileTotal, fileLines, briefLines };
    } else if (fileLines.length) { budgetLines = fileLines; budgetSource = "file"; }
    else if (briefTotal != null) { budgetLines = briefLines; budgetSource = "brief"; budgetLowConfidence = true; }

    if (!briefs.length && (budgets.length || covers.length || attendeeFiles.length)) warnings.push("No brief detected — fill the event details below.");

    // Soft conflicts: surface disagreeing sources rather than silently picking one.
    const flags: IngestFlag[] = [];
    const briefHead = ex?.headcount ?? (b?.headcount && /^\d+$/.test(b.headcount.trim()) ? Number(b.headcount.trim()) : null);
    if (briefHead != null && attendees.length > 0 && briefHead !== attendees.length) {
      // Headcount in the brief disagrees with the attendee list — let the user pick which wins.
      flags.push({
        id: "headcount",
        message: `Headcount mismatch — the brief says ${briefHead}, but the attendee list has ${attendees.length}.`,
        actions: [
          { label: `Use list count (${attendees.length})`, patch: { headcount: String(attendees.length) } },
          { label: `Keep brief (${briefHead})`, patch: {} },
        ],
      });
    } else if (!fields.headcount && attendees.length > 0) {
      // No conflict, no stated headcount → the list count is the obvious fill (a merge, not a conflict).
      fields.headcount = String(attendees.length);
    }

    // Template vs event: the extractor's specificity decides when present (a pattern/how-to
    // with no concrete date → template); else fall back to no-date / many-[brackets].
    const bracketCount = briefs[0]?.text ? (briefs[0].text!.match(/\[[^\]]+\]/g) || []).length : 0;
    const isTemplate = ex ? (ex.specificity === "template" || !fields.date) : (!fields.date || bracketCount >= 3);

    // Phases + deliverables: from the LLM (definite action items, untimed allowed), else regex.
    let phases: IngestPhase[];
    let deliverables: IngestDeliverable[];
    if (ex) {
      const phaseNames = [...ex.phases];
      for (const d of ex.deliverables) if (d.phase && !phaseNames.includes(d.phase)) phaseNames.push(d.phase);
      phases = phaseNames.map((name, i) => ({ name, order: i }));
      const dSeen = new Set<string>();
      deliverables = ex.deliverables
        .map((d) => ({ title: d.title, phase: d.phase ?? (phaseNames[0] ?? "Planning"), offsetStart: d.offsetStart, offsetEnd: d.offsetEnd, original: d.original || undefined }))
        .filter((d) => d.title.trim() && (dSeen.has(`${d.phase}|${d.title}`.toLowerCase()) ? false : (dSeen.add(`${d.phase}|${d.title}`.toLowerCase()), true)));
    } else {
      ({ phases, deliverables } = briefs[0]?.text ? parsePhasesAndDeliverables(briefs[0].text!) : { phases: [], deliverables: [] });
    }
    const roles = ex
      ? { vendors: ex.vendors, staff: ex.staff, reflections: ex.guardrails, agenda: ex.agenda }
      : (briefs[0]?.text ? parseProseRoles(briefs[0].text!) : { vendors: [], staff: [], reflections: [], agenda: [] });
    const tag = ex?.tag ?? (briefs[0]?.text ? detectTag(briefs[0].text!) : null);

    // Safety net: a dropped brief with a PAST date is almost certainly a backfill, not a create.
    // Offer to switch flows (don't silently route a past event through create).
    const todayIso = new Date().toISOString().slice(0, 10);
    setPastHint(!isTemplate && fields.date && fields.date < todayIso ? (briefs[0]?.text ?? "") : null);
    setIngest({ fields, tag, isTemplate, attendees, phases, deliverables, vendors: roles.vendors, staff: roles.staff, reflections: roles.reflections, agenda: roles.agenda, walkthrough: ex?.walkthrough ?? [], heuristics: ex?.heuristics ?? [], outreach: ex?.outreach ?? [], materials, unsorted, hasBrief: briefs.length > 0, cover: covers[0]?.dataUrl ?? null, coverFile: covers[0]?.file ?? null, budgetLines, budgetSource, budgetLowConfidence, conflict, flags, slotHints, owner: nn(ex?.owner) ?? b?.owner ?? null, warnings, droppedForTemplate: (isTemplate && ex?.droppedForTemplate) ? ex.droppedForTemplate : [], sourceId: null });
    setMode("review");
  };

  useEffect(() => {
    if (formatTouched || formatCatalog.length === 0) return;
    const text = `${meta.name} ${description}`;
    const found = formatCatalog.filter((f) => f.trim() && new RegExp(`\\b${f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text));
    setFormats(found);
  }, [description, meta.name, formatCatalog, formatTouched]);

  // Auto-grow the describe box to fit its content (capped), so it expands as you type.
  useEffect(() => {
    const el = descRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 320)}px`;
  }, [description, mode]);
  // Once the description has real substance, give it room by shrinking the past-event grid.
  const descLong = description.trim().length > 140 || description.split('\n').length > 4;

  const createPlanned = async () => {
    // When skipping the draft, parse the free-text description for title/date (the generate
    // path parses server-side); format/type is auto-detected into `formats` already.
    const parsed = draft ? { title: null, date: null } : parseEventDescription(description);
    const name = meta.name.trim() || parsed.title || description.trim().split('\n')[0].slice(0, 120).trim();
    if (!name) return;
    const date = meta.date || ensureUpcoming(parsed.date) || null;
    setCreating(true); setCreateError(null);
    try {
      // Skip the draft → a bare template; budget make-up is populated later on the dashboard.
      const template: GeneratedTemplate = draft
        ? { ...draft, budgetLines: [] }
        : { name, vendorCategories: [], budgetLines: [], progressCategories: [] };
      const id = await createPlanningEvent({ name, date, startTime: meta.startTime || null, endTime: meta.endTime || null, location: meta.location.trim() || null, tags: eventTag ? [eventTag] : [], format: joinFormats(formats), template, hosting: planKind, coHost: planKind === 'cohost' ? meta.coHost : null, modeledOnEventId: selected });
      if (meta.lumaUrl.trim()) { try { await attachLuma(id, meta.lumaUrl.trim()); } catch { /* event still created; attach later from the card */ } }
      onCreated(id);
    } catch (e: any) { setCreateError(e.message ?? String(e)); setCreating(false); }
  };

  // Create from a reviewed drop ingest: event + cover + ESTIMATED budget lines (rough cost,
  // never the assigned target) + seeded scoping fields. Owner matched by name if possible.
  const createFromIngest = async () => {
    if (!ingest || !ingest.tag) return; // an event must have a tag
    const f = ingest.fields;
    const name = f.name.trim() || 'Untitled event';
    const today = new Date().toISOString().slice(0, 10);
    const asTemplate = ingest.isTemplate; // save as a reusable Event Type (no date / open slots)

    // Reviewing an EXISTING event/template → SAVE (update in place), never create a duplicate.
    // Apply the edited scalar + pattern fields; don't re-add deliverables/budget (they already exist).
    if (ingest.sourceId) {
      const id = ingest.sourceId;
      const headNum = f.headcount.trim() ? Number(f.headcount) : null;
      setCreating(true); setCreateError(null);
      try {
        await updateEvent(id, { name, location: f.venue.trim() || null, startTime: f.startTime || null, endTime: f.endTime || null, format: joinFormats(f.format), audience: f.audience.trim() || null });
        await updateEventTags(id, [ingest.tag]).catch(() => {});
        if (!asTemplate && f.date) await setEventDate(id, f.date).catch(() => {});
        await setEventStaffRoles(id, ingest.staff).catch(() => {});
        await setEventReflections(id, ingest.reflections).catch(() => {});
        await setEventAgenda(id, ingest.agenda).catch(() => {});
        await setEventPattern(id, { phases: ingest.phases, heuristics: ingest.heuristics, outreach: ingest.outreach, walkthrough: ingest.walkthrough }).catch(() => {});
        if (headNum != null && Number.isFinite(headNum)) await setHeadcount(id, headNum).catch(() => {});
        onCacheReview?.(ingest);
        onCreated(id); // straight back to the actual template/event
      } catch (e: any) { setCreateError(e.message ?? String(e)); setCreating(false); }
      return;
    }
    const isPast = !asTemplate && !!f.date && f.date < today; // past date → backfill (templates never backfill)
    const headNum = f.headcount.trim() ? Number(f.headcount) : null;
    setCreating(true); setCreateError(null);
    try {
      let id: string;
      if (isPast) {
        id = await backfillEvent({ name, date: f.date, location: f.venue.trim() || null, description: f.justification.trim() || null });
        try { await updateEventTags(id, [ingest.tag]); } catch { /* non-fatal */ }
        try { await setEventFormat(id, joinFormats(f.format)); } catch { /* non-fatal */ }
      } else {
        const template: GeneratedTemplate = { name, vendorCategories: ingest.vendors, budgetLines: [], progressCategories: [] };
        // Planning window from the deliverable offsets (e.g. "T-21 → T+5"); untimed tasks skip it.
        const offs = ingest.deliverables.flatMap((d) => [d.offsetStart, d.offsetEnd ?? d.offsetStart]).filter((n): n is number => n != null);
        const lead = offs.length ? `T${Math.min(...offs)} → T+${Math.max(...offs, 0)}` : null;
        // A template is date-less by definition; an instance keeps whatever date was parsed.
        id = await createPlanningEvent({ name, date: asTemplate ? null : (f.date || null), startTime: f.startTime || null, endTime: f.endTime || null, location: f.venue.trim() || null, tags: [ingest.tag], format: joinFormats(f.format), phases: ingest.phases, planningLeadTime: lead, agenda: ingest.agenda, staffRoles: ingest.staff, reflections: ingest.reflections, walkthrough: ingest.walkthrough, heuristics: ingest.heuristics, outreach: ingest.outreach, template, isTemplate: asTemplate, hosting: planKind, coHost: planKind === 'cohost' ? meta.coHost : null, modeledOnEventId: selected });
      }
      // Upload every dropped file once → attach as source materials for reference. Keep a
      // Sensitive source docs → PRIVATE `documents` bucket (stored as paths, signed on read).
      const sourceMaterials: SourceMaterial[] = [];
      for (const m of ingest.materials) {
        try { const url = await uploadDocument(m.file); sourceMaterials.push({ name: m.name, url, type: m.file.type || m.kind }); } catch { /* non-fatal */ }
      }
      if (sourceMaterials.length) { try { await setEventMaterials(id, sourceMaterials); } catch { /* non-fatal */ } }
      // Cover image → PUBLIC `attachments` bucket (low-sensitivity; displayed directly).
      if (ingest.coverFile) { try { await updateEventCover(id, await uploadAttachment(ingest.coverFile)); } catch { if (ingest.cover) { try { await updateEventCover(id, ingest.cover); } catch { /* non-fatal */ } } } }
      else if (ingest.cover) { try { await updateEventCover(id, ingest.cover); } catch { /* non-fatal */ } }
      if (ingest.owner) { try { const profs = await listProfiles(); const o = ingest.owner.toLowerCase(); const m = profs.find((p) => p.name.toLowerCase() === o) ?? profs.find((p) => p.name.toLowerCase().includes(o) || o.includes(p.name.toLowerCase())); if (m) await addEventOwner(id, m.id); } catch { /* non-fatal */ } }
      if (headNum != null && Number.isFinite(headNum)) { try { await setHeadcount(id, headNum); } catch { /* non-fatal */ } }
      for (const a of ingest.attendees) { try { await addAttendee(id, { name: a.name, email: a.email }); } catch { /* non-fatal */ } }

      // Planning-only: budget lines, deliverables (phased), scoping seed, skip setup if complete.
      if (!isPast) {
        const lines = ingest.budgetLines.filter((l) => l.label.trim());
        if (lines.length) { try { const p = await getEventPlanning(id); if (p?.budget) await addBudgetLines(p.budget.id, lines); } catch { /* non-fatal */ } }
        // Deliverables grouped by phase; offset → due date once a date is set (else resolved later).
        for (const d of ingest.deliverables) {
          const due = (f.date && !asTemplate && d.offsetStart != null) ? (() => { const dt = new Date(f.date + "T00:00:00"); dt.setDate(dt.getDate() + d.offsetStart!); return dt.toISOString().slice(0, 10); })() : null;
          try { await addDeliverable(id, { title: d.title, phase: d.phase, ownerRole: null, dueDate: due, offsetStart: d.offsetStart, offsetEnd: d.offsetEnd }); } catch { /* non-fatal */ }
        }
        saveScoping(id, { ...emptyScoping(), type: joinFormats(f.format) ?? '', audience: f.audience, venue: f.venue, components: f.components.split(',').map((s) => s.trim()).filter(Boolean), strategicJustification: f.justification, headcount: f.headcount, generated: !!ingest.hasBrief });
        const setupCovered = !!f.date && headNum != null && lines.length > 0;
        if (setupCovered) { try { await saveSetupState(id, ['essentials', 'budget', 'timeline'], true); } catch { /* non-fatal */ } }
      }
      onCacheReview?.(ingest); // keep the processed review so it can be reopened without reprocessing
      onCreated(id);
    } catch (e: any) { setCreateError(e.message ?? String(e)); setCreating(false); }
  };

  // Build from a matching template: spin up the template (its walkthrough/phases/vendors/
  // outreach, resolved to the date) and overlay the dropped instance specifics — cover,
  // materials, owner, headcount, attendees, budget — so nothing dropped is lost.
  const buildFromTemplate = async (templateId: string) => {
    if (!ingest) return;
    const f = ingest.fields;
    const headNum = f.headcount.trim() ? Number(f.headcount) : null;
    setCreating(true); setCreateError(null);
    try {
      const id = await spinUpFromTemplate(templateId, { name: f.name.trim() || 'Untitled event', date: f.date || null, location: f.venue.trim() || null, tags: ingest.tag ? [ingest.tag] : [] });
      // Source docs → PRIVATE bucket (paths, signed on read); cover → PUBLIC bucket.
      const sourceMaterials: SourceMaterial[] = [];
      for (const m of ingest.materials) { try { const url = await uploadDocument(m.file); sourceMaterials.push({ name: m.name, url, type: m.file.type || m.kind }); } catch { /* non-fatal */ } }
      if (sourceMaterials.length) { try { await setEventMaterials(id, sourceMaterials); } catch { /* non-fatal */ } }
      if (ingest.coverFile) { try { await updateEventCover(id, await uploadAttachment(ingest.coverFile)); } catch { if (ingest.cover) { try { await updateEventCover(id, ingest.cover); } catch { /* non-fatal */ } } } }
      else if (ingest.cover) { try { await updateEventCover(id, ingest.cover); } catch { /* non-fatal */ } }
      if (ingest.owner) { try { const profs = await listProfiles(); const o = ingest.owner.toLowerCase(); const m = profs.find((p) => p.name.toLowerCase() === o) ?? profs.find((p) => p.name.toLowerCase().includes(o) || o.includes(p.name.toLowerCase())); if (m) await addEventOwner(id, m.id); } catch { /* non-fatal */ } }
      if (headNum != null && Number.isFinite(headNum)) { try { await setHeadcount(id, headNum); } catch { /* non-fatal */ } }
      for (const a of ingest.attendees) { try { await addAttendee(id, { name: a.name, email: a.email }); } catch { /* non-fatal */ } }
      const lines = ingest.budgetLines.filter((l) => l.label.trim());
      if (lines.length) { try { const p = await getEventPlanning(id); if (p?.budget) await addBudgetLines(p.budget.id, lines); } catch { /* non-fatal */ } }
      onCreated(id);
    } catch (e: any) { setCreateError(e.message ?? String(e)); setCreating(false); }
  };
  const patchIngest = (p: Partial<Ingest>) => setIngest((g) => (g ? { ...g, ...p } : g));
  const patchIngestField = (k: keyof IngestFields, v: any) => setIngest((g) => (g ? { ...g, fields: { ...g.fields, [k]: v } } : g));
  // Apply a flag's resolution (merge its field patch) and clear the flag.
  const resolveFlag = (id: string, patch: Partial<IngestFields>) =>
    setIngest((g) => (g ? { ...g, fields: { ...g.fields, ...patch }, flags: g.flags.filter((fl) => fl.id !== id) } : g));
  // Props for a field that may be an open [bracket] slot: show the template's hint as the
  // placeholder and tint it amber while it's still empty, so blanks read as "fill me", not "missing".
  const slotProps = (key: keyof IngestFields, fallback: string, base: string) => {
    const hint = ingest?.slotHints?.[key];
    const empty = !ingest?.fields[key];
    return {
      placeholder: hint ? `e.g. ${hint}` : fallback,
      className: hint && empty ? base.replace('border-gray-300', 'border-amber-300 bg-amber-50/50').replace('border-border', 'border-amber-300 bg-amber-50/50') : base,
    };
  };
  const createBackfill = async () => {
    if (!bf.name.trim() || !bf.date) return;
    setCreating(true); setCreateError(null);
    try {
      const id = await backfillEvent({ name: bf.name.trim(), date: bf.date, location: bf.location.trim() || null, description: bf.description.trim() || null });
      if (bf.lumaUrl.trim()) { try { await attachLuma(id, bf.lumaUrl.trim()); } catch { /* event still created */ } }
      onCreated(id);
    } catch (e: any) { setCreateError(e.message ?? String(e)); setCreating(false); }
  };

  // Rank past events by how much they have filled out — richer events make better starting points.
  const infoScore = (e: EventListItem) =>
    (e.coverImageUrl ? 3 : 0) +
    (e.location ? 1 : 0) +
    (e.date ? 1 : 0) +
    (e.format ? 1 : 0) +
    (e.tags.length ? 1 : 0) +
    (e.attendeeCount != null ? 1 : 0) +
    (e.rsvp != null ? 1 : 0) +
    (e.capacity != null ? 1 : 0) +
    (e.owners.length ? 1 : 0) +
    (e.seriesName ? 1 : 0);
  const templateQuery = templateSearch.trim().toLowerCase();
  const templates = events
    // Reusable Event Types (saved templates) + past events both make good starting points.
    .filter((e) => e.isTemplate || e.status === 'past')
    // Only suggest starting points sharing the tag chosen for this event, so the kind
    // matches. No tag chosen yet → no constraint.
    .filter((e) => !eventTag || e.tags.includes(eventTag))
    .filter((e) => !templateQuery || `${e.title} ${e.location ?? ''} ${e.seriesName ?? ''}`.toLowerCase().includes(templateQuery))
    // Templates first (purpose-built), then richest past events.
    .sort((a, b) => (Number(b.isTemplate) - Number(a.isTemplate)) || (infoScore(b) - infoScore(a)));

  // Whatever the user typed themselves — i.e. the text after our auto-filled spec
  // prefix (or the whole field, if no template is currently applied).
  const userDifferenceText = () =>
    autofilledDesc && description.startsWith(autofilledDesc) ? description.slice(autofilledDesc.length) : description;

  // Click a past event → prefill the description with its specs, then drop whatever
  // the user already typed into the "What's different this time" slot. Re-clicking
  // the same event strips the spec framing but keeps their text.
  const selectTemplate = (t: EventListItem) => {
    const userText = userDifferenceText();
    if (t.id === selected) {
      setSelected(null);
      setDescription(userText);
      setAutofilledDesc('');
      return;
    }
    setSelected(t.id);
    const prefix = templateDescription(t); // ends with "What's different this time: "
    setAutofilledDesc(prefix);
    setDescription(prefix + userText);
  };

  const generate = async () => {
    const desc = description.trim();
    const seed = templates.find((t) => t.id === selected);
    setGenerating(true);
    setGenError(null);
    try {
      const t = await generateTemplate(seed ? `${desc}\n\n(Model it loosely on a past event: ${seed.title})` : desc);
      // Internal events (team socials, company milestones) don't need a marketing/promotion
      // workstream by default — drop it from the drafted workstreams. Still re-addable below.
      const isInternal = audience === 'internal' || (!!eventTag && INTERNAL_TAGS.includes(eventTag));
      if (isInternal) {
        t.progressCategories = t.progressCategories.filter(
          (p) => !/market|promo|advertis|publicity|press|\bPR\b|\bcomms\b/i.test(p),
        );
      }
      setDraft(t);
      // Prefill event details parsed from the description — but never clobber what the user already typed.
      setMeta((m) => ({
        ...m,
        name: m.name.trim() || (t.name ?? ''),
        location: m.location.trim() || (t.location ? canonicalCity(t.location) : ''),
        date: m.date || ensureUpcoming(t.date ?? null) || '',
      }));
    } catch (e: any) {
      setGenError(e.message ?? String(e));
    } finally {
      setGenerating(false);
    }
  };
  const patch = (p: Partial<GeneratedTemplate>) => setDraft((d) => (d ? { ...d, ...p } : d));

  const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes('Files');
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose} onDragOver={(e) => { if (hasFiles(e)) { e.preventDefault(); e.stopPropagation(); } }} onDrop={(e) => { e.preventDefault(); e.stopPropagation(); }}>
      <div
        className="relative bg-white rounded-2xl border border-border max-w-2xl w-full max-h-[85vh] overflow-y-auto p-6"
        onClick={(e) => e.stopPropagation()}
        onDragEnter={(e) => { e.stopPropagation(); if (mode === 'choose' && hasFiles(e)) { e.preventDefault(); dragDepth.current++; setBriefDragOver(true); } }}
        onDragOver={(e) => { e.stopPropagation(); if (hasFiles(e)) e.preventDefault(); }}
        onDragLeave={(e) => { e.stopPropagation(); if (mode === 'choose') { dragDepth.current = Math.max(0, dragDepth.current - 1); if (dragDepth.current === 0) setBriefDragOver(false); } }}
        onDrop={(e) => { e.stopPropagation(); e.preventDefault(); if (mode !== 'choose') return; dragDepth.current = 0; setBriefDragOver(false); void filesFromDrop(e.dataTransfer).then((fs) => { if (fs.length) setPendingDrop(fs); }); }}
      >
        {/* Drop overlay — covers the create popup while dragging files over it. */}
        {mode === 'choose' && briefDragOver && (
          <div className="absolute inset-0 z-20 bg-gray-200/85 border-4 border-dashed border-gray-400 rounded-2xl flex items-center justify-center pointer-events-none">
            <span className="text-lg text-gray-700 inline-flex items-center gap-2"><Plus className="w-5 h-5" /> Drop CSV, brief, or folder to populate</span>
          </div>
        )}
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-2xl">{ingest?.sourceId ? `Review ${ingest.isTemplate ? "template" : "event"}` : "Create event"}</h2>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-900" aria-label="Close"><X className="w-5 h-5" /></button>
        </div>

        {mode === 'processing' ? (
          <div className="py-16 flex flex-col items-center justify-center text-center">
            <div className="w-10 h-10 rounded-full border-2 border-gray-200 border-t-gray-900 animate-spin mb-4" />
            <p className="text-gray-900 font-medium">Reading what you dropped…</p>
            <p className="text-sm text-gray-500 mt-1">Classifying files and pulling out the event details, phases, deliverables, and more. You'll review everything before anything's created.</p>
          </div>
        ) : mode === 'choose' ? (
          <div>
            <p className="text-sm text-gray-600 mb-4">How are you running this event? <span className="text-gray-400">Select one to continue.</span></p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <button onClick={() => setChoice('planning')} className={`border rounded-xl p-6 text-left transition-colors ${choice === 'planning' ? 'border-border bg-gray-100' : 'border-gray-300 hover:bg-gray-50'}`}>
                <p className="text-lg font-medium">We&apos;re planning</p>
                <p className="text-sm text-gray-500 mt-1">InstaLILY is running this event — alone or alongside a co-host.</p>
              </button>
              <button disabled className="border border-gray-200 rounded-xl p-6 text-left opacity-60 cursor-not-allowed">
                <p className="text-lg font-medium">I&apos;m attending</p>
                <p className="text-sm text-gray-500 mt-1">A third party owns it; we attend, exhibit, or sponsor. Coming soon.</p>
              </button>
              <button onClick={() => setChoice('backfill')} className={`border rounded-xl p-6 text-left transition-colors ${choice === 'backfill' ? 'border-border bg-gray-100' : 'border-gray-300 hover:bg-gray-50'}`}>
                <p className="text-lg font-medium">Backfill a past event</p>
                <p className="text-sm text-gray-500 mt-1">Log an event that already happened.</p>
              </button>
            </div>
            <div className="flex items-center justify-between gap-3 mt-6 pt-4 border-t border-gray-100">
              <div className="relative" ref={attachRef}>
                <button
                  type="button"
                  onClick={() => setAttachOpen((o) => !o)}
                  className={`inline-flex items-center gap-2 text-sm rounded-lg border border-dashed px-3 py-2 transition-colors ${pendingDrop ? 'border-green-400 text-green-700 bg-green-50' : 'border-gray-300 text-gray-500 hover:bg-gray-50'}`}
                >
                  {pendingDrop
                    ? <><Check className="w-4 h-4" /> {pendingDrop.length} file{pendingDrop.length === 1 ? '' : 's'} attached</>
                    : <><Plus className="w-4 h-4" /> Drag &amp; drop, or click to add</>}
                  <ChevronDown className="w-3.5 h-3.5 opacity-60" />
                </button>
                {attachOpen && attachPos && createPortal(
                  <div ref={attachMenuRef} style={{ position: "fixed", left: attachPos.left, top: attachPos.top, width: 176 }} className="z-[60] bg-white border border-gray-300 rounded-lg shadow-lg p-1">
                    <button type="button" onClick={() => { setAttachOpen(false); chooseFileRef.current?.click(); }} className="block w-full text-left px-3 py-1.5 rounded text-sm hover:bg-gray-50">Choose files…</button>
                    <button type="button" onClick={() => { setAttachOpen(false); chooseFolderRef.current?.click(); }} className="block w-full text-left px-3 py-1.5 rounded text-sm hover:bg-gray-50">Choose a folder…</button>
                  </div>,
                  document.body,
                )}
                <input ref={chooseFileRef} type="file" multiple hidden onChange={(e) => { const fs = Array.from(e.target.files ?? []); if (fs.length) setPendingDrop(fs); e.target.value = ''; }} />
                <input ref={chooseFolderRef} type="file" hidden {...({ webkitdirectory: '', directory: '' } as any)} onChange={(e) => { const fs = Array.from(e.target.files ?? []); if (fs.length) setPendingDrop(fs); e.target.value = ''; }} />
              </div>
              <div className="flex items-center gap-3">
                {!choice && <span className="text-[15px] text-gray-400">Select an option to continue</span>}
                <Button onClick={continueFromChoose} disabled={!choice} title={!choice ? 'Select how you’re running this event first' : undefined}>Continue <ArrowRight className="w-4 h-4" /></Button>
              </div>
            </div>
          </div>
        ) : mode === 'planFork' ? (
          <div>
            <p className="text-sm text-gray-600 mb-4">Are you planning this alone, or alongside someone else?</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <button onClick={() => { setPlanKind('solo'); setMode('audience'); }} className="border border-border rounded-xl p-6 text-left hover:bg-gray-50 transition-colors">
                <p className="text-lg font-medium">Just us</p>
                <p className="text-sm text-gray-500 mt-1">InstaLILY hosts and covers the cost alone.</p>
              </button>
              <button onClick={() => { setPlanKind('cohost'); setMode('planning'); }} className="border border-border rounded-xl p-6 text-left hover:bg-gray-50 transition-colors">
                <p className="text-lg font-medium">With a co-host</p>
                <p className="text-sm text-gray-500 mt-1">Sharing hosting &amp; cost with another organization.</p>
              </button>
            </div>
            <div className="mt-6 pt-4 border-t border-gray-100">
              <button onClick={() => setMode('choose')} className="text-sm text-gray-600 hover:text-gray-900">← Back</button>
            </div>
          </div>
        ) : mode === 'audience' ? (
          <div>
            <p className="text-sm text-gray-600 mb-4">Is this an internal or external event?</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <button onClick={() => { setAudience('internal'); setEventTag(null); }} className={`border rounded-xl p-6 text-left transition-colors ${audience === 'internal' ? 'border-border ring-2 ring-black' : 'border-border hover:bg-gray-50'}`}>
                <p className="text-lg font-medium">Internal</p>
                <p className="text-sm text-gray-500 mt-1">For our own team — team socials and company milestones.</p>
              </button>
              <button onClick={() => { setAudience('external'); setEventTag(null); }} className={`border rounded-xl p-6 text-left transition-colors ${audience === 'external' ? 'border-border ring-2 ring-black' : 'border-border hover:bg-gray-50'}`}>
                <p className="text-lg font-medium">External</p>
                <p className="text-sm text-gray-500 mt-1">For clients, partners, or the wider community.</p>
              </button>
            </div>

            {audience && (
              <div className="mt-6">
                <h3 className="text-sm font-medium mb-3">Pick a tag</h3>
                <div className="flex flex-wrap gap-2">
                  {(audience === 'internal' ? INTERNAL_TAGS : EXTERNAL_TAGS).map((t) => (
                    <Badge
                      key={t}
                      render={<button type="button" onClick={() => { setEventTag(t); setMode('planning'); }} />}
                      variant={tagBadgeVariant(t)}
                      className={`h-auto cursor-pointer px-3 py-1.5 text-sm transition ${eventTag === t ? 'ring-2 ring-black' : 'hover:opacity-90'}`}
                    >
                      {t}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-6 pt-4 border-t border-gray-100">
              <button onClick={() => { setAudience(null); setEventTag(null); setMode('planFork'); }} className="text-sm text-gray-600 hover:text-gray-900">← Back</button>
            </div>
          </div>
        ) : mode === 'planning' ? (
          <div
            onDragOver={(e) => { if (Array.from(e.dataTransfer.types).includes('Files')) { e.preventDefault(); setBriefDragOver(true); } }}
            onDragLeave={() => setBriefDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setBriefDragOver(false); void filesFromDrop(e.dataTransfer).then((fs) => { if (fs.length) void handleBriefDrop(fs); }); }}
            className={`relative rounded-lg ${briefDragOver ? 'ring-2 ring-gray-400 ring-offset-4' : ''}`}
          >
            <label className="text-sm font-medium block mb-1">Describe the event</label>
            <textarea
              ref={descRef}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Fireside chat & networking for ~120 in Toronto…"
              className="w-full px-3 py-2 border border-border rounded-lg text-sm mb-2 min-h-[5rem] resize-none overflow-hidden transition-[height] duration-150 focus:outline-none focus:ring-2 focus:ring-gray-300"
            />
            <p className="text-[15px] mb-4 text-gray-400">
              …or drop a brief, budget sheet (CSV), or cover image here — or a folder with all three. You'll review everything before anything's created.
            </p>

            <h3 className="text-sm font-medium mb-3">Start from a template or past event <span className="text-gray-400 font-normal">(optional)</span></h3>
            <div className="relative mb-3">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 z-10" />
              <Input
                value={templateSearch}
                onChange={(e) => setTemplateSearch(e.target.value)}
                placeholder="Search templates & past events…"
                className="h-10 w-full pl-9"
              />
            </div>
            {templates.length === 0 ? (
              <p className="text-sm text-gray-400">{templateQuery ? 'No templates or past events match your search.' : 'No templates or past events to start from.'}</p>
            ) : (
              <div className={`grid grid-cols-2 sm:grid-cols-3 gap-3 overflow-y-auto pr-1 transition-[max-height] duration-300 ${descLong ? 'max-h-40' : 'max-h-72'}`}>
                {templates.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => selectTemplate(t)}
                    className={`relative rounded-xl overflow-hidden border text-left h-28 transition ${selected === t.id ? 'border-border ring-2 ring-black' : 'border-gray-200 hover:border-gray-400'}`}
                  >
                    {t.coverImageUrl ? (
                      <img src={t.coverImageUrl} alt="" className="absolute inset-0 w-full h-full object-cover" style={{ objectPosition: t.coverPosition ?? '50% 50%' }} />
                    ) : (
                      <span className="absolute inset-0 bg-gray-200" />
                    )}
                    <span className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/20 to-transparent" />
                    {t.isTemplate && <span className="absolute top-1.5 left-1.5 text-[13px] uppercase tracking-wide font-medium text-gray-900 bg-white/90 rounded px-1.5 py-0.5">Template</span>}
                    <span className="absolute bottom-2 left-2 right-2 text-white text-[15px] font-medium line-clamp-2">{t.title}</span>
                  </button>
                ))}
              </div>
            )}

            {!draft ? (
              <div className="mt-6">
                {genError && <p className="text-red-600 text-sm mb-2">{genError}</p>}
                <button
                  onClick={generate}
                  disabled={!description.trim() || generating}
                  className="px-4 py-2 bg-gray-200 text-black rounded-lg text-sm hover:bg-gray-300 disabled:opacity-50 transition-colors"
                >
                  {generating ? 'Generating template…' : 'Generate draft template'}
                </button>
                <p className="text-[15px] text-gray-400 mt-2">Claude drafts vendor categories{planKind === 'cohost' ? ', a budget make-up,' : ''} and progress workstreams — all editable before you create.</p>
              </div>
            ) : (
              <div className="mt-6 space-y-6">
                <div>
                  <h3 className="text-sm font-medium mb-2">Event details</h3>
                  <input
                    value={meta.name}
                    onChange={(e) => setMeta({ ...meta, name: e.target.value })}
                    placeholder="Event name (required)"
                    className="w-full mb-2 px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-300"
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <input type="date" value={meta.date} onChange={(e) => setMeta({ ...meta, date: e.target.value })} className="px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
                    <span className="inline-flex items-center gap-1 text-sm text-gray-500">
                      <input type="time" value={meta.startTime} onChange={(e) => setMeta({ ...meta, startTime: e.target.value })} title="Start time" className="px-2 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
                      <span>–</span>
                      <input type="time" value={meta.endTime} onChange={(e) => setMeta({ ...meta, endTime: e.target.value })} title="End time" className="px-2 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
                    </span>
                    <LocationInput value={meta.location} onChange={(v) => setMeta({ ...meta, location: v })} style={{ width: `${Math.max(10, meta.location.length + 2)}ch` }} className="px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
                    <FormatPicker value={formats} onChange={(arr) => { setFormats(arr); setFormatTouched(true); }} />
                  </div>
                  <input value={meta.lumaUrl} onChange={(e) => setMeta({ ...meta, lumaUrl: e.target.value })} placeholder="Luma link (optional) — add now or later" className="w-full mt-2 px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
                  {planKind === 'cohost' && (
                    <input value={meta.coHost} onChange={(e) => setMeta({ ...meta, coHost: e.target.value })} placeholder="Co-host organization (optional)" className="w-full mt-2 px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
                  )}
                </div>
                <div>
                  <h3 className="text-sm font-medium mb-2">Vendor categories</h3>
                  <ChipEditor items={draft.vendorCategories} onChange={(v) => patch({ vendorCategories: v })} placeholder="Add category" />
                </div>

                {/* Budget make-up is set up later on the planning dashboard (Review budget /
                    Budget tab), where it can be dropped in as an exact breakdown. */}

                <div>
                  <h3 className="text-sm font-medium mb-2">Progress workstreams</h3>
                  <ChipEditor items={draft.progressCategories} onChange={(v) => patch({ progressCategories: v })} placeholder="Add workstream" />
                </div>
              </div>
            )}

            {createError && <p className="text-red-600 text-sm mt-4">{createError}</p>}
            <div className="flex items-center justify-between mt-6 pt-4 border-t border-gray-100">
              <button onClick={() => (draft ? setDraft(null) : setMode(planKind === 'solo' ? 'audience' : 'planFork'))} className="text-sm text-gray-600 hover:text-gray-900">← Back</button>
              <Button
                variant="secondary"
                onClick={createPlanned}
                disabled={creating || (!meta.name.trim() && !description.trim())}
                title={draft ? 'Creates the event and opens its planning dashboard' : 'Skips the draft and creates the event — flesh it out on the dashboard'}
              >
                {creating ? 'Creating…' : draft ? 'Create event' : 'Skip & create event'}
              </Button>
            </div>
          </div>
        ) : mode === 'review' && ingest ? (
          <div className="space-y-5">
            {pastHint !== null && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 flex items-center gap-3 flex-wrap">
                <AlertCircle className="w-4 h-4 text-amber-700 shrink-0" />
                <p className="text-sm text-amber-900 flex-1 min-w-0">This looks like a <span className="font-medium">past event</span>{ingest.fields.date ? ` (${ingest.fields.date})` : ""}. Backfilling records what happened and updates the template — a different flow than creating a new one.</p>
                <button onClick={() => onBackfill(pastHint || undefined, ingest?.materials?.map((m) => m.file))} className="shrink-0 px-3 py-1.5 rounded-lg bg-gray-900 text-white text-sm hover:bg-black">Switch to backfill</button>
                <button onClick={() => setPastHint(null)} className="shrink-0 text-sm text-gray-600 hover:text-gray-900">It's upcoming</button>
              </div>
            )}
            <div className="rounded-lg bg-gray-900 text-white px-3 py-2.5 text-sm flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <span className="text-gray-300">Save as</span>
                <div className="inline-flex rounded-lg bg-gray-700 p-0.5">
                  <button onClick={() => patchIngest({ isTemplate: false })} className={`px-2.5 py-1 rounded-md text-[15px] ${!ingest.isTemplate ? 'bg-white text-gray-900' : 'text-gray-300 hover:text-white'}`}>Event</button>
                  <button onClick={() => patchIngest({ isTemplate: true })} className={`px-2.5 py-1 rounded-md text-[15px] ${ingest.isTemplate ? 'bg-white text-gray-900' : 'text-gray-300 hover:text-white'}`}>Template</button>
                </div>
              </div>
              <span className="text-[15px] text-gray-300">
                {ingest.isTemplate
                  ? "Reusable Event Type — date dropped, structure kept for next time"
                  : (ingest.fields.date && ingest.fields.date < new Date().toISOString().slice(0, 10) ? "Past date → backfilled as a completed event" : "A concrete event you're planning")}
              </span>
            </div>
            <p className="text-sm text-gray-500">Review everything pulled from what you dropped. Edit anything — nothing's created until you confirm.</p>

            {ingest.warnings.length > 0 && (
              <div className="text-sm bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-3 py-2 space-y-1">
                {ingest.warnings.map((w, i) => <p key={i} className="inline-flex items-start gap-1.5"><AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /> {w}</p>)}
              </div>
            )}

            {/* Clear template match → suggest building from it (gated like the create flow). */}
            {!ingest.isTemplate && ingest.tag && (() => {
              const tag = ingest.tag;
              const cands = events.filter((e) => e.isTemplate && e.tags.includes(tag));
              if (cands.length === 0) return null;
              const fmt = ingest.fields.format[0];
              const match = (fmt ? cands.find((e) => parseFormats(e.format).includes(fmt)) : null) ?? cands[0];
              const blocked = creating || !ingest.fields.name.trim() || !!ingest.conflict;
              const blockHint = ingest.conflict ? "Resolve the budget conflict below first." : !ingest.fields.name.trim() ? "Add an event name first." : null;
              return (
                <div className="rounded-xl border border-violet-200 bg-violet-50 px-4 py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-violet-900 inline-flex items-center gap-1.5"><Sparkles className="w-4 h-4" /> Looks like your “{match.title}” template</p>
                    <p className="text-[15px] text-violet-800 mt-0.5">Build from it to reuse its walkthrough, phases, vendors &amp; outreach — your dropped details fill in.{blockHint && <span className="text-amber-700"> {blockHint}</span>}</p>
                  </div>
                  <button onClick={() => buildFromTemplate(match.id)} disabled={blocked} title={blockHint ?? undefined} className="shrink-0 px-3 py-2 bg-violet-700 text-white rounded-lg text-sm hover:bg-violet-800 disabled:opacity-50 disabled:cursor-not-allowed">{creating ? "Building…" : "Build from template"}</button>
                </div>
              );
            })()}

            {/* Soft conflicts — disagreeing sources, surfaced with one-click resolutions. */}
            {ingest.flags.map((fl) => (
              <div key={fl.id} className="text-sm bg-orange-50 border border-orange-200 text-orange-900 rounded-lg px-3 py-2 flex flex-wrap items-center gap-x-3 gap-y-2">
                <span className="inline-flex items-start gap-1.5 flex-1 min-w-[12rem]"><AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /> {fl.message}</span>
                {fl.actions?.map((a, j) => (
                  <button key={j} onClick={() => resolveFlag(fl.id, a.patch)} className="px-2.5 py-1 bg-white border border-orange-300 rounded text-[15px] hover:bg-orange-100 whitespace-nowrap">{a.label}</button>
                ))}
              </div>
            ))}

            {/* Event details — from the brief */}
            <div className="rounded-xl border border-gray-200 p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-medium">Event details</h3>
                <span className="text-[13px] uppercase tracking-wide text-gray-400 bg-gray-100 rounded px-1.5 py-0.5">{ingest.hasBrief ? 'from brief' : 'no brief — fill in'}</span>
              </div>
              <input value={ingest.fields.name} onChange={(e) => patchIngestField('name', e.target.value)} {...slotProps('name', 'Event name', 'w-full mb-2 px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-300')} />
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <span className="text-sm text-gray-600">Tag<span className="text-amber-500"> *</span></span>
                <TagStack tags={ingest.tag ? [ingest.tag] : []} editable onChange={(arr) => patchIngest({ tag: arr[0] ?? null })} />
                {!ingest.tag && <span className="text-[15px] text-amber-600">pick one to continue</span>}
              </div>
              <div className="flex flex-wrap items-center gap-2 mb-2">
                {/* Templates are date-less by definition — only a real event gets a date. Time stays optional. */}
                {!ingest.isTemplate && (
                  <input type="date" value={ingest.fields.date} onChange={(e) => patchIngestField('date', e.target.value)} className="px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
                )}
                <input type="time" value={ingest.fields.startTime} onChange={(e) => patchIngestField('startTime', e.target.value)} className="px-2 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
                <span className="text-gray-400">–</span>
                <input type="time" value={ingest.fields.endTime} onChange={(e) => patchIngestField('endTime', e.target.value)} className="px-2 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
                <FormatPicker value={ingest.fields.format} onChange={(arr) => patchIngestField('format', arr)} />
              </div>
              {!ingest.isTemplate && ingest.fields.date && (
                <p className="text-[15px] text-gray-400 mb-1">{ingest.fields.date < new Date().toISOString().slice(0, 10) ? "Past date → will be logged as a backfilled event." : "Upcoming → will be created as a planning event."}</p>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-2">
                <input value={ingest.fields.venue} onChange={(e) => patchIngestField('venue', e.target.value)} {...slotProps('venue', 'Venue / location', 'px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-300')} />
                <input value={ingest.fields.audience} onChange={(e) => patchIngestField('audience', e.target.value)} {...slotProps('audience', 'Audience', 'px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-300')} />
                <input value={ingest.fields.headcount} onChange={(e) => patchIngestField('headcount', e.target.value)} {...slotProps('headcount', 'Headcount', 'px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-300')} />
              </div>
              <textarea value={ingest.fields.justification} onChange={(e) => patchIngestField('justification', e.target.value)} rows={2} {...slotProps('justification', 'Strategic justification (feeds the scoping form)', 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-gray-300')} />
            </div>

            {/* Phases & deliverables — timeline from the brief's sections */}
            {ingest.phases.length > 0 && (
              <div className="rounded-xl border border-gray-200 p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-medium">Phases &amp; deliverables <span className="text-gray-400 font-normal text-sm">· {ingest.deliverables.length} on the timeline</span></h3>
                  <span className="text-[13px] uppercase tracking-wide text-amber-700 bg-amber-100 rounded px-1.5 py-0.5">from brief · inferred</span>
                </div>
                {(() => {
                  // Same hollow-dot rail as the template page: phases evenly spaced, each with
                  // its range from the timed deliverables in that phase (untimed ones still list below).
                  const railPhases = ingest.phases.map((ph, i) => {
                    const offs = ingest.deliverables
                      .filter((d) => d.phase === ph.name && d.offsetStart != null)
                      .flatMap((d) => [d.offsetStart, d.offsetEnd ?? d.offsetStart])
                      .filter((n): n is number => n != null);
                    return { name: ph.name, order: ph.order, color: PHASE_COLORS[i % PHASE_COLORS.length], start: offs.length ? Math.min(...offs) : null, end: offs.length ? Math.max(...offs) : null };
                  });
                  return <div className="mb-3"><PhaseRail phases={railPhases} /></div>;
                })()}
                <div className="space-y-2">
                  {ingest.phases.map((ph) => {
                    const ds = ingest.deliverables.map((d, i) => ({ d, i })).filter(({ d }) => d.phase === ph.name);
                    return (
                      <div key={ph.name}>
                        <p className="text-[15px] font-medium text-gray-700">{ph.name}</p>
                        {ds.length === 0 ? <p className="text-[15px] text-gray-300 pl-2">no dated tasks</p> : ds.map(({ d, i }) => (
                          <div key={i} className="pl-2 py-0.5">
                            <div className="flex items-center gap-2 text-sm">
                              <span className="text-[13px] text-gray-400 w-20 shrink-0">{offLabel(d)}</span>
                              <span className="flex-1 truncate">{d.title}</span>
                              <button onClick={() => patchIngest({ deliverables: ingest.deliverables.filter((_, j) => j !== i) })} className="text-gray-300 hover:text-red-600"><X className="w-3.5 h-3.5" /></button>
                            </div>
                            {d.original && <p className="pl-[88px] text-[11px] text-gray-400 italic truncate" title={d.original}>generalized · was: {d.original}</p>}
                          </div>
                        ))}
                      </div>
                    );
                  })}
                </div>
                {ingest.isTemplate && ingest.droppedForTemplate.length > 0 && (
                  <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                    <p className="text-[13px] font-medium text-gray-600 mb-1">Dropped as too event-specific · {ingest.droppedForTemplate.length}</p>
                    <ul className="space-y-0.5">
                      {ingest.droppedForTemplate.map((x, i) => (
                        <li key={i} className="text-[12px] text-gray-500"><span className="line-through">{x.title}</span> <span className="text-gray-400">— {x.reason}</span></li>
                      ))}
                    </ul>
                  </div>
                )}
                <p className="text-[15px] text-gray-400 mt-2">{ingest.isTemplate ? "Template mode: names/clients stripped (role captured in staff), each task phased by function. " : ""}Offsets (and ranges) are saved with each deliverable and resolve to dates once the event date is set.</p>
              </div>
            )}

            {/* Budget — rough cost, never the assigned target */}
            <div className="rounded-xl border border-gray-200 p-4">
              <div className="flex items-center justify-between mb-1">
                <h3 className="font-medium">Budget <span className="text-gray-400 font-normal text-sm">· rough cost (scoping input)</span></h3>
                {ingest.budgetSource && <span className={`text-[13px] uppercase tracking-wide rounded px-1.5 py-0.5 ${ingest.budgetLowConfidence ? 'bg-amber-100 text-amber-700' : 'text-gray-400 bg-gray-100'}`}>{ingest.budgetSource === 'file' ? 'from budget file' : 'from brief · low confidence'}</span>}
              </div>
              <p className="text-[15px] text-gray-400 mb-3">Not the assigned budget — Karim's locked target is set later in the scoping flow.</p>

              {ingest.conflict ? (
                <div className="text-sm bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-3 py-2">
                  Conflict — the brief says <b>${ingest.conflict.brief.toLocaleString()}</b> but the budget file totals <b>${ingest.conflict.file.toLocaleString()}</b>. Pick the source of truth (I won't merge them):
                  <span className="flex flex-wrap gap-2 mt-2">
                    <button onClick={() => patchIngest({ budgetLines: ingest.conflict!.fileLines, budgetSource: 'file', budgetLowConfidence: false, conflict: null })} className="px-2.5 py-1 bg-gray-200 rounded text-[15px] hover:bg-gray-300">Use budget file (${ingest.conflict.file.toLocaleString()})</button>
                    <button onClick={() => patchIngest({ budgetLines: ingest.conflict!.briefLines, budgetSource: 'brief', budgetLowConfidence: true, conflict: null })} className="px-2.5 py-1 bg-gray-200 rounded text-[15px] hover:bg-gray-300">Use brief (${ingest.conflict.brief.toLocaleString()})</button>
                  </span>
                </div>
              ) : ingest.budgetLines.length === 0 ? (
                <p className="text-sm text-gray-400">No budget detected — add lines on the Budget tab later.</p>
              ) : (
                <div className="space-y-1.5">
                  {ingest.budgetLines.map((l, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <input value={l.label} onChange={(e) => patchIngest({ budgetLines: ingest.budgetLines.map((x, j) => j === i ? { ...x, label: e.target.value } : x) })} className="flex-1 px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
                      <input type="number" value={l.amount ?? ''} onChange={(e) => patchIngest({ budgetLines: ingest.budgetLines.map((x, j) => j === i ? { ...x, amount: e.target.value === '' ? null : Number(e.target.value) } : x) })} className="w-28 px-2 py-1 border border-gray-300 rounded text-right text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
                      <button onClick={() => patchIngest({ budgetLines: ingest.budgetLines.filter((_, j) => j !== i) })} className="text-gray-300 hover:text-red-600"><X className="w-4 h-4" /></button>
                    </div>
                  ))}
                  <p className="text-sm text-gray-500 text-right pt-1">Total: ${ingest.budgetLines.reduce((s, l) => s + (l.amount ?? 0), 0).toLocaleString()}</p>
                </div>
              )}
            </div>

            {/* Vendors & venues — seed vendor decisions on create */}
            {ingest.vendors.length > 0 && (
              <div className="rounded-xl border border-gray-200 p-4">
                <div className="flex items-center justify-between mb-2"><h3 className="font-medium">Vendors &amp; venues</h3><span className="text-[13px] uppercase tracking-wide text-amber-700 bg-amber-100 rounded px-1.5 py-0.5">from brief · seeds vendor decisions</span></div>
                <ChipEditor items={ingest.vendors} onChange={(v) => patchIngest({ vendors: v })} placeholder="Add category" />
              </div>
            )}

            {/* Staff roles — the role, not a name */}
            {ingest.staff.length > 0 && (
              <div className="rounded-xl border border-gray-200 p-4">
                <div className="flex items-center justify-between mb-2"><h3 className="font-medium">Staff roles</h3><span className="text-[13px] uppercase tracking-wide text-gray-500 bg-gray-100 rounded px-1.5 py-0.5">from brief · saved to staffing</span></div>
                <ChipEditor items={ingest.staff} onChange={(v) => patchIngest({ staff: v })} placeholder="Add role" />
              </div>
            )}

            {/* Agenda — run-of-show */}
            {ingest.agenda.length > 0 && (
              <div className="rounded-xl border border-gray-200 p-4">
                <div className="flex items-center justify-between mb-2"><h3 className="font-medium">Agenda <span className="text-gray-400 font-normal text-sm">· run-of-show</span></h3><span className="text-[13px] uppercase tracking-wide text-gray-500 bg-gray-100 rounded px-1.5 py-0.5">from brief · saved to run of show</span></div>
                <div className="rounded-lg border border-gray-100 divide-y divide-gray-100">
                  {ingest.agenda.map((a, i) => (
                    <div key={i} className="px-3 py-1.5 text-sm flex items-center gap-3">
                      <span className="text-gray-500 w-16 shrink-0">{a.time}</span><span className="flex-1 truncate">{a.title}</span>
                      <button onClick={() => patchIngest({ agenda: ingest.agenda.filter((_, j) => j !== i) })} className="text-gray-300 hover:text-red-600"><X className="w-3.5 h-3.5" /></button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Reflections / guardrails */}
            {ingest.reflections.length > 0 && (
              <div className="rounded-xl border border-gray-200 p-4">
                <div className="flex items-center justify-between mb-2"><h3 className="font-medium">Learnings</h3><span className="text-[13px] uppercase tracking-wide text-gray-500 bg-gray-100 rounded px-1.5 py-0.5">from brief · saved to learnings</span></div>
                <ul className="space-y-1 text-sm">
                  {ingest.reflections.map((r, i) => (
                    <li key={i} className="flex items-start gap-2"><span className="text-gray-300 mt-0.5">•</span><span className="flex-1">{r}</span><button onClick={() => patchIngest({ reflections: ingest.reflections.filter((_, j) => j !== i) })} className="text-gray-300 hover:text-red-600 shrink-0"><X className="w-3.5 h-3.5" /></button></li>
                  ))}
                </ul>
              </div>
            )}

            {/* Attendees — from a name/email spreadsheet */}
            {ingest.attendees.length > 0 && (
              <div className="rounded-xl border border-gray-200 p-4">
                <div className="flex items-center justify-between mb-2"><h3 className="font-medium">Attendees <span className="text-gray-400 font-normal text-sm">· {ingest.attendees.length}</span></h3><span className="text-[13px] uppercase tracking-wide text-gray-400 bg-gray-100 rounded px-1.5 py-0.5">from list</span></div>
                <div className="max-h-40 overflow-y-auto rounded-lg border border-gray-100 divide-y divide-gray-100">
                  {ingest.attendees.slice(0, 50).map((a, i) => (
                    <div key={i} className="px-3 py-1.5 text-sm flex items-center justify-between gap-2">
                      <span className="truncate">{a.name}</span>
                      {a.email && <span className="text-gray-400 text-[15px] truncate">{a.email}</span>}
                    </div>
                  ))}
                </div>
                <p className="text-[15px] text-gray-400 mt-1">Added to the event's People on create.{ingest.attendees.length > 50 ? ` (showing 50 of ${ingest.attendees.length})` : ""}</p>
              </div>
            )}

            {/* Unsorted — couldn't classify; never guessed */}
            {ingest.unsorted.length > 0 && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                <h3 className="font-medium text-amber-800 mb-1">Unsorted</h3>
                <p className="text-sm text-amber-700">Couldn't classify {ingest.unsorted.join(", ")} — left out. Re-drop as a brief, budget, attendee list, or cover if it should be included.</p>
              </div>
            )}

            {/* Cover */}
            {ingest.cover && (
              <div className="rounded-xl border border-gray-200 p-4">
                <div className="flex items-center justify-between mb-3"><h3 className="font-medium">Cover</h3><span className="text-[13px] uppercase tracking-wide text-gray-400 bg-gray-100 rounded px-1.5 py-0.5">from image</span></div>
                <div className="flex items-center gap-3">
                  <img src={ingest.cover} alt="" className="h-20 w-32 object-cover rounded-lg border border-gray-200" />
                  <button onClick={() => patchIngest({ cover: null, coverFile: null })} className="text-sm text-gray-500 hover:text-red-600">Remove</button>
                </div>
              </div>
            )}

            {createError && <p className="text-red-600 text-sm">{createError}</p>}
            {(() => {
              // Same gates as the normal create flow: tag required, name required, no unresolved conflict.
              const blocked = creating || !ingest.fields.name.trim() || !ingest.tag || !!ingest.conflict;
              const blockTitle = ingest.conflict ? 'Resolve the budget conflict first' : !ingest.tag ? 'Pick a tag first' : !ingest.fields.name.trim() ? 'Add an event name first' : undefined;
              // A clear template match (same tag, format as a tiebreaker) → offer "Build from template" beside Create.
              const tag = ingest.tag;
              const cands = !ingest.isTemplate && !ingest.sourceId && tag ? events.filter((e) => e.isTemplate && e.tags.includes(tag)) : [];
              const fmt = ingest.fields.format[0];
              const match = cands.length ? ((fmt ? cands.find((e) => parseFormats(e.format).includes(fmt)) : null) ?? cands[0]) : null;
              return (
                <div className="flex items-center justify-between gap-3 pt-2 border-t border-gray-100">
                  <button onClick={() => { setIngest(null); setChoice(null); setMode('choose'); }} className="text-sm text-gray-600 hover:text-gray-900">← Back</button>
                  <div className="flex items-center gap-3">
                    {ingest.conflict
                      ? <span className="text-[15px] text-amber-700 inline-flex items-center gap-1"><AlertCircle className="w-3.5 h-3.5" /> Resolve the budget conflict above to continue</span>
                      : !ingest.tag ? <span className="text-[15px] text-amber-600 inline-flex items-center gap-1"><AlertCircle className="w-3.5 h-3.5" /> Pick a tag to continue</span>
                      : !ingest.fields.name.trim() ? <span className="text-[15px] text-gray-400">Add an event name to continue</span> : null}
                    {match && (
                      <button onClick={() => buildFromTemplate(match.id)} disabled={blocked} title={blockTitle ?? `Build from your “${match.title}” template`} className="inline-flex items-center gap-1.5 px-3 py-2 bg-white border border-violet-300 text-violet-800 rounded-lg text-sm hover:bg-violet-50 disabled:opacity-50 disabled:cursor-not-allowed">
                        <Sparkles className="w-4 h-4" /> {creating ? 'Building…' : `Build from “${match.title}”`}
                      </button>
                    )}
                    <Button onClick={createFromIngest} disabled={blocked} title={blockTitle}>{ingest.sourceId ? (creating ? 'Saving…' : 'Save') : creating ? 'Creating…' : ingest.isTemplate ? 'Save as template' : 'Create event'}</Button>
                  </div>
                </div>
              );
            })()}
          </div>
        ) : (
          <div>
            <h3 className="text-sm font-medium mb-3">Backfill a past event</h3>
            <div className="space-y-3">
              <input
                value={bf.name}
                onChange={(e) => setBf({ ...bf, name: e.target.value })}
                placeholder="Event name"
                className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-300"
              />
              <div className="flex flex-wrap gap-3">
                <input
                  type="date"
                  value={bf.date}
                  onChange={(e) => setBf({ ...bf, date: e.target.value })}
                  className="px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-300"
                />
                <LocationInput
                  value={bf.location}
                  onChange={(v) => setBf({ ...bf, location: v })}
                  style={{ width: `${Math.max(10, bf.location.length + 2)}ch` }}
                  className="px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-300"
                />
              </div>
              <input
                value={bf.lumaUrl}
                onChange={(e) => setBf({ ...bf, lumaUrl: e.target.value })}
                placeholder="Luma link (optional) — add now or later"
                className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-300"
              />
              <textarea
                rows={2}
                value={bf.description}
                onChange={(e) => setBf({ ...bf, description: e.target.value })}
                placeholder="What happened? (optional)"
                className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-300"
              />
            </div>
            <p className="text-[15px] text-gray-400 mt-2">A past event you can attach a Luma link to later to pull its guest list.</p>
            {createError && <p className="text-red-600 text-sm mt-3">{createError}</p>}
            <div className="flex items-center justify-between mt-6 pt-4 border-t border-gray-100">
              <button onClick={() => setMode('choose')} className="text-sm text-gray-600 hover:text-gray-900">← Back</button>
              <Button
                variant="secondary"
                onClick={createBackfill}
                disabled={!bf.name.trim() || !bf.date || creating}
              >
                {creating ? 'Creating…' : 'Create event'}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function EventsPage({ selectedEventId, setSelectedEventId, onViewPeople, openCreate = false, initialFiles = null, looksPast = false, onFilesConsumed }: EventsPageProps) {
  const [events, setEvents] = useState<EventListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [bookmarkedEvents, setBookmarkedEvents] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<'cards' | 'lines' | 'calendar'>('cards');
  const [statusFilter, setStatusFilter] = useState<EventStatus | 'all' | 'templates'>('all');
  const [locationFilter, setLocationFilter] = useState<string>('all');
  const [ownerFilter, setOwnerFilter] = useState<string>('all');
  const [tagFilter, setTagFilter] = useState<string>('all');
  const [formatFilter, setFormatFilter] = useState<string>('all');
  const [showBookmarkedOnly, setShowBookmarkedOnly] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [dateRange, setDateRange] = useState<'all' | 'week' | 'month' | '3months' | 'year' | 'custom'>('all');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [createOpen, setCreateOpen] = useState(openCreate);
  const [backfillOpen, setBackfillOpen] = useState(false);
  const [backfillText, setBackfillText] = useState<string | undefined>(undefined); // handed from a past-event drop
  const [backfillFiles, setBackfillFiles] = useState<File[] | null>(null); // the dropped file(s) → tagged on the record
  // A global drop that sniffed as a past event → ask (backfill vs in-process) before routing.
  const [pastChooser, setPastChooser] = useState<File[] | null>(null);
  useEffect(() => { if (looksPast && initialFiles?.length) setPastChooser(initialFiles); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  const chooseBackfill = async () => {
    const files = pastChooser ?? []; setPastChooser(null);
    const c = await Promise.all(files.map(classifyDropFile));
    const text = c.find((x) => x.kind === "brief")?.text ?? (await files[0]?.text().catch(() => "")) ?? "";
    setBackfillText(text || undefined); setBackfillFiles(files.length ? files : null); setBackfillOpen(true); onFilesConsumed?.();
  };
  const chooseInProcess = () => { setPastChooser(null); setCreateOpen(true); }; // create modal consumes initialFiles
  // The last processed review, kept so the just-generated event can return to its
  // generation/review page without re-running the brief. `resumeIngest` (when set on
  // re-open) lands the create modal straight back on that review.
  const [reviewCache, setReviewCache] = useState<{ ingest: Ingest; eventId: string } | null>(null);
  const [resumeIngest, setResumeIngest] = useState<Ingest | null>(null);
  const pendingReview = useRef<Ingest | null>(null);
  // Open the create modal fresh (clears any resume state) — used by every "Create Event" button.
  const openCreateFresh = () => { setResumeIngest(null); setCreateOpen(true); };
  // Reopen the review/generation page for an already-saved event or template — rebuilt from
  // its stored data, no reprocessing. (From the review you can edit and re-save as new.)
  const openReviewForEvent = async (id: string) => {
    try {
      const p = await getEventPlanning(id);
      if (!p) return;
      setResumeIngest(ingestFromPlan(p));
      setSelectedEventId(null);
      setCreateOpen(true);
    } catch { /* ignore */ }
  };

  // Luma attach UI: which card's input is open, its value, busy/error state.
  const [lumaEditingId, setLumaEditingId] = useState<string | null>(null);
  const [lumaInput, setLumaInput] = useState('');
  const [lumaBusy, setLumaBusy] = useState(false);
  const [lumaError, setLumaError] = useState<string | null>(null);

  // Delete UI: the event awaiting a delete confirmation.
  const [deleteTarget, setDeleteTarget] = useState<EventListItem | null>(null);
  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const id = deleteTarget.id;
    setEvents((prev) => prev.filter((e) => e.id !== id)); // optimistic
    try {
      await deleteEvent(id);
    } catch (e: any) {
      setError(e.message ?? String(e));
      await load(); // revert to server truth on failure
    }
  };

  // Tag edit UI: which card's tag dropdown is open.
  const setTags = async (eventId: string, tags: string[]) => {
    // optimistic update, then persist
    setEvents((prev) => prev.map((e) => (e.id === eventId ? { ...e, tags } : e)));
    try {
      await updateEventTags(eventId, tags);
    } catch {
      await load(); // revert to server truth on failure
    }
  };

  const setFormatValue = async (eventId: string, format: string | null) => {
    setEvents((prev) => prev.map((e) => (e.id === eventId ? { ...e, format } : e)));
    try { await setEventFormat(eventId, format); } catch { await load(); }
  };

  const load = () =>
    listEvents()
      .then(setEvents)
      .catch((e) => setError(e.message ?? String(e)))
      .finally(() => setLoading(false));

  // Reload on mount and whenever we return from an event view, so edits made inside an
  // event (e.g. formats) are reflected on its card.
  useEffect(() => { void load(); }, [selectedEventId]);
  // Refresh when the create modal opens so its "start from a past event" grid is current
  // (e.g. an event deleted from a card shouldn't linger as a template).
  useEffect(() => { if (createOpen) void load(); }, [createOpen]);

  const submitLuma = async (eventId: string) => {
    setLumaBusy(true);
    setLumaError(null);
    try {
      await attachLuma(eventId, lumaInput.trim());
      setLumaEditingId(null);
      setLumaInput('');
      await load();
    } catch (e: any) {
      setLumaError(e.message ?? String(e));
    } finally {
      setLumaBusy(false);
    }
  };

  const toggleBookmark = (eventId: string) => {
    setBookmarkedEvents((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(eventId)) newSet.delete(eventId);
      else newSet.add(eventId);
      return newSet;
    });
  };

  const locations = Array.from(new Set(events.map(e => e.location).filter(Boolean))) as string[];
  // Distinct individual owners (not the joined string) so the filter lists each person once.
  const owners = Array.from(new Set(events.flatMap(e => e.owners.map(o => o.name)))).sort((a, b) => a.localeCompare(b));
  // Distinct formats across events (each event may carry several joined formats).
  const formatOptions = Array.from(new Set(events.flatMap(e => parseFormats(e.format ?? "")))).filter(Boolean).sort((a, b) => a.localeCompare(b));

  // Date filtering applies to Past / All only (not Future or In-Process).
  const showDateFilter = statusFilter === 'past' || statusFilter === 'all';
  let dateFrom: string | null = null;
  let dateTo: string | null = null;
  if (showDateFilter) {
    if (dateRange === 'custom') {
      dateFrom = customStart || null;
      dateTo = customEnd || null;
    } else if (dateRange !== 'all') {
      const days = { week: 7, month: 30, '3months': 90, year: 365 }[dateRange];
      const t = new Date();
      const c = new Date(t);
      c.setDate(c.getDate() - days);
      dateFrom = c.toISOString().slice(0, 10);
      dateTo = t.toISOString().slice(0, 10);
    }
  }

  const filteredEvents = events.filter(event => {
    // The Templates tab shows only templates; every other view excludes them.
    const tmplView = statusFilter === 'templates';
    if (tmplView ? !event.isTemplate : event.isTemplate) return false;
    if (!tmplView && statusFilter !== 'all' && event.status !== statusFilter) return false;
    if (locationFilter !== 'all' && event.location !== locationFilter) return false;
    if (ownerFilter !== 'all' && !event.owners.some(o => o.name === ownerFilter)) return false;
    if (tagFilter !== 'all' && !event.tags.includes(tagFilter)) return false;
    if (formatFilter !== 'all' && !parseFormats(event.format ?? "").includes(formatFilter)) return false;
    if (showBookmarkedOnly && !bookmarkedEvents.has(event.id)) return false;
    if (dateFrom && (!event.date || event.date < dateFrom)) return false;
    if (dateTo && (!event.date || event.date > dateTo)) return false;
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      const hay = `${event.title} ${event.seriesName ?? ''} ${event.tags.join(' ')} ${event.location ?? ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }).sort((a, b) => {
    // Future: soonest first. Past / All: most recent first. Undated last.
    const ad = a.date ?? '', bd = b.date ?? '';
    if (!ad && !bd) return 0;
    if (!ad) return 1;
    if (!bd) return -1;
    return statusFilter === 'future' ? ad.localeCompare(bd) : bd.localeCompare(ad);
  });

  if (selectedEventId !== null) {
    // Events we're actively planning (macro_stage set) open the planning view;
    // everything else opens the post-hoc recap view.
    const sel = events.find((e) => e.id === selectedEventId);
    // If this event was just generated from a brief, Back returns to its review/generation
    // page (reopened from cache — no reprocessing); otherwise Back goes to the list.
    const onBack = () => {
      if (reviewCache && reviewCache.eventId === selectedEventId) {
        setSelectedEventId(null);
        setResumeIngest(reviewCache.ingest);
        setCreateOpen(true);
      } else {
        setSelectedEventId(null);
      }
    };
    return sel?.macroStage != null ? (
      <EventPlanningPage eventId={selectedEventId} onBack={onBack} onViewPeople={onViewPeople} onOpenEvent={(id) => setSelectedEventId(id)} onReview={() => openReviewForEvent(selectedEventId)} />
    ) : (
      <EventDetailPage eventId={selectedEventId} onBack={onBack} onViewPeople={onViewPeople} />
    );
  }

  return (
    <div>
      {/* Status Tabs */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex gap-2">
          {(['future', 'in-process', 'past', 'all', 'templates'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-2 py-1 rounded-lg transition-colors ${
                statusFilter === s
                  ? 'bg-gray-200 text-black'
                  : 'bg-white border border-border text-gray-700 hover:bg-gray-50'
              }`}
            >
              {s === 'future' ? 'Future' : s === 'in-process' ? 'In-Process' : s === 'past' ? 'Past' : s === 'templates' ? 'Templates' : 'All'}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <button onClick={() => setBackfillOpen(true)} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-border bg-white text-sm text-gray-700 hover:bg-gray-50">
            Backfill past event
          </button>
          <Button onClick={openCreateFresh}>
            <Plus className="w-4 h-4" />
            Create Event
          </Button>
        </div>
      </div>

      {/* Filters and View Toggle */}
      <div className="flex items-start justify-between gap-3 mb-6">
        <div className="flex flex-wrap gap-3">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 z-10" />
            <Input
              type="text"
              placeholder="Search events…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-10 w-64 pl-10"
            />
          </div>

          <SelectMenu
            value={locationFilter}
            onChange={setLocationFilter}
            className="w-44"
            options={[{ value: 'all', label: 'All Locations' }, ...locations.map((l) => ({ value: l, label: l }))]}
          />

          <SelectMenu
            value={ownerFilter}
            onChange={setOwnerFilter}
            className="w-44"
            options={[{ value: 'all', label: 'All Owners' }, ...owners.map((o) => ({ value: o, label: o }))]}
          />

          <TagFilter value={tagFilter} onChange={setTagFilter} className="w-44" />

          <SelectMenu
            value={formatFilter}
            onChange={setFormatFilter}
            className="w-44"
            options={[{ value: 'all', label: 'All Formats' }, ...formatOptions.map((f) => ({ value: f, label: f }))]}
          />

          {/* Date filter — Past / All only */}
          {showDateFilter && (
            <>
              <SelectMenu
                value={dateRange}
                onChange={(v) => setDateRange(v as typeof dateRange)}
                className="w-44"
                options={[
                  { value: 'all', label: 'Any date' },
                  { value: 'week', label: 'Past week' },
                  { value: 'month', label: 'Past month' },
                  { value: '3months', label: 'Past 3 months' },
                  { value: 'year', label: 'Past year' },
                  { value: 'custom', label: 'Custom range…' },
                ]}
              />
              {dateRange === 'custom' && (
                <div className="flex items-center gap-2">
                  <input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} className="px-3 py-2 border border-border rounded-lg text-sm" />
                  <span className="text-gray-400 text-sm">→</span>
                  <input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} className="px-3 py-2 border border-border rounded-lg text-sm" />
                </div>
              )}
            </>
          )}

          <button
            onClick={() => setShowBookmarkedOnly(!showBookmarkedOnly)}
            className={`px-4 py-2 rounded-lg text-sm transition-colors flex items-center gap-2 ${
              showBookmarkedOnly ? 'bg-gray-100' : 'bg-white border border-border hover:bg-gray-50'
            }`}
          >
            <Bookmark className={`w-4 h-4 ${showBookmarkedOnly ? 'fill-current text-gray-900' : 'text-gray-600'}`} />
          </button>
        </div>

        <div className="flex items-center gap-2">
        <div className="flex gap-2 bg-white border border-border rounded-lg p-1">
          <button
            onClick={() => setViewMode('cards')}
            className={`p-2 rounded transition-colors ${viewMode === 'cards' ? 'bg-gray-100' : 'hover:bg-gray-50'}`}
          >
            <LayoutGrid className="w-4 h-4" />
          </button>
          <button
            onClick={() => setViewMode('lines')}
            className={`p-2 rounded transition-colors ${viewMode === 'lines' ? 'bg-gray-100' : 'hover:bg-gray-50'}`}
          >
            <List className="w-4 h-4" />
          </button>
          <button
            onClick={() => setViewMode('calendar')}
            title="Calendar"
            className={`p-2 rounded transition-colors ${viewMode === 'calendar' ? 'bg-gray-100' : 'hover:bg-gray-50'}`}
          >
            <CalendarDays className="w-4 h-4" />
          </button>
        </div>
        </div>
      </div>

      {/* States */}
      {loading && <p className="text-gray-500 py-12 text-center">Loading events…</p>}
      {error && (
        <p className="text-red-600 bg-red-50 border border-red-200 rounded-lg p-4">
          Couldn’t load events: {error}
        </p>
      )}
      {!loading && !error && filteredEvents.length === 0 && (
        <p className="text-gray-500 py-12 text-center">No {statusFilter.replace('-', ' ')} events.</p>
      )}

      {/* Cards View */}
      {!loading && !error && viewMode === 'cards' && filteredEvents.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {filteredEvents.map((event) => (
            <div
              key={event.id}
              className="group bg-card rounded-xl ring-1 ring-foreground/10 p-6 hover:shadow-md transition-shadow cursor-pointer overflow-hidden flex flex-col"
              onClick={() => setSelectedEventId(event.id)}
            >
              {event.coverImageUrl && (
                // Fixed band (card size never changes); the image scales up on hover and is clipped
                // by the card's overflow-hidden — expands without reflowing the row.
                <div className="-mx-6 -mt-6 mb-4 h-36 overflow-hidden">
                  <img
                    src={event.coverImageUrl}
                    alt=""
                    className="h-full w-full max-w-none object-cover transition-transform duration-300 ease-out group-hover:scale-110"
                    style={{ objectPosition: event.coverPosition ?? '50% 50%' }}
                  />
                </div>
              )}

              <div className="flex items-center justify-between gap-2 mb-3 min-h-[2rem]">
                <TagStack tags={event.tags} editable onChange={(tags) => setTags(event.id, tags)} onTagClick={setTagFilter} />
                <div className="flex items-center gap-2 shrink-0">
                  {event.attendeeCount != null && (
                    <>
                      <span className="text-gray-300">|</span>
                      <span className="text-gray-500 text-sm whitespace-nowrap">{event.attendeeCount} checked in</span>
                    </>
                  )}
                  <button
                    onClick={(e) => { e.stopPropagation(); toggleBookmark(event.id); }}
                    className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                    aria-label="Bookmark event"
                  >
                    <Bookmark className={`w-5 h-5 ${bookmarkedEvents.has(event.id) ? "fill-current text-gray-900" : "text-gray-400"}`} />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); setDeleteTarget(event); }}
                    className="p-2 text-gray-400 hover:text-red-600 hover:bg-gray-100 rounded-lg transition-colors"
                    aria-label="Delete event"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                </div>
              </div>

              <h2 className="text-xl mb-2 flex items-center gap-1.5">
                <span>{event.title}</span>
                {event.finalRecordComplete && <span title="Final record complete" className="inline-flex shrink-0"><BadgeCheck className="w-4 h-4 text-emerald-600" /></span>}
              </h2>
              {event.seriesName && <p className="text-gray-500 text-sm mb-4">{event.seriesName}</p>}

              <div className="flex flex-wrap items-center gap-2 mb-2">
                <span className="px-3 py-1 bg-gray-100 rounded-md text-sm flex items-center gap-1">
                  {event.gcalEventId && event.gcalHtmlLink ? (
                    <a
                      href={event.gcalHtmlLink}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      title="View in Google Calendar"
                      className="inline-flex"
                    >
                      <Calendar className="w-3 h-3 text-emerald-600 hover:text-emerald-700" />
                    </a>
                  ) : (
                    <Calendar className={`w-3 h-3 ${event.gcalEventId ? "text-emerald-600" : ""}`} />
                  )}
                  {event.date ?? NOT_CAPTURED}{event.startTime ? ` · ${event.startTime}${event.endTime ? `–${event.endTime}` : ""}` : ""}
                </span>
                <span className="px-3 py-1 bg-gray-100 rounded-md text-sm flex items-center gap-1">
                  <MapPin className="w-3 h-3" />
                  {event.location ?? NOT_CAPTURED}
                </span>
              </div>
              {/* Formats on their own row so the hover fan-out has full width to expand into. */}
              <div className="mb-6">
                <FormatPicker value={parseFormats(event.format)} onChange={(arr) => setFormatValue(event.id, joinFormats(arr))} />
              </div>

              {/* Luma attach / link —  pinned to the card's bottom edge */}
              <div className="mt-auto pt-4 border-t border-gray-100" onClick={(e) => e.stopPropagation()}>
                {event.lumaEventId ? (
                  <a
                    href={event.lumaUrl ?? undefined}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900 border border-gray-300 rounded-lg px-2.5 py-1 hover:bg-gray-50 transition-colors"
                  >
                    Luma
                    <Link2 className="w-4 h-4" />
                  </a>
                ) : lumaEditingId === event.id ? (
                  <div>
                    <div className="flex gap-2">
                      <input
                        type="url"
                        autoFocus
                        value={lumaInput}
                        onChange={(e) => setLumaInput(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter" && lumaInput.trim()) submitLuma(event.id); }}
                        placeholder="https://luma.com/…"
                        className="flex-1 px-3 py-1.5 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-300"
                      />
                      <button
                        onClick={() => submitLuma(event.id)}
                        disabled={lumaBusy || !lumaInput.trim()}
                        className="px-3 py-1.5 bg-gray-200 text-black rounded-lg text-sm hover:bg-gray-300 disabled:opacity-50 transition-colors"
                      >
                        {lumaBusy ? "Attaching…" : "Attach"}
                      </button>
                      <button
                        onClick={() => { setLumaEditingId(null); setLumaError(null); }}
                        className="p-1.5 text-gray-500 hover:text-gray-900"
                        aria-label="Cancel"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                    {lumaError && <p className="text-red-600 text-[15px] mt-1">{lumaError}</p>}
                  </div>
                ) : (
                  <button
                    onClick={() => { setLumaEditingId(event.id); setLumaInput(""); setLumaError(null); }}
                    className="inline-flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900"
                  >
                    <Link2 className="w-4 h-4" />
                    Add Luma
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Lines View — brand Table primitives (matches the DataTable look) but kept custom so
          the row-hover choreography survives: the cover swatch expands and the columns fade. */}
      {!loading && !error && viewMode === 'lines' && filteredEvents.length > 0 && (
        <div className="bg-white rounded-2xl border border-border overflow-hidden">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow className="hover:bg-transparent">
                <TableHead className="px-4 py-3 text-sm font-medium text-muted-foreground">Event</TableHead>
                <TableHead className="px-4 py-3 text-sm font-medium text-muted-foreground">Tag</TableHead>
                <TableHead className="px-4 py-3 text-sm font-medium text-muted-foreground">Format</TableHead>
                <TableHead className="px-4 py-3 text-sm font-medium text-muted-foreground">Date</TableHead>
                <TableHead className="px-4 py-3 text-sm font-medium text-muted-foreground">Location</TableHead>
                <TableHead className="px-4 py-3 text-sm font-medium text-muted-foreground">Owner</TableHead>
                <TableHead className="px-4 py-3 text-sm font-medium text-muted-foreground">Checked in</TableHead>
                <TableHead className="px-4 py-3" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredEvents.map((event) => (
                <TableRow
                  key={event.id}
                  className="group/row cursor-pointer"
                  onClick={() => setSelectedEventId(event.id)}
                >
                  <TableCell className="px-4 py-4 whitespace-normal">
                    <div className="flex items-center gap-3">
                      <LumaSwatch url={event.coverImageUrl} fallback={tagColor(event.tags[0])} />
                      <div>
                        <p className="font-medium flex items-center gap-1.5">
                          <span>{event.title}</span>
                          {event.finalRecordComplete && <span title="Final record complete" className="inline-flex shrink-0"><BadgeCheck className="w-4 h-4 text-emerald-600" /></span>}
                        </p>
                        {event.seriesName && <p className="text-sm text-gray-500">{event.seriesName}</p>}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="px-4 py-4">
                    <TagStack tags={event.tags} editable onChange={(tags) => setTags(event.id, tags)} onTagClick={setTagFilter} />
                  </TableCell>
                  <TableCell className="px-4 py-4" onClick={(e) => e.stopPropagation()}>
                    <FormatPicker value={parseFormats(event.format)} onChange={(arr) => setFormatValue(event.id, joinFormats(arr))} />
                  </TableCell>
                  <TableCell className="px-4 py-4 text-sm transition-opacity group-hover/row:opacity-40">{event.date ?? <span className="text-gray-400">{NOT_CAPTURED}</span>}</TableCell>
                  <TableCell className="px-4 py-4 text-sm whitespace-normal transition-opacity group-hover/row:opacity-40">{event.location ?? <span className="text-gray-400">{NOT_CAPTURED}</span>}</TableCell>
                  <TableCell className="px-4 py-4 text-sm transition-opacity group-hover/row:opacity-40">{event.owner ?? <span className="text-gray-400">{NOT_CAPTURED}</span>}</TableCell>
                  <TableCell className="px-4 py-4 text-sm transition-opacity group-hover/row:opacity-40">{event.attendeeCount ?? <span className="text-gray-400">—</span>}</TableCell>
                  <TableCell className="px-4 py-4">
                    <div className="flex items-center gap-1">
                      <button
                        onClick={(e) => { e.stopPropagation(); toggleBookmark(event.id); }}
                        className="p-2 hover:bg-gray-200 rounded-lg transition-colors"
                      >
                        <Bookmark className={`w-4 h-4 ${bookmarkedEvents.has(event.id) ? "fill-current text-gray-900" : "text-gray-400"}`} />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); setDeleteTarget(event); }}
                        className="p-2 text-gray-400 hover:text-red-600 hover:bg-gray-200 rounded-lg transition-colors opacity-0 group-hover/row:opacity-100"
                        aria-label="Delete event"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Calendar View — month grid, events on their dates */}
      {!loading && !error && viewMode === 'calendar' && (
        <CalendarView events={filteredEvents} onOpen={(id) => setSelectedEventId(id)} />
      )}

      {pastChooser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={() => { setPastChooser(null); onFilesConsumed?.(); }}>
          <div className="bg-white rounded-2xl border border-border max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-1"><AlertCircle className="w-5 h-5 text-amber-600" /><h2 className="text-lg">Looks like a backfilled event</h2></div>
            <p className="text-sm text-gray-600 mb-5">This reads like a past event (a debrief/recap). Backfilling records what happened and updates the template. Is this a past event, or one you're still planning?</p>
            <div className="flex flex-col gap-2">
              <button onClick={chooseBackfill} className="w-full px-3 py-2 rounded-lg bg-gray-900 text-white text-sm hover:bg-black text-left">Past event — backfill it <span className="text-gray-300">· → wrapped record</span></button>
              <button onClick={chooseInProcess} className="w-full px-3 py-2 rounded-lg border border-border bg-white text-sm text-gray-800 hover:bg-gray-50 text-left">In-process / upcoming — create it <span className="text-gray-400">· → plan it</span></button>
              <button onClick={() => { setPastChooser(null); onFilesConsumed?.(); }} className="text-sm text-gray-500 hover:text-gray-800 mt-1">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {backfillOpen && (
        <BackfillModal
          initialText={backfillText}
          initialFiles={backfillFiles}
          onClose={() => { setBackfillOpen(false); setBackfillText(undefined); setBackfillFiles(null); }}
          onCreated={async (id) => { setBackfillOpen(false); setBackfillText(undefined); setBackfillFiles(null); await load(); setSelectedEventId(id); }}
        />
      )}

      {createOpen && (
        <CreateEventModal
          events={events}
          initialFiles={resumeIngest ? null : initialFiles}
          resumeIngest={resumeIngest}
          onFilesConsumed={onFilesConsumed}
          onClose={() => { setCreateOpen(false); setResumeIngest(null); }}
          onBackfill={(text, files) => { setCreateOpen(false); setResumeIngest(null); setBackfillText(text); setBackfillFiles(files ?? null); setBackfillOpen(true); }}
          onCacheReview={(ing) => { pendingReview.current = ing; }}
          onCreated={async (id) => { if (pendingReview.current) { setReviewCache({ ingest: pendingReview.current, eventId: id }); pendingReview.current = null; } await load(); setCreateOpen(false); setResumeIngest(null); setSelectedEventId(id); }}
        />
      )}

      {deleteTarget && (
        <ConfirmModal
          title="Delete event?"
          message={`Permanently delete “${deleteTarget.title}” and everything attached to it (budget, vendors, planning, attendee links). This can’t be undone.`}
          confirmLabel="Delete"
          danger
          onConfirm={confirmDelete}
          onClose={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
