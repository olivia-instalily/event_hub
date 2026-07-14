import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Rocket, Clock, CalendarRange, Users, Repeat, Sparkles, ChevronRight, ChevronLeft,
  ListChecks, DollarSign, UserCircle, Mail, BookOpen, ArrowRight, X, ExternalLink, FileText, Plus, Pencil, Check, GripVertical,
} from "lucide-react";
import { DndContext, closestCorners, PointerSensor, KeyboardSensor, useSensor, useSensors, useDraggable, useDroppable, type DragEndEvent } from "@dnd-kit/core";
import { type EventPlanning, type Deliverable, type OutreachTemplate, type EngagementWithCandidates, eventsFromTemplate, spinUpFromTemplate, type TemplateChild, addDeliverable, deleteDeliverable, setDeliverablePhase, setEventStaffRoles, setEventOutreach, setEventPattern, addEngagement, deleteEngagement } from "../lib/db";
import { fundingFor } from "../lib/scoping";
import { canonicalPhaseFor } from "../lib/phaseMerge";
import { SourceMaterials } from "./SourceMaterials";
import { regenerateFromMaterials } from "../lib/regenerate";
import { LocationInput } from "./LocationEdit";
import { TagStack } from "./TagStack";

const money = (n: number | null | undefined) =>
  n == null ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

// Per-phase accent colors (assigned client-side; the extractor can't know them).
export const PHASE_COLORS = [
  { dot: "bg-blue-500", band: "bg-blue-100", text: "text-blue-700", ring: "ring-blue-200", border: "border-blue-500", fillSoft: "group-hover:bg-blue-100" },
  { dot: "bg-violet-500", band: "bg-violet-100", text: "text-violet-700", ring: "ring-violet-200", border: "border-violet-500", fillSoft: "group-hover:bg-violet-100" },
  { dot: "bg-amber-500", band: "bg-amber-100", text: "text-amber-700", ring: "ring-amber-200", border: "border-amber-500", fillSoft: "group-hover:bg-amber-100" },
  { dot: "bg-emerald-500", band: "bg-emerald-100", text: "text-emerald-700", ring: "ring-emerald-200", border: "border-emerald-500", fillSoft: "group-hover:bg-emerald-100" },
  { dot: "bg-rose-500", band: "bg-rose-100", text: "text-rose-700", ring: "ring-rose-200", border: "border-rose-500", fillSoft: "group-hover:bg-rose-100" },
  { dot: "bg-teal-500", band: "bg-teal-100", text: "text-teal-700", ring: "ring-teal-200", border: "border-teal-500", fillSoft: "group-hover:bg-teal-100" },
];

interface Phase { name: string; order: number; color: typeof PHASE_COLORS[number]; start: number | null; end: number | null }

// Enrich the extractor's phase names with order (sequence), color (client), and a
// time_range inferred from the offsets of the deliverables that belong to each phase.
export function enrichPhases(plan: Pick<EventPlanning, "phases" | "walkthrough" | "deliverables">, fallbackNames: string[] = []): Phase[] {
  let names = plan.phases.length
    ? [...plan.phases].sort((a, b) => a.order - b.order).map((p) => p.name)
    : Array.from(new Set([...plan.walkthrough.map((s) => s.phase), ...plan.deliverables.map((d) => d.phase ?? "")].filter(Boolean))) as string[];
  if (names.length === 0) names = fallbackNames; // no template phases → caller's default scheme
  return names.map((name, i) => {
    const offs = plan.deliverables.filter((d) => (d.phase ?? "") === name).flatMap((d) => [d.offsetStart, d.offsetEnd ?? d.offsetStart]).filter((n): n is number => n != null);
    return { name, order: i, color: PHASE_COLORS[i % PHASE_COLORS.length], start: offs.length ? Math.min(...offs) : null, end: offs.length ? Math.max(...offs) : null };
  });
}

const normKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export function tLabel(start: number | null, end: number | null): string {
  if (start == null) return "no timing";
  const f = (n: number) => (n === 0 ? "T0" : n > 0 ? `T+${n}` : `T${n}`);
  return end != null && end !== start ? `${f(start)} → ${f(end)}` : f(start);
}

type Tab = "walkthrough" | "deliverables" | "budget" | "roles" | "outreach";
const TABS: { key: Tab; label: string; icon: typeof BookOpen }[] = [
  { key: "walkthrough", label: "Walkthrough", icon: BookOpen },
  { key: "deliverables", label: "Deliverables", icon: ListChecks },
  { key: "budget", label: "Budget", icon: DollarSign },
  { key: "roles", label: "Roles", icon: UserCircle },
  { key: "outreach", label: "Outreach", icon: Mail },
];

export function TemplateView({ plan, eventId, onExit, onOpenEvent, onReview, onApplied }: {
  plan: EventPlanning; eventId: string; onExit: () => void; onOpenEvent?: (id: string) => void; onReview?: () => void; onApplied?: () => void;
}) {
  const [tab, setTab] = useState<Tab>("walkthrough");
  const [spinOpen, setSpinOpen] = useState(false);
  const [children, setChildren] = useState<TemplateChild[]>([]);
  const phaseRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // Editable on the set-up page: roles, deliverables, outreach (seeded from the template,
  // persisted on add). Jump-key drives the walkthrough → deliverable navigation.
  const [roles, setRoles] = useState(plan.staffRoles);
  const [outreach, setOutreach] = useState(plan.outreach);
  const [dels, setDels] = useState<Deliverable[]>(plan.deliverables);
  const [phaseRows, setPhaseRows] = useState(plan.phases);
  const addPhase = (name: string) => {
    const n = name.trim();
    if (!n || phaseRows.some((p) => p.name.toLowerCase() === n.toLowerCase())) return;
    const next = [...phaseRows, { name: n, order: phaseRows.reduce((mx, p) => Math.max(mx, p.order), -1) + 1 }];
    setPhaseRows(next);
    setEventPattern(eventId, { phases: next }).catch(() => {});
  };
  const [engagements, setEngagements] = useState<EngagementWithCandidates[]>(plan.engagements);
  const [jumpKey, setJumpKey] = useState<string | null>(null);
  const addRole = (r: string) => { const next = [...roles, r]; setRoles(next); setEventStaffRoles(eventId, next).catch(() => {}); };
  const addOutreach = (o: OutreachTemplate) => { const next = [...outreach, o]; setOutreach(next); setEventOutreach(eventId, next).catch(() => {}); };
  const updateOutreach = (i: number, o: OutreachTemplate) => { const next = outreach.map((x, j) => (j === i ? o : x)); setOutreach(next); setEventOutreach(eventId, next).catch(() => {}); };
  const removeOutreach = (i: number) => { const next = outreach.filter((_, j) => j !== i); setOutreach(next); setEventOutreach(eventId, next).catch(() => {}); };
  const addDel = async (title: string, phase: string) => {
    try { const d = await addDeliverable(eventId, { title, phase, ownerRole: null, dueDate: null, offsetStart: null, offsetEnd: null }); setDels((p) => [...p, d]); } catch { /* non-fatal */ }
  };
  const removeDel = (id: string) => { setDels((p) => p.filter((d) => d.id !== id)); deleteDeliverable(id).catch(() => {}); };
  // Drag a deliverable into a different phase/section — updates its phase (keeps T-offsets).
  const moveDel = (id: string, phase: string) => { setDels((p) => p.map((d) => (d.id === id ? { ...d, phase } : d))); setDeliverablePhase(id, phase).catch(() => {}); };
  const addCost = async (category: string) => {
    try { const e = await addEngagement(eventId, category); setEngagements((p) => [...p, e]); } catch { /* non-fatal */ }
  };
  const removeCost = (id: string) => { setEngagements((p) => p.filter((e) => e.id !== id)); deleteEngagement(id).catch(() => {}); };
  // Walkthrough → Deliverables: open that tab and scroll to the matching deliverable.
  const jumpToDeliverable = (label: string) => { setJumpKey(normKey(label)); setTab("deliverables"); };

  // Use the LOCAL phase list + deliverables so add-phase / add-deliverable reflect immediately.
  const phases = useMemo(() => enrichPhases({ phases: phaseRows, walkthrough: plan.walkthrough, deliverables: dels }), [phaseRows, plan.walkthrough, dels]);
  const funding = fundingFor(plan.tags);

  useEffect(() => { eventsFromTemplate(eventId).then(setChildren).catch(() => setChildren([])); }, [eventId]);

  // Pattern facts (omit, never fabricate).
  const showRate = plan.heuristics.find((h) => /show|rsvp|turn ?out|%/.test(h.toLowerCase())) ?? null;
  const leadDays = phases.flatMap((p) => [p.start, p.end]).filter((n): n is number => n != null);
  const leadFact = plan.planningLeadTime ?? (leadDays.length ? `Plan from ${tLabel(Math.min(...leadDays), Math.max(...leadDays))}` : null);

  const [activePhase, setActivePhase] = useState<string | null>(null);
  const [pendingPhase, setPendingPhase] = useState<string | null>(null);
  // After a dot click, hold the clicked phase filled (ignore the scroll-spy) until the user
  // actually scrolls — otherwise the programmatic jump + bottom-of-page logic re-pick the next
  // phase immediately. Released on the first wheel/touch/key in the spy effect below.
  const spyLocked = useRef(false);
  // Timeline dot → jump to that phase in the Walkthrough, switching tabs first if needed.
  const jumpToPhase = (name: string) => {
    spyLocked.current = true;
    setActivePhase(name);
    if (tab !== "walkthrough") { setTab("walkthrough"); setPendingPhase(name); }
    else phaseRefs.current[name]?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  // After switching to the Walkthrough tab, scroll to the phase that was clicked.
  useEffect(() => {
    if (tab === "walkthrough" && pendingPhase) {
      phaseRefs.current[pendingPhase]?.scrollIntoView({ behavior: "smooth", block: "start" });
      setPendingPhase(null);
    }
  }, [tab, pendingPhase]);

  // Scroll-spy (Walkthrough tab): a section becomes active when its title scrolls up to the
  // bottom edge of the sticky timeline bar — measured per-title, so short sections register
  // too. At the page bottom, trailing sections whose titles can't reach the bar still activate
  // once they pass the halfway line (whichever comes first).
  useEffect(() => {
    if (tab !== "walkthrough") return;
    let raf = 0;
    const compute = () => {
      raf = 0;
      if (spyLocked.current) return; // a dot was just clicked — keep its phase until the user scrolls
      const els = Object.entries(phaseRefs.current).filter((e): e is [string, HTMLDivElement] => !!e[1]);
      if (els.length === 0) return;
      const bar = document.querySelector("[data-timeline-bar]") as HTMLElement | null;
      const lineY = bar ? bar.getBoundingClientRect().bottom : 88; // bottom edge of the timeline bar
      const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
      const half = window.innerHeight / 2;
      let activeName = els[0][0];
      for (const [name, el] of els) {
        const top = el.getBoundingClientRect().top;
        // Trigger on the title's top edge (with a small allowance above) meeting the bar's
        // bottom edge. At the page bottom, a title that only reaches the halfway line counts too.
        if (top <= lineY + 8 || (atBottom && top <= half)) activeName = name;
      }
      setActivePhase((prev) => (prev === activeName ? prev : activeName));
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(compute); };
    const release = () => { spyLocked.current = false; }; // user-initiated scroll resumes the spy
    compute();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    window.addEventListener("wheel", release, { passive: true });
    window.addEventListener("touchmove", release, { passive: true });
    window.addEventListener("keydown", release);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      window.removeEventListener("wheel", release);
      window.removeEventListener("touchmove", release);
      window.removeEventListener("keydown", release);
      cancelAnimationFrame(raf);
    };
  }, [tab, phases]);

  return (
    <div>
      <button onClick={onExit} className="inline-flex items-center gap-1 mb-6 px-2 py-1 rounded-lg bg-white border border-border text-gray-700 hover:bg-gray-50 transition-colors">
        <ChevronLeft className="w-4 h-4" /> Back
      </button>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6 items-start">
        {/* MAIN */}
        <div className="space-y-6 min-w-0">
          <SourceMaterials items={plan.sourceMaterials} onRegenerate={async () => { const msg = await regenerateFromMaterials(plan, { template: true }); onApplied?.(); return msg; }} />
          {/* Header — pattern facts, not instance facts */}
          <div className="bg-white rounded-2xl border border-gray-200 p-6">
            <div className="flex items-center gap-2 mb-3">
              <span className="inline-flex items-center gap-1.5 text-[15px] font-medium text-violet-700 bg-violet-100 rounded-full px-2.5 py-1"><Sparkles className="w-3.5 h-3.5" /> Template · pattern mode</span>
              {funding.category && <span className="text-[15px] text-gray-500">{funding.category} · {funding.fundingLine} · {funding.tier}</span>}
            </div>
            <h1 className="text-2xl font-semibold text-gray-900 mb-1">{plan.title}</h1>
            {plan.reflections.length === 0 && plan.description && <p className="text-gray-600 mb-4">{plan.description}</p>}

            <div className="flex flex-wrap gap-x-6 gap-y-2 mt-4 text-sm">
              {leadFact && <Fact icon={Clock} label="Lead time" value={leadFact} />}
              {plan.format && <Fact icon={CalendarRange} label="Format" value={plan.format} />}
              {showRate && <Fact icon={Users} label="Show rate" value={showRate} />}
              {(funding.category === "Hosted" || /community|brand/i.test(plan.tags.join(" "))) && <Fact icon={Repeat} label="Cadence" value="Recurring / community" />}
            </div>

            <div className="mt-5 flex flex-wrap items-center gap-2">
              <button onClick={() => setSpinOpen(true)} className="inline-flex items-center gap-2 px-4 py-2 bg-gray-900 text-white rounded-lg text-sm hover:bg-gray-800">
                <Rocket className="w-4 h-4" /> Spin up an event
              </button>
              {onReview && (
                <button onClick={onReview} className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 text-gray-800 rounded-lg text-sm hover:bg-gray-50" title="Reopen the review/generation page for this template">
                  <FileText className="w-4 h-4" /> Review
                </button>
              )}
            </div>
          </div>

          {/* Clickable phase timeline — sticky rail + scroll-spy */}
          <PhaseTimeline phases={phases} active={activePhase} onPick={jumpToPhase} />

          {/* Tabs */}
          <div className="bg-white rounded-2xl border border-gray-200">
            <div className="flex gap-1 border-b border-gray-200 px-2 overflow-x-auto">
              {TABS.map((t) => {
                const Icon = t.icon;
                return (
                  <button key={t.key} onClick={() => { setTab(t.key); setJumpKey(null); }} className={`inline-flex items-center gap-1.5 px-3 py-3 text-sm border-b-2 -mb-px whitespace-nowrap ${tab === t.key ? "border-gray-900 text-gray-900 font-medium" : "border-transparent text-gray-500 hover:text-gray-800"}`}>
                    <Icon className="w-4 h-4" /> {t.label}
                  </button>
                );
              })}
            </div>
            <div className="p-6">
              {tab === "walkthrough" && <Walkthrough plan={plan} phases={phases} phaseRefs={phaseRefs} onJumpDeliverable={jumpToDeliverable} />}
              {tab === "deliverables" && <Deliverables items={dels} phases={phases} jumpKey={jumpKey} onAdd={addDel} onRemove={removeDel} onMove={moveDel} onAddPhase={addPhase} />}
              {tab === "budget" && <Budget plan={plan} engagements={engagements} onAdd={addCost} onRemove={removeCost} />}
              {tab === "roles" && <Roles roles={roles} plan={plan} onAdd={addRole} />}
              {tab === "outreach" && <Outreach items={outreach} onAdd={addOutreach} onUpdate={updateOutreach} onRemove={removeOutreach} />}
            </div>
          </div>
        </div>

        {/* RIGHT RAIL */}
        <div className="space-y-4">
          <div className="bg-white rounded-2xl border border-gray-200 p-5">
            <h3 className="font-medium text-gray-900 mb-1 flex items-center gap-2"><Rocket className="w-4 h-4" /> Spin up an event</h3>
            <p className="text-sm text-gray-500 mb-3">Resolve offsets to dates, fill the blanks, and copy the walkthrough, principles, and outreach into a live event in Planning.</p>
            <button onClick={() => setSpinOpen(true)} className="w-full px-4 py-2 bg-gray-900 text-white rounded-lg text-sm hover:bg-gray-800">Spin up</button>
          </div>

          <FilledOnSpinUp plan={plan} />

          <div className="bg-white rounded-2xl border border-gray-200 p-5">
            <h3 className="font-medium text-gray-900 mb-1">Events from this template</h3>
            <p className="text-[15px] text-gray-400 mb-3">Their actuals refine the show-rate and budget ranges over time.</p>
            {children.length === 0 ? (
              <p className="text-sm text-gray-400">None spun up yet.</p>
            ) : (
              <ul className="space-y-2">
                {children.map((c) => (
                  <li key={c.id}>
                    <button onClick={() => onOpenEvent?.(c.id)} className="w-full text-left flex items-center justify-between gap-2 text-sm hover:bg-gray-50 rounded-lg px-2 py-1.5 -mx-2">
                      <span className="min-w-0"><span className="block truncate text-gray-900">{c.name}</span><span className="text-[15px] text-gray-400">{c.date ?? "undated"}{c.turnout != null ? ` · ${c.turnout} turned out` : ""}</span></span>
                      <ExternalLink className="w-3.5 h-3.5 text-gray-300 shrink-0" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {spinOpen && <SpinUpModal plan={plan} eventId={eventId} onClose={() => setSpinOpen(false)} onSpunUp={(id) => { setSpinOpen(false); onOpenEvent ? onOpenEvent(id) : onExit(); }} />}
    </div>
  );
}

function Fact({ icon: Icon, label, value }: { icon: typeof Clock; label: string; value: string }) {
  return (
    <div className="flex items-start gap-2">
      <Icon className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
      <span><span className="block text-[15px] text-gray-400">{label}</span><span className="text-gray-800">{value}</span></span>
    </div>
  );
}

// ── Hollow-dot node rail (shared) ────────────────────────────────────────────
// Phases as evenly-spaced nodes on a thin gray line: a hollow colored ring that fills when
// active; the day-of phase keeps a halo ring but stays hollow inside. Used on the template
// walkthrough (sticky + clickable) and on the create-event review (static). Pass onPick to
// make the dots clickable.
const isDayOfPhase = (p: Phase) => /event\s*day|day[-\s]?of|\blive\b/i.test(p.name) || p.start === 0 || p.end === 0;

export function PhaseRail({ phases, active, onPick, statusByPhase, eventDate, progress }: {
  phases: Phase[]; active?: string | null; onPick?: (name: string) => void;
  statusByPhase?: Record<string, "done" | "current" | "upcoming">; eventDate?: string | null;
  // Per-phase completion (0–1). Colors each node's right-hand line segment proportionally and
  // checks the node off at 1. Overrides the date-based status when provided.
  progress?: Record<string, number>;
}) {
  if (phases.length === 0) return null;
  // Caption: a resolved date (when the event has a date) else the relative T-offset.
  const cap = (p: Phase): string => {
    if (eventDate && p.start != null) {
      const d = (off: number) => { const x = new Date(eventDate + "T00:00:00"); x.setDate(x.getDate() + off); return x.toLocaleDateString("en-US", { month: "short", day: "numeric" }); };
      return p.end != null && p.end !== p.start ? `${d(p.start)}–${d(p.end)}` : d(p.start);
    }
    return tLabel(p.start, p.end);
  };
  return (
    <div className="relative">
      {/* single thin neutral rail, through the dot centers (top-4 = the h-8 zone's middle) */}
      <div className="absolute left-0 right-0 top-4 h-px bg-gray-200" />
      {/* progress fills: each node's segment to its right takes its color, proportional to that
          phase's completion (e.g. 1 of 3 done → 1/3 of the segment colored). */}
      {progress && phases.map((p, i) => {
        const frac = Math.max(0, Math.min(1, progress[p.name] ?? 0));
        if (frac <= 0) return null;
        const cx = (i + 0.5) / phases.length;
        const segEnd = i < phases.length - 1 ? (i + 1.5) / phases.length : 1;
        return <div key={`prog-${p.name}`} className={`absolute top-4 h-px ${p.color.dot}`} style={{ left: `${cx * 100}%`, width: `${(segEnd - cx) * frac * 100}%` }} />;
      })}
      <div className="flex">
        {phases.map((p) => {
          const dayOf = isDayOfPhase(p);
          const status = statusByPhase?.[p.name];
          const frac = progress?.[p.name];
          const done = frac != null ? frac >= 1 : status === "done";
          const current = active === p.name || status === "current";
          const filled = done || current;
          const halo = dayOf || current; // emphasize current and the run-of-show marker
          return (
            <button
              key={p.name}
              type="button"
              onClick={onPick ? (e) => { e.stopPropagation(); onPick(p.name); } : undefined}
              title={`${p.name} · ${cap(p)}`}
              className={`group relative flex-1 min-w-[62px] flex flex-col items-center px-1 text-center ${onPick ? "" : "cursor-default"}`}
            >
              {/* dot zone — the rail crosses its vertical center */}
              <span className="relative flex h-8 w-full items-center justify-center">
                {dayOf && <span className={`absolute left-1/2 top-0 h-2 w-px -translate-x-1/2 ${p.color.dot}`} />}
                <span className={`flex items-center justify-center rounded-full border-2 transition-colors ${dayOf ? "w-5 h-5" : "w-4 h-4"} ${p.color.border} ${halo ? `ring-4 ${p.color.ring}` : ""} ${filled ? p.color.dot : `bg-white ${p.color.fillSoft}`}`}>
                  {done && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
                </span>
              </span>
              <span className={`mt-1 text-[15px] leading-tight ${dayOf || current ? `${p.color.text} font-semibold` : done ? "text-gray-700 font-medium" : "text-gray-600"}`}>{p.name}</span>
              {(() => {
                if (dayOf) return <span className={`mt-0.5 text-[13px] ${p.color.text}`}>event day</span>;
                const range = cap(p);
                if (!range || range === "no timing") return null; // no timing → leave it out
                return <span className="mt-0.5 text-[13px] text-gray-400 whitespace-nowrap">{range}</span>;
              })()}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Per-phase progress status from today vs. the phases' resolved offsets. Single current
// phase (first not-yet-finished); earlier are done, later upcoming. Null date → all upcoming.
export function phaseStatuses(phases: Phase[], eventDate: string | null): { byPhase: Record<string, "done" | "current" | "upcoming">; current: string | null } {
  const byPhase: Record<string, "done" | "current" | "upcoming"> = {};
  if (!eventDate) { phases.forEach((p) => (byPhase[p.name] = "upcoming")); return { byPhase, current: null }; }
  const nowOff = Math.round((new Date(new Date().toISOString().slice(0, 10) + "T00:00:00").getTime() - new Date(eventDate + "T00:00:00").getTime()) / 86_400_000);
  let current: string | null = null;
  for (const p of phases) {
    const end = p.end ?? p.start;
    if (end != null && end < nowOff) byPhase[p.name] = "done";
    else if (current == null) { byPhase[p.name] = "current"; current = p.name; }
    else byPhase[p.name] = "upcoming";
  }
  return { byPhase, current };
}

// ── Clickable phase timeline (sticky rail) ───────────────────────────────────
// The title/caption scroll away with the page; the rail is a CONSTANT-HEIGHT sticky element,
// so when it pins there's no height change and therefore no reflow/jump (the earlier glitch
// came from removing the title inside the sticky box). Clicking the bar's empty area → top.
export function PhaseTimeline({ phases, active, onPick, progress, statusByPhase, eventDate }: {
  phases: Phase[]; active: string | null; onPick: (name: string) => void;
  progress?: Record<string, number>;
  statusByPhase?: Record<string, "done" | "current" | "upcoming">;
  eventDate?: string | null;
}) {
  if (phases.length === 0) return null;
  const allOff = phases.flatMap((p) => [p.start, p.end]).filter((n): n is number => n != null);
  const useTime = phases.filter((p) => p.start != null).length >= 2;
  const bounds: [number, number] = allOff.length ? [Math.min(...allOff, 0), Math.max(...allOff, 0)] : [-21, 5];

  return (
    <>
      {/* Header scrolls away — kept OUT of the sticky element so its height never changes. */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-gray-700">Timeline</h3>
        {useTime && <span className="text-[15px] text-gray-400">{tLabel(bounds[0], bounds[1])} · click a phase to jump</span>}
      </div>
      <div
        data-timeline-bar
        onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
        title="Back to top"
        className="sticky top-0 z-30 mb-4 cursor-pointer border-y border-gray-200 bg-white pt-2.5 pb-1"
      >
        <PhaseRail phases={phases} active={active} onPick={onPick} progress={progress} statusByPhase={statusByPhase} eventDate={eventDate} />
      </div>
    </>
  );
}

// ── Walkthrough (the face) ───────────────────────────────────────────────────
function Walkthrough({ plan, phases, phaseRefs, onJumpDeliverable }: { plan: EventPlanning; phases: Phase[]; phaseRefs: React.MutableRefObject<Record<string, HTMLDivElement | null>>; onJumpDeliverable: (label: string) => void }) {
  // Fall back to a thin walkthrough (titles only) from deliverables when none was extracted.
  const steps = plan.walkthrough.length
    ? plan.walkthrough
    : plan.deliverables.map((d) => ({ title: d.title, rationale: "", phase: d.phase ?? "", linkedKind: "deliverable" as const, linkedLabel: d.title, isCallout: false }));

  const order = new Map(phases.map((p) => [p.name, p.order]));
  const nodeNames = phases.map((p) => p.name);
  const byPhase = new Map<string, typeof steps>();
  for (const s of steps) { const k = canonicalPhaseFor(s.phase, nodeNames) || "Steps"; if (!byPhase.has(k)) byPhase.set(k, []); byPhase.get(k)!.push(s); }
  const phaseOrder = [...byPhase.keys()].sort((a, b) => (order.get(a) ?? 99) - (order.get(b) ?? 99));

  return (
    <div className="space-y-6">
      {plan.reflections.length > 0 && (
        <div className="rounded-xl bg-gray-50 border border-gray-200 p-4">
          <h3 className="text-[15px] uppercase tracking-wide text-gray-500 mb-2">Principles</h3>
          <ul className="space-y-1.5 text-sm text-gray-700">
            {plan.reflections.map((r, i) => <li key={i} className="flex gap-2"><span className="text-gray-300 mt-0.5">•</span><span>{r}</span></li>)}
          </ul>
        </div>
      )}

      {steps.length === 0 && <p className="text-sm text-gray-400">No walkthrough in this brief.</p>}

      {phaseOrder.map((name) => {
        const color = phases.find((p) => p.name === name)?.color ?? PHASE_COLORS[0];
        return (
          <div key={name} ref={(el) => { phaseRefs.current[name] = el; }} className="scroll-mt-28">
            <div className="flex items-center gap-2 mb-3">
              <span className={`w-2.5 h-2.5 rounded-full ${color.dot}`} />
              <h3 className="font-medium text-gray-900">{name}</h3>
            </div>
            <ol className="space-y-3 ml-1 border-l border-gray-200 pl-4">
              {byPhase.get(name)!.map((s, i) => (
                s.isCallout ? (
                  <li key={i} className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2">
                    <p className="text-sm text-amber-900 font-medium">{s.title}</p>
                    {s.rationale && <p className="text-[15px] text-amber-800 mt-0.5">{s.rationale}</p>}
                  </li>
                ) : (
                  <li key={i} className="relative">
                    {/* smaller bullet on the parallel line, matching the phase's title bullet color */}
                    <span className={`absolute -left-[19px] top-1.5 w-1.5 h-1.5 rounded-full ${color.dot}`} />
                    <div className="flex items-start gap-2">
                      <span className="text-sm text-gray-900 flex-1">{s.title}</span>
                      {s.linkedKind === "deliverable" && s.linkedLabel ? (
                        // Just the checklist icon (the label gets long & truncates). Hover → title; click → jump to it.
                        <button onClick={() => onJumpDeliverable(s.linkedLabel)} title={s.linkedLabel} aria-label={`Go to deliverable: ${s.linkedLabel}`}
                          className="shrink-0 mt-0.5 text-gray-400 hover:text-gray-900 transition-colors">
                          <ListChecks className="w-4 h-4" />
                        </button>
                      ) : s.linkedKind === "role" && s.linkedLabel ? (
                        <span className="shrink-0 inline-flex items-center gap-1 text-[15px] text-gray-500 bg-gray-100 rounded-full px-2 py-0.5">
                          <UserCircle className="w-3 h-3" /> {s.linkedLabel}
                        </span>
                      ) : null}
                    </div>
                    {s.rationale && <p className="text-[15px] text-gray-500 mt-0.5">{s.rationale}</p>}
                  </li>
                )
              ))}
            </ol>
          </div>
        );
      })}
    </div>
  );
}

// ── Deliverables ─────────────────────────────────────────────────────────────
// A phase section that accepts a dropped deliverable (highlights while hovered).
function DroppableSection({ id, children }: { id: string; children: ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return <div ref={setNodeRef} className={`rounded-lg transition-shadow ${isOver ? "ring-2 ring-gray-400" : ""}`}>{children}</div>;
}
// A draggable deliverable row (grip handle carries the drag listeners).
function DraggableRow({ id, children }: { id: string; children: (h: { setNodeRef: (el: HTMLElement | null) => void; attributes: any; listeners: any; style: any; isDragging: boolean }) => ReactNode }) {
  const { setNodeRef, attributes, listeners, transform, isDragging } = useDraggable({ id });
  const style = transform ? { transform: `translate(${transform.x}px, ${transform.y}px)`, zIndex: 50, position: "relative" as const } : undefined;
  return <>{children({ setNodeRef, attributes, listeners, style, isDragging })}</>;
}

function Deliverables({ items, phases, jumpKey, onAdd, onRemove, onMove, onAddPhase }: { items: Deliverable[]; phases: Phase[]; jumpKey: string | null; onAdd: (title: string, phase: string) => void; onRemove: (id: string) => void; onMove?: (id: string, phase: string) => void; onAddPhase?: (name: string) => void }) {
  const refs = useRef<Record<string, HTMLLIElement | null>>({});
  const [highlight, setHighlight] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null); // phase being added to
  const [title, setTitle] = useState("");
  const [addingPhase, setAddingPhase] = useState(false);
  const [phaseName, setPhaseName] = useState("");
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor));

  // On a jump from the walkthrough, scroll to and highlight the matching deliverable.
  useEffect(() => {
    if (!jumpKey) return;
    const el = refs.current[jumpKey];
    if (el) { el.scrollIntoView({ behavior: "smooth", block: "center" }); setHighlight(jumpKey); }
  }, [jumpKey, items.length]);
  // Keep the highlight until the user clicks somewhere else (then it clears). Defer attaching
  // so the navigating click that brought us here doesn't immediately dismiss it.
  useEffect(() => {
    if (!highlight) return;
    const clear = () => setHighlight(null);
    const id = setTimeout(() => document.addEventListener("mousedown", clear, { once: true }), 0);
    return () => { clearTimeout(id); document.removeEventListener("mousedown", clear); };
  }, [highlight]);

  const order = new Map(phases.map((p) => [p.name, p.order]));
  const nodeNames = phases.map((p) => p.name);
  const byPhase = new Map<string, Deliverable[]>();
  for (const d of items) { const k = canonicalPhaseFor(d.phase, nodeNames) || "Unphased"; if (!byPhase.has(k)) byPhase.set(k, []); byPhase.get(k)!.push(d); }
  // Show every phase (even empty) so each can take an addition; keep brief order.
  const names = Array.from(new Set([...phases.map((p) => p.name), ...byPhase.keys()])).sort((a, b) => (order.get(a) ?? 99) - (order.get(b) ?? 99));
  const submit = (phase: string) => { const t = title.trim(); if (!t) return; onAdd(t, phase); setTitle(""); setAdding(null); };

  // Drop a deliverable onto a different section → move it there (over.id is the phase name).
  const onDragEnd = (e: DragEndEvent) => {
    if (!onMove || !e.over) return;
    const id = String(e.active.id);
    const toPhase = String(e.over.id);
    const cur = items.find((d) => d.id === id);
    const fromPhase = cur ? (canonicalPhaseFor(cur.phase, nodeNames) || "Unphased") : null;
    if (fromPhase !== toPhase) onMove(id, toPhase);
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={onDragEnd}>
    <div className="space-y-5">
      {names.map((name) => {
        const color = phases.find((p) => p.name === name)?.color ?? PHASE_COLORS[0];
        const group = byPhase.get(name) ?? [];
        return (
          <DroppableSection key={name} id={name}>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2"><span className={`w-2.5 h-2.5 rounded-full ${color.dot}`} /><h3 className="text-sm font-medium text-gray-700">{name}</h3></div>
              <button onClick={() => { setAdding(adding === name ? null : name); setTitle(""); }} className="text-[15px] text-gray-500 hover:text-gray-900 inline-flex items-center gap-1"><Plus className="w-3 h-3" /> Add</button>
            </div>
            <ul className="rounded-lg border border-gray-200 divide-y divide-gray-100">
              {group.length === 0 && adding !== name && <li className="px-3 py-2 text-sm text-gray-400">None. <span className="text-gray-300">Drag a deliverable here to move it.</span></li>}
              {group.map((d) => {
                const key = normKey(d.title);
                return (
                  <DraggableRow key={d.id} id={d.id}>
                    {({ setNodeRef, attributes, listeners, style, isDragging }) => (
                      <li ref={(el) => { refs.current[key] = el; setNodeRef(el); }} style={style} className={`group px-3 py-2 flex items-center gap-2 text-sm transition-colors ${isDragging ? "opacity-60 bg-white shadow" : ""} ${highlight === key ? "bg-amber-50" : ""}`}>
                        <button type="button" {...attributes} {...listeners} className="shrink-0 cursor-grab touch-none text-gray-300 hover:text-gray-500 active:cursor-grabbing" aria-label="Drag to another section" title="Drag to move to another section"><GripVertical className="w-4 h-4" /></button>
                        <span className="flex-1 text-gray-900">{d.title}</span>
                        {d.ownerRole && <span className="text-[15px] text-gray-500 inline-flex items-center gap-1"><UserCircle className="w-3 h-3" /> {d.ownerRole}</span>}
                        <span className={`text-[15px] rounded px-1.5 py-0.5 ${d.offsetStart == null ? "text-gray-400 bg-gray-50" : "text-gray-500 bg-gray-100"}`}>{tLabel(d.offsetStart, d.offsetEnd)}</span>
                        <button onClick={() => onRemove(d.id)} className="text-gray-300 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" aria-label="Remove deliverable"><X className="w-3.5 h-3.5" /></button>
                      </li>
                    )}
                  </DraggableRow>
                );
              })}
              {adding === name && (
                <li className="px-3 py-2 flex items-center gap-2 bg-gray-50">
                  <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") submit(name); if (e.key === "Escape") setAdding(null); }} placeholder="New deliverable" className="flex-1 px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
                  <button onClick={() => submit(name)} disabled={!title.trim()} className="px-2.5 py-1 bg-gray-900 text-white rounded text-[15px] disabled:opacity-40">Add</button>
                </li>
              )}
            </ul>
          </DroppableSection>
        );
      })}
      {/* Add a new phase to the template — it appears as its own section you can add deliverables to. */}
      {onAddPhase && (
        addingPhase ? (
          <div className="flex items-center gap-2">
            <input autoFocus value={phaseName} onChange={(e) => setPhaseName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && phaseName.trim()) { onAddPhase(phaseName); setPhaseName(""); setAddingPhase(false); } if (e.key === "Escape") { setPhaseName(""); setAddingPhase(false); } }} placeholder="New phase (e.g. Networking & wrap)" className="flex-1 px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
            <button onClick={() => { if (phaseName.trim()) { onAddPhase(phaseName); setPhaseName(""); setAddingPhase(false); } }} disabled={!phaseName.trim()} className="px-2.5 py-1 bg-gray-900 text-white rounded text-[15px] disabled:opacity-40">Add phase</button>
            <button onClick={() => { setPhaseName(""); setAddingPhase(false); }} className="text-[15px] text-gray-500 hover:text-gray-900">Cancel</button>
          </div>
        ) : (
          <button onClick={() => setAddingPhase(true)} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-dashed border-gray-300 text-sm text-gray-600 hover:bg-gray-50"><Plus className="w-4 h-4" /> Add phase</button>
        )
      )}
    </div>
    </DndContext>
  );
}

// ── Budget (categories + sizing rules — no invented ranges) ──────────────────
function Budget({ plan, engagements, onAdd, onRemove }: { plan: EventPlanning; engagements: EngagementWithCandidates[]; onAdd: (category: string) => void; onRemove: (id: string) => void }) {
  const sizingRules = plan.heuristics.filter((h) => /\$|budget|per|head|cost|spend|%/.test(h.toLowerCase()));
  const [draft, setDraft] = useState("");
  const add = () => { const c = draft.trim(); if (!c) return; onAdd(c); setDraft(""); };
  return (
    <div className="space-y-5">
      {plan.eventBudgetTarget != null && (
        <div className="rounded-lg bg-gray-50 border border-gray-200 px-3 py-2 text-sm"><span className="text-gray-500">Typical total</span> · <span className="text-gray-900 font-medium">{money(plan.eventBudgetTarget)}</span></div>
      )}
      <div>
        <h3 className="text-sm font-medium text-gray-700 mb-2">Cost categories</h3>
        <ul className="rounded-lg border border-gray-200 divide-y divide-gray-100 mb-2">
          {engagements.length === 0 && <li className="px-3 py-2 text-sm text-gray-400">No cost categories yet.</li>}
          {engagements.map((e) => (
            <li key={e.id} className="group px-3 py-2 flex items-center justify-between gap-3 text-sm">
              <span className="text-gray-900">{e.category}</span>
              <div className="flex items-center gap-3">
                <span className="text-[15px] text-gray-400">range fills in from spun-up events</span>
                <button onClick={() => onRemove(e.id)} className="text-gray-300 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity" aria-label="Remove cost category"><X className="w-3.5 h-3.5" /></button>
              </div>
            </li>
          ))}
        </ul>
        <div className="flex items-center gap-2">
          <input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add(); }} placeholder="Add a cost category (e.g. Catering)" className="flex-1 max-w-xs px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
          <button onClick={add} disabled={!draft.trim()} className="text-[15px] text-gray-500 hover:text-gray-900 disabled:opacity-40 inline-flex items-center gap-1"><Plus className="w-3 h-3" /> Add category</button>
        </div>
      </div>
      {sizingRules.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-gray-700 mb-2">Sizing rules</h3>
          <ul className="space-y-1.5 text-sm">
            {sizingRules.map((h, i) => <li key={i} className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-1.5 text-amber-900">{h}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

// ── Roles ────────────────────────────────────────────────────────────────────
function Roles({ roles, plan, onAdd }: { roles: string[]; plan: EventPlanning; onAdd: (role: string) => void }) {
  const [draft, setDraft] = useState("");
  // Count where a deliverable/step implies a quantity for the role (e.g. "3 pace leads").
  const countFor = (role: string): string | null => {
    const hay = [...plan.deliverables.map((d) => d.title), ...plan.walkthrough.map((s) => s.title)].join(" ").toLowerCase();
    const m = hay.match(new RegExp(`(\\d+)\\s+${role.toLowerCase().replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}`));
    return m ? `×${m[1]}` : null;
  };
  const add = () => { const r = draft.trim(); if (!r) return; onAdd(r); setDraft(""); };
  return (
    <div>
      {roles.length === 0 ? <p className="text-sm text-gray-400 mb-3">No staffing roles yet.</p> : (
        <div className="flex flex-wrap gap-2 mb-3">
          {roles.map((r, i) => (
            <span key={i} className="inline-flex items-center gap-1.5 text-sm bg-gray-100 text-gray-800 rounded-full px-3 py-1"><UserCircle className="w-3.5 h-3.5" /> {r}{countFor(r) && <span className="text-gray-500">{countFor(r)}</span>}</span>
          ))}
        </div>
      )}
      <div className="flex items-center gap-2">
        <input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add(); }} placeholder="Add a role (e.g. Photographer)" className="flex-1 max-w-xs px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
        <button onClick={add} disabled={!draft.trim()} className="text-[15px] text-gray-500 hover:text-gray-900 disabled:opacity-40 inline-flex items-center gap-1"><Plus className="w-3 h-3" /> Add role</button>
      </div>
    </div>
  );
}

// ── Outreach (expandable templates with [bracket] merge fields) ──────────────
function Outreach({ items, onAdd, onUpdate, onRemove }: { items: OutreachTemplate[]; onAdd: (o: OutreachTemplate) => void; onUpdate: (i: number, o: OutreachTemplate) => void; onRemove: (i: number) => void }) {
  const [open, setOpen] = useState<number | null>(0);
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const [title, setTitle] = useState("");
  const [whenToUse, setWhenToUse] = useState("");
  const [body, setBody] = useState("");
  const startNew = () => { setEditing("new"); setTitle(""); setWhenToUse(""); setBody(""); };
  const startEdit = (i: number) => { const o = items[i]; setEditing(i); setTitle(o.title); setWhenToUse(o.whenToUse); setBody(o.body); };
  const submit = () => {
    if (!title.trim()) return;
    const o = { title: title.trim(), whenToUse: whenToUse.trim(), body: body.trim() };
    if (editing === "new") onAdd(o); else if (typeof editing === "number") onUpdate(editing, o);
    setEditing(null);
  };
  const form = (
    <div className="rounded-lg border border-gray-300 p-3 space-y-2 bg-gray-50">
      <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Type (e.g. Slack invite, Personal DM)" className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
      <input value={whenToUse} onChange={(e) => setWhenToUse(e.target.value)} placeholder="When to use (optional)" className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
      <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} placeholder="Message copy — use [brackets] for merge fields like [name], [date]" className="w-full px-2 py-1 border border-gray-300 rounded text-sm resize-none focus:outline-none focus:ring-2 focus:ring-gray-300" />
      <div className="flex justify-end gap-2">
        <button onClick={() => setEditing(null)} className="text-sm text-gray-500 hover:text-gray-900">Cancel</button>
        <button onClick={submit} disabled={!title.trim()} className="px-3 py-1 bg-gray-900 text-white rounded text-[15px] disabled:opacity-40">{editing === "new" ? "Add template" : "Save"}</button>
      </div>
    </div>
  );
  return (
    <div className="space-y-2">
      {items.length === 0 && editing !== "new" && <p className="text-sm text-gray-400">No outreach templates yet.</p>}
      {items.map((o, i) => editing === i ? (
        <div key={i}>{form}</div>
      ) : (
        <div key={i} className="rounded-lg border border-gray-200 overflow-hidden">
          <div className="group flex items-center gap-2 px-3 py-2 hover:bg-gray-50">
            <button onClick={() => setOpen(open === i ? null : i)} className="flex-1 flex items-center gap-2 text-left min-w-0">
              <ChevronRight className={`w-4 h-4 text-gray-400 shrink-0 transition-transform ${open === i ? "rotate-90" : ""}`} />
              <span className="text-sm font-medium text-gray-900 truncate">{o.title}{o.whenToUse && <span className="text-gray-400 font-normal"> · {o.whenToUse}</span>}</span>
            </button>
            <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
              <button onClick={() => startEdit(i)} aria-label="Edit message"><Pencil className="w-3.5 h-3.5 text-gray-400 hover:text-gray-900" /></button>
              <button onClick={() => onRemove(i)} aria-label="Delete message"><X className="w-4 h-4 text-gray-400 hover:text-red-600" /></button>
            </div>
          </div>
          {open === i && (
            <div className="px-3 py-2 border-t border-gray-100 bg-gray-50">
              <p className="text-sm text-gray-700 whitespace-pre-wrap">{highlightMerge(o.body)}</p>
            </div>
          )}
        </div>
      ))}
      {editing === "new" ? form : (
        <button onClick={startNew} className="text-[15px] text-gray-500 hover:text-gray-900 inline-flex items-center gap-1 pt-1"><Plus className="w-3 h-3" /> Add outreach type</button>
      )}
    </div>
  );
}
// Render [bracket] merge fields as subtle chips inline.
function highlightMerge(body: string): React.ReactNode {
  const parts = body.split(/(\[[^\]]+\])/g);
  return parts.map((p, i) => /^\[[^\]]+\]$/.test(p)
    ? <span key={i} className="inline-block bg-amber-100 text-amber-800 rounded px-1 text-[15px] align-baseline">{p}</span>
    : <span key={i}>{p}</span>);
}

// ── Right rail: open slots filled on spin-up (computed from the gaps) ────────
function FilledOnSpinUp({ plan }: { plan: EventPlanning }) {
  const slots: string[] = [];
  slots.push("Date"); // a template is date-less by definition
  if (!plan.location) slots.push("Location");
  if (plan.startTime == null) slots.push("Start time");
  // Named vendors: each category has no chosen vendor yet.
  for (const e of plan.engagements) if (e.category && !e.candidates.some((c) => c.isSelected)) slots.push(e.category);
  // [bracket] merge fields seen in outreach/walkthrough.
  const brackets = new Set<string>();
  for (const o of plan.outreach) for (const m of o.body.matchAll(/\[([^\]]+)\]/g)) brackets.add(m[1]);
  for (const b of brackets) slots.push(`[${b}]`);

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-5">
      <h3 className="font-medium text-gray-900 mb-1">Filled on spin-up</h3>
      <p className="text-[15px] text-gray-400 mb-3">The gaps in this pattern — resolved when you spin up a real event.</p>
      <div className="flex flex-wrap gap-1.5">
        {slots.map((s, i) => (
          <span key={i} className="inline-flex items-center text-[15px] text-gray-500 border border-dashed border-gray-300 rounded-full px-2 py-0.5">{s}</span>
        ))}
      </div>
    </div>
  );
}

// ── Spin-up modal ─────────────────────────────────────────────────────────────
function SpinUpModal({ plan, eventId, onClose, onSpunUp }: { plan: EventPlanning; eventId: string; onClose: () => void; onSpunUp: (id: string) => void }) {
  const [name, setName] = useState(plan.title.replace(/\b(template|pattern|how to|guide)\b/gi, "").trim() || plan.title);
  const [date, setDate] = useState("");
  const [location, setLocation] = useState(plan.location ?? "");
  const [tag, setTag] = useState<string | null>(plan.tags[0] ?? null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const spin = async () => {
    setBusy(true); setErr(null);
    try {
      const id = await spinUpFromTemplate(eventId, { name: name.trim() || plan.title, date: date || null, location: location.trim() || null, tags: tag ? [tag] : [] });
      onSpunUp(id);
    } catch (e: any) { setErr(e.message ?? String(e)); setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl border border-gray-200 w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900 inline-flex items-center gap-2"><Rocket className="w-5 h-5" /> Spin up an event</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X className="w-5 h-5" /></button>
        </div>
        <p className="text-sm text-gray-500 mb-4">Creates a live event in Planning from this pattern — every offset resolves to a real date, and the walkthrough, principles, and outreach come with it.</p>
        <label className="block text-sm text-gray-600 mb-1">Event name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} className="w-full mb-3 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
        <label className="block text-sm text-gray-600 mb-1">Date</label>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full mb-3 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
        <label className="block text-sm text-gray-600 mb-1">Location <span className="text-gray-400">(optional)</span></label>
        <LocationInput value={location} onChange={setLocation} placeholder="City" className="w-full mb-3 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
        <label className="block text-sm text-gray-600 mb-1">Tag <span className="text-gray-400">(optional)</span></label>
        <div className="mb-4"><TagStack tags={tag ? [tag] : []} editable onChange={(arr) => setTag(arr[0] ?? null)} /></div>
        {err && <p className="text-sm text-red-600 mb-3">{err}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900">Cancel</button>
          <button onClick={spin} disabled={busy} className="inline-flex items-center gap-2 px-4 py-2 bg-gray-900 text-white rounded-lg text-sm hover:bg-gray-800 disabled:opacity-50">
            {busy ? "Spinning up…" : <>Spin up <ArrowRight className="w-4 h-4" /></>}
          </button>
        </div>
      </div>
    </div>
  );
}
