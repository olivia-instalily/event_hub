import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { TemplateView, enrichPhases, PHASE_COLORS } from "./TemplateView";
import { SourceMaterials } from "./SourceMaterials";
import { SlackCard, SlackCaptureList, type SlackCardModel } from "./SlackCard";
import {
  Calendar, Users, Plus, Trash2, Check, Paperclip,
  Lightbulb, ChevronRight, ChevronLeft, ExternalLink,
  Activity, X, Clock, RefreshCw, Link2, Code2, Globe, Lock, LockOpen, ArrowDown, ArrowUp, GripVertical, CalendarPlus, Star, Loader2, MoreVertical, Folder,
  UserPlus, DollarSign, ClipboardList, Sparkles,
} from "lucide-react";
import { DndContext, closestCenter, closestCorners, pointerWithin, PointerSensor, KeyboardSensor, useSensor, useSensors, useDraggable, useDroppable, DragOverlay, type DragEndEvent, type DragStartEvent } from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy, arrayMove, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  getEventPlanning, getCarriedLessons, updateEventTags, updateEvent, setEventDate, setEventFormat, attachLuma, unlinkLuma, createLumaEvent, resyncLumaEvent, resolveGcalMatch, pullEventFromLinear, syncEventToLinear, unlinkLinear, deleteEvent, resetEvent,
  setMacroStage,
  setEventFocus,
  importVendors,
  addDeliverable, setDeliverableStatus, setDeliverableDueDate, setDeliverablePhase, deleteDeliverable, setEventBenchmarks, setDeliverableBenchmark,
  getPlanningSummary, saveOverviewSummary,
  getEventPeopleStats, listAttendeesForEvent, scheduleDebrief,
  extractDebrief, proposeTagsFromDebrief, upsertBudgetLines, type DebriefExtract,
  extractForBackfill, enrichEventFromExtract, addBudgetActuals, deriveTemplateFromEvent, applyTemplateAdditions, listTemplates, adoptTemplate,
  uploadDocument, addSourceMaterial, deleteSourceMaterial, getSourceMaterials,
  setSettleState, setEventVerdict, saveDebriefNotes, settleEvent, setRoleAssignments, type SettleState,
  listEventTags, type EventPersonTag,
  type PersonView, type PeopleStats,
  setEventAgenda, setEventReflections,
  syncGmail,
  ejectPage, regeneratePageDraft, setPageFields, promoteToLive, listDevelopers, addDeveloper, removeDeveloper,
  type PageState, type Developer,
  MACRO_STAGES,
  type EventPlanning,
  type BudgetLineTracker, type Deliverable, type CarriedLesson,
  type PlanningFacts, type BudgetStatus,
  type EventPhase, type RunOfShowItem, type OutreachTemplate,
  setEventReferenceLinks, type ReferenceLink,
  saveSetupState,
  listSlackCaptures, runSlackScrape, confirmSlackCapture, dismissSlackCapture, discardCapture, editSlackCapture, setCaptureHome, setCaptureFlags, insertBudgetLine, findBudgetLineMatch, setBudgetLineAmountStatus, setBudgetLineSlackRef, setEventRoleSlackRefs, maxBudgetStatus, setEventStaffRoles, ensureEventBudget, type SlackCapture, type CaptureHome,
} from "../lib/db";
import { parseMoney, parsePersonRole, parseBudgetStatus } from "../lib/capturePromote";
import { visibleFlags, type SetupFlagKey } from "../lib/setupFlags";
import { PHASES, PHASE_LABEL, nextTagSelection, type Benchmark } from "../lib/phases";
import { TagStack } from "./TagStack";
import { FormatPicker, parseFormats, joinFormats } from "./FormatPicker";
import { Button } from "@instalily/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@instalily/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@instalily/ui/select";
import { LocationEdit } from "./LocationEdit";
import { EditableTitle } from "./EditableTitle";
import { DocLinkControl } from "./DocLinkControl";
import { StatusControl } from "./StatusControl";
import { EventPageBuilder } from "./EventPageBuilder";
import { CoverImage } from "./CoverImage";
import { OwnerPicker } from "./OwnerPicker";
import { StaffingEditor, AssigneePicker } from "./StaffingEditor";
import { UpcomingMeetings } from "./UpcomingMeetings";
import { useProfile } from "../lib/profile";
import { regenerateFromMaterials as runRegenerate } from "../lib/regenerate";
import { ConfirmModal } from "./Modal";
import { GCalSync } from "./GCalSync";
import { GcalLinkControl } from "./GcalLinkControl";
import { LinearSync } from "./LinearSync";
import { LinearUpdateBox } from "./LinearUpdateBox";
import { LinearLauncher } from "./LinearLauncher";
import { OpenInLinear } from "./OpenInLinear";
import { SeriesAttach } from "./SeriesAttach";
import { SlackChannelControl } from "./SlackChannelControl";
import { DateEdit } from "./DateEdit";
import { parseBudgetText } from "./BudgetImport";
import { BudgetTracker } from "./BudgetTracker";
import { parseVendors } from "../lib/vendorImport";
import { unsupportedFileMessage, isWorkbookFile } from "../lib/fileSupport";
import { BackfillModal } from "./BackfillModal";
import { SpeakerField } from "./SpeakerField";
import { filesFromDrop } from "../lib/drop";
import { SuggestedDeliverables } from "./SuggestedDeliverables";
import { BudgetProjections } from "./BudgetProjections";
import { PeoplePage } from "./PeoplePage";
import { fundingFor } from "../lib/scoping";
import { eventFocus, FOCUS_LABEL, type EventFocus } from "../lib/eventFocus";
import { templateAdditions, hasAdditions, matchTemplates, type TemplateMatch } from "../lib/backfill";
import { canonicalPhaseFor } from "../lib/phaseMerge";

interface Props {
  eventId: string;
  onBack: () => void;
  onOpenEvent?: (id: string) => void; // open a different event (e.g. one spun up from a template)
  onReview?: () => void; // reopen the review/generation page for this event (templates)
  onViewPeople: (filter: { id: string; name: string; tag?: string | null; status?: 'all' | 'registered' | 'checkedIn' | 'waitlisted' | 'speakers' }) => void;
}

const today = () => new Date().toISOString().slice(0, 10);
function money(n: number | null | undefined, currency = "USD"): string {
  if (n == null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(n);
}

const DELIVERABLE_PHASES = ["Planning", "Day-of", "Post"];
const STATUSES = ["Todo", "In Progress", "Done"];

// ── Macro-stage stepper ───────────────────────────────────────────────────────
// Attach (or show) a Luma link on the event — usable after creation.
type LumaDraft = { name: string; date: string | null; startTime: string | null; endTime: string | null; location: string | null; description: string };

// Only event-page (Luma) descriptions belong on the Luma description step — not channel
// messages (email, DM/Slack, thank-you notes, follow-up nudges, reminders).
function isLumaDescription(o: OutreachTemplate): boolean {
  const t = `${o.title} ${o.whenToUse}`.toLowerCase();
  if (/luma|description|event page|event blurb|listing|rsvp page|page copy|about the event/.test(t)) return true;
  return !/email|e-mail|slack|\bdm\b|direct message|\btext\b|sms|thank|follow.?up|nudge|reminder|recap|debrief|invite|message|post\b/.test(t);
}

/** Multi-step walkthrough that creates a Luma event from the event's info. Essentials first
 *  (you can create from there), then an optional Description page. People is on the roadmap. */
function CreateLumaModal({ eventId, draft, descriptions = [], onClose, onCreated }: { eventId: string; draft: LumaDraft; descriptions?: OutreachTemplate[]; onClose: () => void; onCreated: (url: string | null) => void }) {
  const [step, setStep] = useState<"essentials" | "description">("essentials");
  const [name, setName] = useState(draft.name);
  const [date, setDate] = useState(draft.date ?? "");
  const [startTime, setStartTime] = useState(draft.startTime ?? "18:00");
  const [endTime, setEndTime] = useState(draft.endTime ?? "");
  const [location, setLocation] = useState(draft.location ?? "");
  const [description, setDescription] = useState(draft.description ?? "");
  const [picked, setPicked] = useState<number | null>(null); // which template description is in use (null = custom)
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const create = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await createLumaEvent(eventId, { name: name.trim(), date: date || null, startTime: startTime || null, endTime: endTime || null, location: location.trim() || null, description: description.trim() || undefined });
      // Created private/unlisted — open it on Luma so the owner can finalize & publish.
      if (r.lumaUrl) window.open(r.lumaUrl, "_blank", "noopener");
      onCreated(r.lumaUrl);
    } catch (e: any) { setErr(e?.message ?? String(e)); setBusy(false); }
  };
  const canCreate = !busy && !!name.trim() && !!date;
  const field = "w-full px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-300";
  const createBtn = <Button onClick={create} disabled={!canCreate}>{busy ? "Creating…" : "Create on Luma"}</Button>;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl border border-border max-w-2xl w-full p-6 max-h-[88vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-2"><h2 className="text-xl">Create on Luma</h2><button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-900"><X className="w-5 h-5" /></button></div>
        <div className="flex items-center gap-1.5 text-[15px] mb-4">
          <span className={step === "essentials" ? "text-gray-900 font-medium" : "text-gray-400"}>1 · Essentials</span>
          <ChevronRight className="w-3 h-3 text-gray-300" />
          <span className={step === "description" ? "text-gray-900 font-medium" : "text-gray-400"}>2 · Description</span>
          <ChevronRight className="w-3 h-3 text-gray-300" />
          <span className="text-gray-300">3 · People (soon)</span>
        </div>

        {step === "essentials" ? (
          <>
            <p className="text-sm text-gray-500 mb-4">Creates it <span className="font-medium">private/unlisted</span> on Luma and opens it so you can finalize &amp; publish. Add more on the next page, or create now.</p>
            <div className="space-y-3">
              <label className="block"><span className="text-sm text-gray-600 mb-1 block">Name</span><input value={name} onChange={(e) => setName(e.target.value)} className={field} /></label>
              <div className="flex flex-wrap items-center gap-2">
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={field.replace("w-full", "")} />
                <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className={field.replace("w-full", "")} />
                <span className="text-gray-400">–</span>
                <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} className={field.replace("w-full", "")} />
              </div>
              <label className="block"><span className="text-sm text-gray-600 mb-1 block">Location</span><input value={location} onChange={(e) => setLocation(e.target.value)} className={field} /></label>
            </div>
            {err && <p className="text-red-600 text-sm mt-3">{err}</p>}
            <div className="flex items-center justify-between gap-2 mt-5">
              <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900">Cancel</button>
              <div className="flex items-center gap-2">
                <button onClick={() => setStep("description")} disabled={!name.trim() || !date} className="inline-flex items-center gap-1 px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50">Add description <ChevronRight className="w-4 h-4" /></button>
                {createBtn}
              </div>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-gray-500 mb-3">Optional — a description for the Luma event page.{descriptions.length > 0 ? " Use one from the template or write your own." : ""}</p>
            {descriptions.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 mb-2">
                {descriptions.map((o, i) => (
                  <button key={i} onClick={() => { setDescription(o.body); setPicked(i); }}
                    className={`text-[15px] rounded-full px-3 py-1 border transition-colors ${picked === i ? "bg-gray-900 text-white border-gray-900" : "border-gray-300 text-gray-700 hover:bg-gray-50"}`}>
                    {o.title.trim() || `Option ${i + 1}`}
                  </button>
                ))}
                {(picked !== null || description.trim()) && (
                  <button onClick={() => { setDescription(""); setPicked(null); }} className="text-[15px] text-gray-500 hover:text-gray-900 px-1">Clear</button>
                )}
              </div>
            )}
            <textarea value={description} onChange={(e) => { setDescription(e.target.value); setPicked(null); }} rows={14} placeholder="What's this event about? Agenda, who should come, what to expect…" className={`${field} resize-y min-h-[14rem]`} />
            {picked !== null && <p className="text-[15px] text-gray-400 mt-1">Previewing “{descriptions[picked].title.trim() || `Option ${picked + 1}`}” — edit it freely, pick another, or clear.</p>}
            {err && <p className="text-red-600 text-sm mt-3">{err}</p>}
            <div className="flex items-center justify-between gap-2 mt-5">
              <button onClick={() => setStep("essentials")} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900">← Back</button>
              {createBtn}
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

// Luma brand mark — the filled 4-point sparkle.
function LumaLogo({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path d="M12 0C12 6.6 6.6 12 0 12C6.6 12 12 17.4 12 24C12 17.4 17.4 12 24 12C17.4 12 12 6.6 12 0Z" fill="#0F0F0F" />
    </svg>
  );
}

function LumaAttach({ eventId, initialUrl, draft, descriptions }: { eventId: string; initialUrl: string | null; draft: LumaDraft; descriptions?: OutreachTemplate[] }) {
  const [url, setUrl] = useState(initialUrl);
  const [mode, setMode] = useState<"idle" | "menu" | "attach" | "create">("idle");
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ eventId: string; name: string | null } | null>(null); // Luma already on another event

  const attach = async (force = false) => {
    const u = input.trim(); if (!u) return;
    setBusy(true); setErr(null);
    try {
      const r = await attachLuma(eventId, u, force);
      if ("conflict" in r) { setConflict(r.conflict); return; }   // already linked elsewhere → ask before duplicating
      setUrl(r.lumaUrl ?? u); setMode("idle"); setInput(""); setConflict(null);
    }
    catch (e: any) { setErr(e?.message ?? String(e)); }
    finally { setBusy(false); }
  };

  const unlink = async () => {
    setBusy(true); setErr(null);
    try { await unlinkLuma(eventId); setUrl(null); setMode("idle"); setInput(""); }
    catch (e: any) { setErr(e?.message ?? String(e)); }
    finally { setBusy(false); }
  };

  // Linked: the Luma link + a ⋮ menu to relink (attach a different URL) or unlink. The relink path
  // reuses the "attach" input below; a new URL overwrites the link.
  if (url && mode !== "attach") return (
    <span className="relative inline-flex items-center gap-1">
      <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900"><LumaLogo /> Luma</a>
      <button onClick={() => setMode(mode === "menu" ? "idle" : "menu")} title="Change or unlink" className="text-gray-300 hover:text-gray-700"><MoreVertical className="w-4 h-4" /></button>
      {mode === "menu" && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setMode("idle")} />
          <div className="absolute left-0 top-full z-40 mt-1 w-40 rounded-lg border border-border bg-white p-1 text-sm shadow-lg">
            <button onClick={() => { setInput(url ?? ""); setMode("attach"); }} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-gray-700 hover:bg-gray-50"><Link2 className="w-4 h-4" /> Relink…</button>
            <button onClick={() => void unlink()} disabled={busy} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-red-600 hover:bg-gray-50 disabled:opacity-50"><X className="w-4 h-4" /> {busy ? "Unlinking…" : "Unlink"}</button>
          </div>
        </>
      )}
      {err && <span className="text-[13px] text-red-600">{err}</span>}
    </span>
  );

  if (mode === "menu") return (
    <span className="inline-flex items-center gap-1">
      <Button variant="secondary" size="sm" onClick={() => setMode("attach")}>Attach link</Button>
      <Button size="sm" onClick={() => setMode("create")}>Create on Luma</Button>
      <button onClick={() => setMode("idle")} className="text-gray-400 hover:text-gray-700"><X className="w-4 h-4" /></button>
    </span>
  );
  if (mode === "attach") return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <input autoFocus value={input} onChange={(e) => { setInput(e.target.value); setConflict(null); }} onKeyDown={(e) => { if (e.key === "Enter") attach(); }} placeholder="luma.com/…" className="px-2 py-1 border border-border rounded text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
      <button onClick={() => attach()} disabled={busy || !input.trim()} className="px-2 py-1 bg-gray-200 rounded text-sm hover:bg-gray-300 disabled:opacity-50">{busy ? "…" : "Attach"}</button>
      <button onClick={() => { setMode("menu"); setConflict(null); }} className="text-gray-400 hover:text-gray-700"><X className="w-4 h-4" /></button>
      {conflict && (
        <span className="w-full mt-1 flex items-center gap-2 text-[12px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2 py-1">
          Already synced as <span className="font-medium">“{conflict.name ?? "another event"}”</span>. Use that one to avoid a duplicate, or
          <button onClick={() => attach(true)} disabled={busy} className="font-medium text-amber-800 underline hover:text-amber-900 disabled:opacity-50">attach here anyway</button>.
        </span>
      )}
      {err && <span className="text-[15px] text-red-600">{err}</span>}
    </span>
  );
  return (
    <>
      <button onClick={() => setMode("menu")} className="inline-flex items-center gap-1.5 text-[13px] text-gray-500 hover:text-gray-900 border border-gray-300 rounded-lg px-2.5 py-1 hover:bg-gray-50 transition-colors"><LumaLogo /> Luma</button>
      {mode === "create" && <CreateLumaModal eventId={eventId} draft={draft} descriptions={descriptions} onClose={() => setMode("idle")} onCreated={(u) => { setUrl(u); setMode("idle"); }} />}
    </>
  );
}

// Manual, add-only Luma re-pull — shown on PAST (wrapped) events, which the background sync leaves
// frozen. For when guests were added on Luma after the event; never overwrites or removes existing
// attendees, only inserts what's new. Reloads the page on any change so turnout reflects it.
function LumaResync({ eventId, onDone }: { eventId: string; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const run = async () => {
    setBusy(true); setMsg(null);
    try {
      const { added, linked } = await resyncLumaEvent(eventId);
      const changed = added + linked;
      setMsg(changed ? `Added ${added} new attendee${added === 1 ? "" : "s"}.` : "Up to date — nothing new on Luma.");
      if (changed) onDone();
    } catch (e: any) { setMsg(e?.message ?? String(e)); }
    finally { setBusy(false); }
  };
  return (
    <span className="inline-flex items-center gap-1.5">
      <button onClick={run} disabled={busy} title="Pull late Luma additions (add-only — never overwrites)" className="inline-flex items-center gap-1 text-sm text-gray-400 hover:text-gray-700 disabled:opacity-50">
        <RefreshCw className={`w-4 h-4 ${busy ? "animate-spin" : ""}`} /> {busy ? "Resyncing…" : "Resync Luma"}
      </button>
      {msg && <span className="text-[12px] text-gray-400">{msg}</span>}
    </span>
  );
}

// Concept & Planning are chosen by you; Week-of / Live / Wrap are reached
// automatically based on the event date (not clickable).
const MANUAL_STAGES = 2; // indices 0,1 are self-determined

// Kept (exported so it's not flagged unused) — the Concept…Wrap rail was removed from the header
// "for now"; re-mount it when we want the phase timeline back.
export function MacroStepper({ eventId, initial, eventDate }: { eventId: string; initial: string | null; eventDate: string | null }) {
  const [stage, setStage] = useState(initial);

  // Time-derived stage from the date: past → Wrap, day-of → Live, within a week →
  // Week-of, else not yet (manual governs).
  let timeIdx = -1;
  if (eventDate) {
    const days = Math.round((new Date(eventDate + "T00:00:00").getTime() - new Date(today() + "T00:00:00").getTime()) / 86400000);
    timeIdx = days < 0 ? 4 : days === 0 ? 3 : days <= 7 ? 2 : -1;
  }
  const manualIdx = Math.max(0, MACRO_STAGES.indexOf((stage ?? "") as any));
  const currentIdx = Math.max(manualIdx, timeIdx);

  // Concept/Planning are self-chosen; the later stages are normally date-derived. But any
  // stage can be clicked to override the date rule (e.g. to fill in / test a wrapped event).
  const set = (s: string) => { setStage(s); void setMacroStage(eventId, s); };

  return (
    <div className="flex items-center gap-1 flex-wrap">
      {MACRO_STAGES.map((s, i) => {
        const done = i < currentIdx;
        const cur = i === currentIdx;
        const manual = i < MANUAL_STAGES;
        const base = cur ? "bg-gray-900 text-white border-gray-900"
          : done ? "bg-gray-100 text-gray-700 border-gray-300"
          : "bg-white text-gray-400 border-gray-200";
        return (
          <div key={s} className="flex items-center">
            <button
              onClick={() => set(s)}
              title={manual ? undefined : "Normally reached automatically by date — click to set manually"}
              className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-sm border transition-colors cursor-pointer hover:border-gray-400 ${base}`}
            >
              {s}
              {!manual && <Clock className="w-3 h-3 opacity-60" />}
            </button>
            {i < MACRO_STAGES.length - 1 && <ChevronRight className="w-4 h-4 text-gray-300 mx-0.5" />}
          </div>
        );
      })}
    </div>
  );
}

// ── Budget tracker ──────────────────────────────────────────────────────────
const BUDGET_STATUS_META: Record<BudgetStatus, { label: string; badge: string; ring: string }> = {
  estimate:  { label: "Estimate",  badge: "bg-gray-100 text-gray-600",   ring: "ring-gray-300" },
  quoted:    { label: "Quoted",    badge: "bg-blue-100 text-blue-700",   ring: "ring-blue-400" },
  paid:      { label: "Paid",      badge: "bg-green-100 text-green-700", ring: "ring-green-400" },
};


// ── Benchmark Editor ────────────────────────────────────────────────────────
// Collapsible panel for adding / renaming / removing / reordering an event's benchmarks within its fixed phases.
function BenchmarkEditor({
  eventId,
  benchmarks,
  deliverables,
  setPlan,
}: {
  eventId: string;
  benchmarks: Benchmark[];
  deliverables: { id: string; benchmarkId: string | null }[];
  setPlan: React.Dispatch<React.SetStateAction<EventPlanning | null>>;
}) {
  const [open, setOpen] = useState(false);
  // addName keyed by phase
  const [addNames, setAddNames] = useState<Record<string, string>>({});
  // editName keyed by benchmark id
  const [editNames, setEditNames] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const persist = async (next: Benchmark[], updatedDeliverables?: typeof deliverables) => {
    setBusy(true);
    try {
      await setEventBenchmarks(eventId, next);
      setPlan((p) => {
        if (!p) return p;
        const newDelivs = updatedDeliverables ?? p.deliverables;
        return { ...p, benchmarks: next, deliverables: newDelivs as typeof p.deliverables };
      });
    } catch {
      // best-effort — let the UI update stand; the user can refresh
    } finally {
      setBusy(false);
    }
  };

  const handleAdd = async (phase: string) => {
    const name = (addNames[phase] ?? "").trim();
    if (!name) return;
    const phaseItems = benchmarks.filter((b) => b.phase === phase);
    const order = phaseItems.length > 0 ? Math.max(...phaseItems.map((b) => b.order)) + 1 : 0;
    const id = `bm-${Date.now()}-${order}`;
    const next = [...benchmarks, { id, name, phase: phase as Benchmark["phase"], order }];
    setAddNames((m) => ({ ...m, [phase]: "" }));
    await persist(next);
  };

  const handleRename = async (id: string, newName: string) => {
    newName = newName.trim();
    const bm = benchmarks.find((b) => b.id === id);
    if (!newName || !bm || newName === bm.name) return;
    const next = benchmarks.map((b) => b.id === id ? { ...b, name: newName } : b);
    await persist(next);
  };

  const handleRemove = async (id: string) => {
    const next = benchmarks
      .filter((b) => b.id !== id)
      .map((b, _i, arr) => {
        // re-order within the same phase
        const phaseItems = arr.filter((x) => x.phase === b.phase).sort((a, c) => a.order - c.order);
        const newOrder = phaseItems.findIndex((x) => x.id === b.id);
        return { ...b, order: newOrder >= 0 ? newOrder : b.order };
      });
    // Reassign deliverables that used this benchmark to null
    const affected = deliverables.filter((d) => d.benchmarkId === id);
    const updatedDeliverables = deliverables.map((d) => d.benchmarkId === id ? { ...d, benchmarkId: null } : d);
    await Promise.all(affected.map((d) => setDeliverableBenchmark(d.id, null).catch(() => {})));
    await persist(next, updatedDeliverables);
  };

  const handleMove = async (id: string, dir: -1 | 1) => {
    const bm = benchmarks.find((b) => b.id === id);
    if (!bm) return;
    const phaseItems = benchmarks
      .filter((b) => b.phase === bm.phase)
      .sort((a, b) => a.order - b.order);
    const idx = phaseItems.findIndex((b) => b.id === id);
    const swapIdx = idx + dir;
    if (swapIdx < 0 || swapIdx >= phaseItems.length) return;
    // Swap orders between the two items
    const swapId = phaseItems[swapIdx].id;
    const next = benchmarks.map((b) => {
      if (b.id === id) return { ...b, order: swapIdx };
      if (b.id === swapId) return { ...b, order: idx };
      return b;
    });
    await persist(next);
  };

  const handleChangePhase = async (id: string, newPhase: string) => {
    const bm = benchmarks.find((b) => b.id === id);
    if (!bm || newPhase === bm.phase) return;
    const phaseItems = benchmarks.filter((b) => b.phase === newPhase && b.id !== id);
    const newOrder = phaseItems.length > 0 ? Math.max(...phaseItems.map((b) => b.order)) + 1 : 0;
    const next = benchmarks.map((b) => b.id === id ? { ...b, phase: newPhase as Benchmark["phase"], order: newOrder } : b);
    await persist(next);
  };

  return (
    <div className="bg-white rounded-2xl border border-border mb-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-5 py-3 text-sm text-gray-600 hover:text-gray-900"
      >
        <span className="font-medium">Edit benchmarks</span>
        <ChevronRight className={`w-4 h-4 transition-transform ${open ? "rotate-90" : ""}`} />
      </button>
      {open && (
        <div className="px-5 pb-4 space-y-4">
          {PHASES.map((phase) => {
            const phaseItems = benchmarks
              .filter((b) => b.phase === phase)
              .sort((a, b) => a.order - b.order);
            return (
              <div key={phase}>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5">{PHASE_LABEL[phase]}</p>
                <div className="space-y-1.5">
                  {phaseItems.map((bm, i) => {
                    const editing = editNames[bm.id] ?? bm.name;
                    return (
                      <div key={bm.id} className="flex items-center gap-2">
                        <input
                          className="flex-1 min-w-0 px-2 py-1 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-300"
                          value={editing}
                          onChange={(e) => setEditNames((m) => ({ ...m, [bm.id]: e.target.value }))}
                          onBlur={() => {
                            const v = editNames[bm.id];
                            if (v !== undefined && v.trim() && v.trim() !== bm.name) {
                              void handleRename(bm.id, v.trim());
                            }
                            setEditNames((m) => { const n = { ...m }; delete n[bm.id]; return n; });
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") e.currentTarget.blur();
                            if (e.key === "Escape") {
                              setEditNames((m) => { const n = { ...m }; delete n[bm.id]; return n; });
                            }
                          }}
                          disabled={busy}
                        />
                        <select
                          className="text-xs border border-gray-200 rounded-lg px-1.5 py-1 text-gray-600 focus:outline-none focus:ring-2 focus:ring-gray-300 disabled:opacity-40"
                          value={bm.phase}
                          onChange={(e) => void handleChangePhase(bm.id, e.target.value)}
                          disabled={busy}
                        >
                          {PHASES.map((ph) => (
                            <option key={ph} value={ph}>{PHASE_LABEL[ph]}</option>
                          ))}
                        </select>
                        <button
                          type="button"
                          disabled={busy || i === 0}
                          onClick={() => void handleMove(bm.id, -1)}
                          className="p-1 text-gray-400 hover:text-gray-700 disabled:opacity-30"
                          title="Move up"
                        ><ArrowUp className="w-3.5 h-3.5" /></button>
                        <button
                          type="button"
                          disabled={busy || i === phaseItems.length - 1}
                          onClick={() => void handleMove(bm.id, 1)}
                          className="p-1 text-gray-400 hover:text-gray-700 disabled:opacity-30"
                          title="Move down"
                        ><ArrowDown className="w-3.5 h-3.5" /></button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void handleRemove(bm.id)}
                          className="p-1 text-gray-400 hover:text-red-600 disabled:opacity-30"
                          title={`Remove "${bm.name}"`}
                        ><X className="w-3.5 h-3.5" /></button>
                      </div>
                    );
                  })}
                  <div className="flex items-center gap-2 pt-0.5">
                    <input
                      className="flex-1 min-w-0 px-2 py-1 text-sm border border-dashed border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-300 placeholder:text-gray-400"
                      placeholder={`Add ${PHASE_LABEL[phase]} benchmark…`}
                      value={addNames[phase] ?? ""}
                      onChange={(e) => setAddNames((m) => ({ ...m, [phase]: e.target.value }))}
                      onKeyDown={(e) => { if (e.key === "Enter") void handleAdd(phase); }}
                      disabled={busy}
                    />
                    <button
                      type="button"
                      onClick={() => void handleAdd(phase)}
                      disabled={busy || !(addNames[phase] ?? "").trim()}
                      className="inline-flex items-center gap-1 px-3 py-1 text-sm border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-40"
                    ><Plus className="w-3.5 h-3.5" /> Add</button>
                  </div>
                </div>
              </div>
            );
          })}
          {busy && <p className="text-xs text-gray-400">Saving…</p>}
        </div>
      )}
    </div>
  );
}

// ── Deliverables ────────────────────────────────────────────────────────────
// Relative-offset label (T-14, T0, T+5, or a T-14→T-1 range) for a deliverable.
function tOffsetLabel(start: number | null, end: number | null): string | null {
  if (start == null) return null;
  const f = (n: number) => (n === 0 ? "T0" : n > 0 ? `T+${n}` : `T${n}`);
  return end != null && end !== start ? `${f(start)}→${f(end)}` : f(start);
}
// dnd-kit sortable wrapper for a deliverable row — exposes drag mechanics to the row via a
// render-prop so the row's own controls (checkbox/status/date) stay clickable; only the grip drags.
type RowHandle = Pick<ReturnType<typeof useSortable>, "setNodeRef" | "attributes" | "listeners" | "isDragging"> & { style: React.CSSProperties };
function SortableRow({ id, children }: { id: string; children: (h: RowHandle) => React.ReactNode }) {
  const s = useSortable({ id });
  const style: React.CSSProperties = { transform: CSS.Transform.toString(s.transform), transition: s.transition };
  return <>{children({ setNodeRef: s.setNodeRef, style, attributes: s.attributes, listeners: s.listeners, isDragging: s.isDragging })}</>;
}

// Drop zone IDs use the section anchor scheme: "delsec-<phase>" or "delsec-bm-<benchmarkId>".
// This lets onDragEnd decode them AND the section ids double as click-to-jump anchors (Task 6).
function PhaseDropZone({ phase, children }: { phase: string; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: `delsec-${phase}` });
  return <div ref={setNodeRef} className={`rounded-lg transition-shadow ${isOver ? "ring-2 ring-primary/50" : ""}`}>{children}</div>;
}
function BenchmarkDropZone({ benchmarkId, children }: { benchmarkId: string; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: `delsec-bm-${benchmarkId}` });
  return <div ref={setNodeRef} className={`rounded-lg transition-shadow ${isOver ? "ring-2 ring-primary/50" : ""}`}>{children}</div>;
}

function Deliverables({ eventId, initial, phases, benchmarks, markers, currentKey, jumpId, linearProjectUrl, onLinearSynced, onOpenReflection }: { eventId: string; initial: Deliverable[]; phases: EventPhase[]; benchmarks: Benchmark[]; markers: OvMarker[]; currentKey: string; jumpId?: string | null; linearProjectUrl?: string | null; onLinearSynced?: () => void; onOpenReflection?: () => void }) {
  const [items, setItems] = useState(initial);
  const [adding, setAdding] = useState<string | null>(null); // phase being added to
  const [title, setTitle] = useState("");
  const [owner, setOwner] = useState("");
  const [due, setDueInput] = useState("");
  // Tag filter — single-select toggle (click same tag to clear).
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const groupRefs = useRef<Record<string, HTMLDivElement | null>>({});
  // Deep-link from the Overview: scroll to and highlight a specific deliverable until next click.
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [highlight, setHighlight] = useState<string | null>(null);
  useEffect(() => { if (!jumpId) return; const el = rowRefs.current[jumpId]; if (el) { el.scrollIntoView({ behavior: "smooth", block: "center" }); setHighlight(jumpId); } }, [jumpId, items.length]);
  useEffect(() => {
    if (!highlight) return;
    const clear = () => setHighlight(null);
    const id = setTimeout(() => document.addEventListener("mousedown", clear, { once: true }), 0);
    return () => { clearTimeout(id); document.removeEventListener("mousedown", clear); };
  }, [highlight]);
  // Multi-select for bulk status changes.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const toggleSel = (id: string) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  // Toggle a set of ids all-on / all-off (for the top + per-section "select all").
  const toggleMany = (ids: string[], on: boolean) => setSelected((s) => { const n = new Set(s); ids.forEach((id) => (on ? n.add(id) : n.delete(id))); return n; });
  const applyStatus = async (ids: string[], status: string) => {
    if (!ids.length) return;
    const idSet = new Set(ids);
    setItems((p) => p.map((d) => (idSet.has(d.id) ? { ...d, status } : d)));
    setSelected((s) => { const n = new Set(s); ids.forEach((id) => n.delete(id)); return n; });
    await Promise.all(ids.map((id) => setDeliverableStatus(id, status).catch(() => {})));
  };

  const total = items.length;
  const done = items.filter((d) => d.status === "Done").length;
  const pct = total ? Math.round((done / total) * 100) : 0;

  const setStatus = async (id: string, status: string) => {
    setItems((p) => p.map((d) => (d.id === id ? { ...d, status } : d)));
    await setDeliverableStatus(id, status);
  };
  const setDue = async (id: string, dueDate: string | null) => {
    setItems((p) => p.map((d) => (d.id === id ? { ...d, dueDate } : d)));
    await setDeliverableDueDate(id, dueDate);
  };
  const remove = async (id: string) => {
    await deleteDeliverable(id);
    setItems((p) => p.filter((d) => d.id !== id));
  };
  const add = async (phase: string) => {
    const t = title.trim();
    if (!t) return;
    const d = await addDeliverable(eventId, { title: t, phase, ownerRole: owner.trim() || null, dueDate: due || null });
    setItems((p) => [...p, d]);
    setTitle(""); setOwner(""); setDueInput(""); setAdding(null);
  };

  // Same enriched phases the template timeline uses: the event's phases (carried from its
  // template) if any, else the default 4-phase scheme. Drives both the rail and the grouping.
  const railPhases = enrichPhases({ phases, walkthrough: [], deliverables: items }, DELIVERABLE_PHASES);
  const colorOf = new Map(railPhases.map((p) => [p.name, p.color])); // phase → its timeline color
  const jumpToGroup = (name: string) => {
    // `name` may arrive as a PHASES key ("planning") or as an enriched/display label ("Planning").
    // groupRefs is keyed by PHASES keys, so resolve the key first.
    const phaseKey = (PHASES as readonly string[]).includes(name)
      ? name
      : PHASES.find((k) => PHASE_LABEL[k] === name) ?? name;
    groupRefs.current[phaseKey]?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  // Timeline click on Deliverables → scroll to the phase or benchmark section (not a view switch).
  const jumpToMarker = (key: string) => {
    if (key.startsWith("phase:")) jumpToGroup(key.slice("phase:".length));
    else if (key.startsWith("bm:")) document.getElementById(`delsec-bm-${key.slice("bm:".length)}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  // Per-phase completion (done deliverables / total) — drives the rail's segment fills + check-offs.
  // rp.name may be a CAPITALIZED display label ("Planning") while d.phase is a lowercase key
  // ("planning"). Resolve rp.name to its phase key before comparing so the filter always matches.
  const railProgress: Record<string, number> = {};
  for (const rp of railPhases) {
    const phaseKey = (PHASES as readonly string[]).includes(rp.name)
      ? rp.name
      : PHASES.find((k) => PHASE_LABEL[k] === rp.name) ?? rp.name;
    const grp = items.filter((d) => d.phase === phaseKey);
    railProgress[rp.name] = grp.length ? grp.filter((d) => d.status === "Done").length / grp.length : 0;
  }
  // Measure the sticky bulk-select bar so a jumped-to group lands just below it.
  const stickyRef = useRef<HTMLDivElement | null>(null);
  const [headerH, setHeaderH] = useState(96);
  useEffect(() => {
    const el = stickyRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHeaderH(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, [railPhases.length, total]);

  // Tracks which deliverable is currently being dragged, so DragOverlay can render its clone.
  const [activeId, setActiveId] = useState<string | null>(null);

  // Drag-to-reorder deliverables within a phase. T-offsets are predetermined, so reordering is a
  // manual arrangement only — it does NOT change any task's time.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const onDragStart = (e: DragStartEvent) => setActiveId(String(e.active.id));
  const onDragCancel = () => setActiveId(null);
  const onDragEnd = (e: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = e;
    if (!over) return;
    const a = items.find((d) => d.id === active.id);
    if (!a) return;
    const overId = String(over.id);

    // Decode the drop target: section anchor ids or a peer deliverable row.
    // "delsec-bm-<id>" → benchmark zone; "delsec-<phase>" → phase zone (null benchmark); else peer row.
    let targetPhase: string | null = null;
    let targetBenchmarkId: string | null | undefined = undefined; // undefined = "don't change"
    if (overId.startsWith("delsec-bm-")) {
      const bmId = overId.slice("delsec-bm-".length);
      const bm = benchmarks.find((b) => b.id === bmId);
      if (!bm) return;
      targetPhase = bm.phase;
      targetBenchmarkId = bmId;
    } else if (overId.startsWith("delsec-")) {
      targetPhase = overId.slice("delsec-".length);
      targetBenchmarkId = null; // drop on phase zone → clear benchmark
    } else {
      // Dropped on a peer row — inherit that row's phase + benchmark.
      const overRow = items.find((d) => d.id === overId);
      if (!overRow) return;
      targetPhase = overRow.phase;
      targetBenchmarkId = overRow.benchmarkId; // keep same benchmark as the peer
    }
    if (targetPhase == null) return;

    const sameGroup = targetPhase === a.phase && targetBenchmarkId === a.benchmarkId;

    if (sameGroup) {
      // Reorder within the same phase+benchmark group (T-offsets don't change — manual only).
      if (active.id === over.id) return;
      setItems((prev) => {
        const ids = prev.filter((d) => d.phase === a.phase && d.benchmarkId === a.benchmarkId).map((d) => d.id);
        const overIdx = ids.indexOf(overId);
        if (overIdx === -1) return prev; // dropped on zone, not a row → no reorder
        const reordered = arrayMove(ids, ids.indexOf(a.id), overIdx);
        const byId = new Map(prev.map((d) => [d.id, d]));
        const q = [...reordered];
        return prev.map((d) => (d.phase === a.phase && d.benchmarkId === a.benchmarkId ? byId.get(q.shift()!)! : d));
      });
      return;
    }

    // Cross-group: update phase + benchmarkId, optimistic then persist.
    const newBenchmarkId = targetBenchmarkId !== undefined ? targetBenchmarkId : a.benchmarkId;
    setItems((prev) => {
      const item = { ...prev.find((d) => d.id === a.id)!, phase: targetPhase!, benchmarkId: newBenchmarkId };
      const rest = prev.filter((d) => d.id !== a.id);
      const overRowIdx = rest.findIndex((d) => d.id === overId);
      if (overRowIdx >= 0) { rest.splice(overRowIdx, 0, item); return rest; }
      return [...rest, item];
    });
    if (targetPhase !== a.phase) setDeliverablePhase(a.id, targetPhase).catch(() => {});
    if (newBenchmarkId !== a.benchmarkId) setDeliverableBenchmark(a.id, newBenchmarkId).catch(() => {});
  };

  // All distinct tags across live items — includes any tags added in-session.
  const allTags = Array.from(new Set(items.flatMap((d) => d.tags)));
  // Rows visible after applying the tag filter.
  const visibleItems = tagFilter ? items.filter((d) => d.tags.includes(tagFilter)) : items;

  // Shared row content — used both inside SortableRow and inside the DragOverlay clone.
  // overlay=true: renders with lifted visual (shadow + ring), no ref wiring, full opacity.
  // isDragging=true (in-place): renders as a faint placeholder so the slot doesn't collapse.
  const renderRowInner = (
    d: (typeof items)[number],
    opts: {
      attributes?: React.HTMLAttributes<HTMLElement>;
      listeners?: Record<string, unknown>;
      isDragging?: boolean;
      overlay?: boolean;
    },
  ) => {
    const { attributes, listeners, isDragging, overlay } = opts;
    const overdue = d.dueDate && d.dueDate < today() && d.status !== "Done";
    const rowCls = [
      "px-3 py-2 flex items-center gap-3 text-sm group scroll-mt-24 transition-colors",
      overlay ? "shadow-lg ring-1 ring-gray-300 rounded-lg bg-white opacity-100" : "",
      isDragging && !overlay ? "opacity-40" : "",
      !overlay && !isDragging ? (highlight === d.id ? "bg-amber-50" : selected.has(d.id) ? "bg-gray-50" : "") : "",
    ].filter(Boolean).join(" ");
    return (
      <div className={rowCls}>
        <button type="button" {...(attributes ?? {})} {...(listeners ?? {})} className="shrink-0 cursor-grab touch-none text-gray-300 hover:text-gray-500 active:cursor-grabbing" aria-label="Drag to reorder or move phase" title="Drag to reorder or move to a different phase/benchmark"><GripVertical className="w-4 h-4" /></button>
        <input type="checkbox" checked={selected.has(d.id)} onChange={() => toggleSel(d.id)} className="rounded border-gray-300 shrink-0" aria-label={`Select ${d.title}`} />
        {/* Content block: title + date on a single flex row so they stay centered with the controls. */}
        <div className="flex flex-1 items-center gap-2 min-w-0 self-center">
          <span className={`flex-1 min-w-0 truncate inline-flex items-center gap-1.5 ${d.status === "Done" ? "line-through text-gray-400" : ""}`}>
            {d.title}
            {d.linearIssueUrl && (
              <a href={d.linearIssueUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} title="Open issue in Linear" className="inline-flex text-purple-600 hover:text-purple-800 no-underline"><Activity className="w-3.5 h-3.5" /></a>
            )}
            {onOpenReflection && /reflection/i.test(d.title) && (
              <button onClick={(e) => { e.stopPropagation(); onOpenReflection(); }} title="Open the post-event reflection" className="inline-flex items-center gap-0.5 text-gray-500 hover:text-gray-900 text-[13px]">
                <ExternalLink className="w-3.5 h-3.5" /> Open
              </button>
            )}
          </span>
          <span className="shrink-0 inline-flex items-center gap-1.5 text-[13px] text-gray-500">
            {tOffsetLabel(d.offsetStart, d.offsetEnd) && <span className="text-gray-400 bg-gray-100 rounded px-1">{tOffsetLabel(d.offsetStart, d.offsetEnd)}</span>}
            {overdue && <span className="text-red-600 font-medium">overdue</span>}
            <DateEdit value={d.dueDate} onChange={(iso) => setDue(d.id, iso)} placeholder="add due date" emphasize={!!overdue} />
          </span>
        </div>
        {/* People/outreach tag — placeholder for a future outreach page. */}
        <button title="People & outreach for this task — coming soon" className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[13px] border border-gray-300 text-gray-600 hover:bg-gray-50 shrink-0">
          <Users className="w-3 h-3" /> {d.ownerRole ?? "People"}
        </button>
        <Select value={d.status ?? "Todo"} onValueChange={(v) => setStatus(d.id, v as string)} items={STATUSES.map((s) => ({ value: s, label: s }))}>
          <SelectTrigger size="sm" className="shrink-0 text-[13px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            {STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
        {d.locked
          ? <span title="Required — can't be removed" className="text-gray-300 shrink-0"><Lock className="w-3.5 h-3.5" /></span>
          : <button onClick={() => remove(d.id)} className="text-gray-300 hover:text-red-600 opacity-0 group-hover:opacity-100" aria-label="Delete"><Trash2 className="w-3.5 h-3.5" /></button>}
      </div>
    );
  };

  // Helper: render a list of deliverable rows inside a SortableContext.
  const renderRows = (group: typeof items) => group.map((d) => (
    <SortableRow key={d.id} id={d.id}>
      {({ setNodeRef, style, attributes, listeners, isDragging }) => (
        <div ref={(el) => { rowRefs.current[d.id] = el; setNodeRef(el); }} style={style}>
          {renderRowInner(d, { attributes, listeners, isDragging })}
        </div>
      )}
    </SortableRow>
  ));

  return (
    <div className="bg-white rounded-2xl border border-border p-6">
      {/* Timeline header + progress scroll away; the rail and bulk-select bar pin together below
          as ONE sticky header with a single bottom divider (no double line). */}
      <div className="flex items-center justify-end gap-3 mb-3">
        <LinearSync eventId={eventId} projectUrl={linearProjectUrl} count={total} onSynced={onLinearSynced} />
      </div>
      <div className="flex items-center justify-between mb-1">
        <p className="text-sm text-gray-600">{done}/{total} done</p>
        <p className={`text-sm ${pct >= 100 ? "text-green-600" : "text-gray-600"}`}>{pct}%</p>
      </div>
      <div className="h-2 bg-gray-100 rounded-full mb-4 overflow-hidden">
        <div className={`h-full rounded-full transition-all ${pct >= 100 ? "bg-gradient-to-r from-green-400 to-green-600" : "bg-gradient-to-r from-gray-400 to-gray-900"}`} style={{ width: `${pct}%` }} />
      </div>

      {/* Tag filter chip bar — single-select; click same chip to clear. */}
      {allTags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-4">
          {allTags.map((chip) => (
            <button
              key={chip}
              onClick={() => setTagFilter((t) => nextTagSelection(t, chip))}
              className={`px-2.5 py-0.5 rounded-full text-xs border transition-colors ${tagFilter === chip ? "bg-gray-900 text-white border-gray-900" : "border-gray-300 text-gray-600 hover:bg-gray-50"}`}
            >
              {chip}
            </button>
          ))}
          {tagFilter && (
            <button onClick={() => setTagFilter(null)} className="px-2.5 py-0.5 rounded-full text-xs border border-gray-300 text-gray-400 hover:text-gray-700">
              Clear
            </button>
          )}
        </div>
      )}

      {/* Timeline — identical to the Overview timeline (phases + benchmark sub-dots + NOW). Here a
          click JUMPS to that section instead of previewing a phase view. */}
      {markers.length > 0 && (
        <div className="mb-4">
          <OverviewTimeline markers={markers} currentKey={currentKey} selectedKey={currentKey} onSelect={jumpToMarker} benchmarksClickable hint="click to jump" />
        </div>
      )}
      {/* Sticky bulk-select bar. */}
      <div ref={stickyRef} className="sticky top-0 z-30 -mx-6 mb-4 bg-white border-b border-gray-200">
        {total > 0 && (
          <div className="px-6 py-2 flex items-center gap-3 text-sm min-h-[2.5rem]">
            <label className="inline-flex items-center gap-2 text-gray-600 cursor-pointer">
              <input type="checkbox" checked={selected.size === total} ref={(el) => { if (el) el.indeterminate = selected.size > 0 && selected.size < total; }} onChange={() => setSelected(selected.size === total ? new Set() : new Set(items.map((d) => d.id)))} className="rounded border-gray-300" />
              Select all
            </label>
            {selected.size > 0 && (
              <>
                <span className="text-gray-500">{selected.size} selected</span>
                <Select value="" onValueChange={(v) => { if (v) void applyStatus([...selected], v as string); }} items={[{ value: "", label: "Set status…" }, ...STATUSES.map((s) => ({ value: s, label: s }))]}>
                  <SelectTrigger size="sm" className="text-[15px]"><SelectValue /></SelectTrigger>
                  <SelectContent>{STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
                <button onClick={() => setSelected(new Set())} className="text-gray-500 hover:text-gray-900">Clear</button>
              </>
            )}
          </div>
        )}
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={onDragCancel}>
      <div className="space-y-5">
        {PHASES.map((phase) => {
          // All items in this phase (pre-filter for selection counts; apply tag filter for render).
          const phaseItems = items.filter((d) => d.phase === phase);
          const visiblePhaseItems = visibleItems.filter((d) => d.phase === phase);
          const phaseBenchmarks = benchmarks.filter((b) => b.phase === phase).sort((a, b) => a.order - b.order);
          const gSelCount = phaseItems.filter((d) => selected.has(d.id)).length;
          const gAll = phaseItems.length > 0 && gSelCount === phaseItems.length;
          return (
            <div key={phase} id={`delsec-${phase}`} ref={(el) => { groupRefs.current[phase] = el; }} style={{ scrollMarginTop: headerH + 8 }}>
              <div className="flex items-center justify-between gap-2 mb-2">
                <label className="inline-flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" disabled={phaseItems.length === 0} checked={gAll} ref={(el) => { if (el) el.indeterminate = gSelCount > 0 && !gAll; }} onChange={() => toggleMany(phaseItems.map((d) => d.id), !gAll)} className="rounded border-gray-300 disabled:opacity-40" aria-label={`Select all in ${PHASE_LABEL[phase]}`} />
                  <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${colorOf.get(phase)?.dot ?? colorOf.get(PHASE_LABEL[phase])?.dot ?? "bg-gray-300"}`} />
                  <h3 className="text-sm font-medium text-gray-700">{PHASE_LABEL[phase]}</h3>
                </label>
                <div className="flex items-center gap-2">
                  {gSelCount > 0 && (
                    <Select value="" onValueChange={(v) => { if (v) void applyStatus(phaseItems.filter((d) => selected.has(d.id)).map((d) => d.id), v as string); }} items={[{ value: "", label: `Set ${gSelCount} to…` }, ...STATUSES.map((s) => ({ value: s, label: s }))]}>
                      <SelectTrigger size="sm" className="text-[15px]"><SelectValue /></SelectTrigger>
                      <SelectContent>{STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                    </Select>
                  )}
                  <button onClick={() => { setAdding(adding === phase ? null : phase); setTitle(""); setOwner(""); setDueInput(""); }} className="text-[15px] text-gray-500 hover:text-gray-900 inline-flex items-center gap-1"><Plus className="w-3 h-3" /> Add</button>
                </div>
              </div>

              {/* Benchmark sub-sections */}
              {phaseBenchmarks.map((bm) => {
                const bmItems = visiblePhaseItems.filter((d) => d.benchmarkId === bm.id);
                const bmAllItems = phaseItems.filter((d) => d.benchmarkId === bm.id);
                return (
                  <div key={bm.id} id={`delsec-bm-${bm.id}`} className="mb-3">
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5 px-1">{bm.name}</p>
                    <BenchmarkDropZone benchmarkId={bm.id}>
                      <div className="rounded-lg border border-gray-200 divide-y divide-gray-100 min-h-[2.5rem]">
                        {bmItems.length === 0 && <p className="px-3 py-2 text-sm text-gray-400">None — drag a task here.</p>}
                        <SortableContext items={bmAllItems.map((d) => d.id)} strategy={verticalListSortingStrategy}>
                          {renderRows(bmItems)}
                        </SortableContext>
                      </div>
                    </BenchmarkDropZone>
                  </div>
                );
              })}

              {/* Benchmark-less tasks for this phase */}
              <PhaseDropZone phase={phase}>
              <div className="rounded-lg border border-gray-200 divide-y divide-gray-100 min-h-[2.5rem]">
                {(() => {
                  const unassigned = visiblePhaseItems.filter((d) => !d.benchmarkId);
                  const unassignedAll = phaseItems.filter((d) => !d.benchmarkId);
                  return (
                    <>
                      {unassigned.length === 0 && adding !== phase && <p className="px-3 py-2 text-sm text-gray-400">{phaseBenchmarks.length > 0 ? "No unassigned tasks — drag a task here." : "None — drag a task here."}</p>}
                      <SortableContext items={unassignedAll.map((d) => d.id)} strategy={verticalListSortingStrategy}>
                        {renderRows(unassigned)}
                      </SortableContext>
                      {adding === phase && (
                        <div className="px-3 py-2 flex flex-wrap gap-2 items-center bg-gray-50">
                          <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add(phase); }} placeholder="Task" className="flex-1 min-w-[8rem] px-2 py-1 border border-border rounded text-sm focus:outline-none" />
                          <input value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="Owner role" className="w-28 px-2 py-1 border border-border rounded text-sm focus:outline-none" />
                          <span className="px-1 border border-border rounded"><DateEdit value={due || null} onChange={(iso) => setDueInput(iso ?? "")} placeholder="due date" /></span>
                          <button onClick={() => add(phase)} disabled={!title.trim()} className="px-3 py-1 bg-gray-200 rounded text-sm hover:bg-gray-300 disabled:opacity-50">Add</button>
                          <button onClick={() => setAdding(null)} className="text-sm text-gray-500 hover:text-gray-900">Cancel</button>
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
              </PhaseDropZone>
            </div>
          );
        })}
      </div>
      <DragOverlay dropAnimation={null}>
        {activeId ? (() => { const d = items.find((x) => x.id === activeId); return d ? renderRowInner(d, { overlay: true }) : null; })() : null}
      </DragOverlay>
      </DndContext>
    </div>
  );
}

// ── Carried lessons ─────────────────────────────────────────────────────────
function CarriedLessons({ eventId, onOpenEvent }: { eventId: string; onOpenEvent?: (id: string) => void }) {
  const [lessons, setLessons] = useState<CarriedLesson[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    getCarriedLessons(eventId).then((l) => { if (!cancelled) setLessons(l); });
    return () => { cancelled = true; };
  }, [eventId]);

  if (lessons === null) return <div className="bg-white rounded-2xl border border-border p-6 text-sm text-gray-400">Finding comparable past events…</div>;
  if (lessons.length === 0) return <div className="bg-white rounded-2xl border border-border p-6 text-sm text-gray-400">No comparable past events with learnings yet.</div>;

  return (
    <div className="bg-white rounded-2xl border border-border divide-y divide-gray-100">
      {lessons.map((l, i) => (
        <div key={i} className="px-6 py-4 flex gap-3">
          <Lightbulb className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm text-gray-700">{l.body}</p>
            <p className="text-[15px] text-gray-400 mt-1">
              from {l.sourceEventId && onOpenEvent && l.sourceEventId !== eventId
                ? <button onClick={() => onOpenEvent(l.sourceEventId!)} className="text-gray-600 underline decoration-dotted underline-offset-2 hover:text-gray-900">{l.sourceEventName}</button>
                : <span className="text-gray-500">{l.sourceEventName}</span>}
              {l.why ? ` · ${l.why}` : ""}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Overview (at-a-glance home) ───────────────────────────────────────────────
function buildFacts(plan: EventPlanning): PlanningFacts {
  const t = today();
  const confirmed = plan.engagements.filter((e) => e.stage === "Contracted").map((e) => ({
    category: e.category ?? "—", vendor: e.candidates.find((c) => c.isSelected)?.vendorName ?? null, amount: e.confirmedAmount,
  }));
  const pendingDecisions = plan.engagements.filter((e) => e.stage !== "Contracted").map((e) => ({ category: e.category ?? "—", stage: e.stage ?? "—" }));
  const lines = plan.budget?.lines ?? [];
  const committed = lines.filter((l) => l.status !== "estimate").reduce((s, l) => s + (l.confirmedAmount ?? 0), 0);
  const paid = lines.filter((l) => l.status === "paid").reduce((s, l) => s + (l.confirmedAmount ?? 0), 0);
  const budget = plan.budget ? { committed, paid, pending: committed - paid, target: plan.budget.targetAmount } : null;
  const done = plan.deliverables.filter((d) => d.status === "Done").length;
  const overdue = plan.deliverables.filter((d) => d.dueDate && d.dueDate < t && d.status !== "Done").length;
  const upcoming = plan.deliverables
    .filter((d) => d.status !== "Done")
    .sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"))
    .slice(0, 4)
    .map((d) => d.title);
  const daysOut = plan.date ? Math.round((new Date(plan.date + "T00:00:00").getTime() - new Date(t + "T00:00:00").getTime()) / 86400000) : null;
  return { name: plan.title, macroStage: plan.macroStage, daysOut, confirmed, pendingDecisions, budget, deliverables: { done, total: plan.deliverables.length, overdue, upcoming } };
}

// Full-width phase tracker for the Overview: the shared hollow-dot rail, with done/current
// status derived from today vs. the phase date ranges, dates resolved when the event has one.
// ── Phase-aware Overview: view modes + interactive timeline ───────────────────
type ViewMode = "planning" | "day-before" | "day-of" | "post";
const NEUTRAL_COLOR = { dot: "bg-gray-400", band: "bg-gray-100", text: "text-gray-600", ring: "ring-gray-200", border: "border-gray-400", fillSoft: "group-hover:bg-gray-100" };
interface OvMarker { key: string; label: string; view: ViewMode; kind: "primary" | "secondary"; phaseName: string | null; date: string | null; color: typeof NEUTRAL_COLOR }

const localToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const addDays = (iso: string, n: number) => { const d = new Date(iso + "T00:00:00"); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const daysBetween = (a: string, b: string) => Math.round((Date.parse(a + "T00:00:00") - Date.parse(b + "T00:00:00")) / 86_400_000);
const fmtShort = (iso: string) => new Date(iso + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });

// Ordered timeline markers + the date-derived current marker/view ("you are here").
// Primary markers are always the 3 canonical PHASES (planning / day-of / post); each phase's
// benchmarks follow as smaller secondary markers, keyed bm:<id>, inheriting the phase color.
function deriveMarkers(plan: EventPlanning): { markers: OvMarker[]; currentKey: string } {
  const ev = plan.date;
  // Fixed colors per canonical phase (matches PHASE_COLORS[0..2]).
  const PHASE_COLOR_MAP: Record<string, typeof NEUTRAL_COLOR> = {
    planning: { dot: "bg-blue-500", band: "bg-blue-100", text: "text-blue-700", ring: "ring-blue-200", border: "border-blue-500", fillSoft: "group-hover:bg-blue-100" },
    "day-of":  { dot: "bg-violet-500", band: "bg-violet-100", text: "text-violet-700", ring: "ring-violet-200", border: "border-violet-500", fillSoft: "group-hover:bg-violet-100" },
    post:      { dot: "bg-amber-500", band: "bg-amber-100", text: "text-amber-700", ring: "ring-amber-200", border: "border-amber-500", fillSoft: "group-hover:bg-amber-100" },
  };
  // Phase → view mode (1-to-1 for the canonical 3).
  const PHASE_VIEW: Record<string, ViewMode> = { planning: "planning", "day-of": "day-of", post: "post" };

  // Auto-shift dates: day-of becomes current on the event date; post shifts the day after.
  const phaseDate: Record<string, string | null> = {
    planning: null,
    "day-of": ev ?? null,
    post: ev ? addDays(ev, 1) : null,
  };

  const markers: OvMarker[] = [];
  for (const phase of PHASES) {
    const color = PHASE_COLOR_MAP[phase] ?? NEUTRAL_COLOR;
    const view = PHASE_VIEW[phase] ?? "planning";
    const date = phaseDate[phase] ?? null;
    markers.push({ key: `phase:${phase}`, label: PHASE_LABEL[phase], view, kind: "primary", phaseName: phase, date, color });
    // Benchmarks for this phase as secondary sub-dots, same color, no date.
    const bms = (plan.benchmarks ?? []).filter((b) => b.phase === phase).sort((a, b) => a.order - b.order);
    for (const bm of bms) {
      markers.push({ key: `bm:${bm.id}`, label: bm.name, view, kind: "secondary", phaseName: phase, date: null, color });
    }
  }

  // No date → no "you are here"; default view falls to planning.
  let currentKey = "";
  if (ev) {
    currentKey = `phase:planning`;
    const nowOff = daysBetween(localToday(), ev);
    let cv: ViewMode = "planning";
    if (nowOff > 0) cv = "post";
    else if (nowOff === 0) cv = "day-of";
    if (cv !== "planning") {
      currentKey = markers.find((m) => m.view === cv && m.kind === "primary")?.key ?? `phase:${cv}`;
    }
  }
  return { markers, currentKey };
}

// Interactive timeline: primary phase nodes (large) + benchmark sub-dots (small, same-color,
// indented). The date-derived "NOW" marker is fixed; the selected node is what's being previewed.
// Clicking a node switches the previewed VIEW inside Overview (no tab navigation).
function OverviewTimeline({ markers, currentKey, selectedKey, onSelect, locked, benchmarksClickable = false, hint }: { markers: OvMarker[]; currentKey: string; selectedKey: string; onSelect: (k: string) => void; locked?: boolean; benchmarksClickable?: boolean; hint?: string }) {
  if (markers.length === 0) return null;
  // The phase we're currently in (currentKey is always a `phase:<x>` key) — benchmarks under it get a halo.
  const currentPhaseName = currentKey.startsWith("phase:") ? currentKey.slice("phase:".length) : null;

  function handleSelect(key: string) {
    if (locked) return;
    onSelect(key);
  }

  return (
    <div className="bg-white rounded-2xl border border-border p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-[15px] font-medium text-gray-700">Timeline <span className="text-gray-400 font-normal">· {locked ? "final record" : (hint ?? "click a phase to preview")}</span></h3>
        {!locked && selectedKey !== currentKey && <button onClick={() => onSelect(currentKey)} className="text-xs text-gray-600 hover:text-gray-900 inline-flex items-center gap-1"><ChevronLeft className="w-3.5 h-3.5" /> Back to now</button>}
      </div>
      <div className="relative">
        <div className="absolute left-0 right-0 top-[18px] h-px bg-gray-200" />
        <div className="flex">
          {markers.map((m) => {
            const cls = `group relative flex flex-col items-center text-center ${m.kind === "primary" ? "flex-1 min-w-[64px] px-1" : "min-w-[40px] px-0.5"}`;
            // ── Benchmark sub-dot: a smaller version of its parent phase. It's NOT a phase, so it isn't
            // clickable in preview mode. Halo if it falls in the phase we're currently in; else an
            // empty circle in the parent's colour.
            if (m.kind === "secondary") {
              const inCurrentPhase = !locked && currentPhaseName != null && m.phaseName === currentPhaseName;
              const dot = (
                <>
                  <span className="relative flex h-9 w-full items-center justify-center">
                    <span className={`rounded-full transition-colors w-2.5 h-2.5 border-2 ${m.color.border} bg-white ${inCurrentPhase ? `ring-2 ${m.color.ring} ${m.color.fillSoft}` : ""}`} />
                  </span>
                  <span className={`mt-1.5 leading-tight text-[11px] ${inCurrentPhase ? m.color.text : "text-gray-400"}`}>{m.label}</span>
                </>
              );
              return benchmarksClickable && !locked
                ? <button key={m.key} type="button" onClick={() => handleSelect(m.key)} title={m.label} className={cls}>{dot}</button>
                : <div key={m.key} title={m.label} className={`${cls} cursor-default`}>{dot}</div>;
            }
            // ── Primary phase dot. Current phase carries a persistent HALO ("you are here"); the SELECTED
            // (previewed) one fills dark.
            const isSel = !locked && m.key === selectedKey, isNow = !locked && m.key === currentKey;
            const halo = isNow && !locked;
            const fill = locked || isSel ? m.color.dot : `bg-white ${m.color.fillSoft}`;
            return (
              <button key={m.key} type="button" onClick={() => handleSelect(m.key)} disabled={locked} title={m.label} className={`${cls} ${locked ? "cursor-default" : ""}`}>
                <span className="relative flex h-9 w-full items-center justify-center">
                  <span className={`rounded-full transition-colors w-5 h-5 border-2 ${m.color.border} ${halo ? `ring-4 ${m.color.ring}` : ""} ${fill}`} />
                </span>
                <span className={`mt-1.5 leading-tight text-[13px] ${isNow ? `${m.color.text} font-semibold` : isSel ? m.color.text : "text-gray-600"}`}>{m.label}</span>
                {m.date && <span className="mt-0.5 text-[11px] text-gray-400 whitespace-nowrap">{fmtShort(m.date)}</span>}
                {isNow && <span className="mt-0.5 inline-flex items-center gap-1 text-[10px] font-semibold tracking-wide text-gray-900"><span className="w-2 h-2 rounded-full bg-gray-900" /> NOW</span>}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ProjectionBanner({ label }: { label: string }) {
  return <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 px-4 py-2 text-sm text-gray-500">Upcoming · {label} — a preview of what this view will show. Live data fills in once the event reaches this phase.</div>;
}

// ── Day-before view: final prep ───────────────────────────────────────────────
function DayBeforeView({ plan, temporal }: { plan: EventPlanning; temporal: "past" | "current" | "future" }) {
  // Being "the day before" assumes the earlier Plan-it / outreach work is done — show ONLY the
  // final-week / day-before tasks (the cluster that justified this node), done ones checked off.
  const prep = plan.deliverables
    .filter((d) => d.offsetStart != null && d.offsetStart >= -7 && d.offsetStart < 0)
    .sort((a, b) => (a.offsetStart ?? 0) - (b.offsetStart ?? 0) || (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"));
  const headcount = plan.rsvp ?? plan.headcount ?? null;
  return (
    <div className="space-y-6">
      {temporal === "future" && <ProjectionBanner label="Day before" />}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-6 items-start">
        <div className="bg-white rounded-2xl border border-border p-5">
          <h3 className="font-medium mb-3">Final prep checklist</h3>
          <ul className="space-y-1.5 text-sm">
            {prep.length === 0 && <li className="text-gray-400">No day-before tasks — everything's wrapped.</li>}
            {prep.map((d) => { const done = d.status === "Done"; return (
              <li key={d.id} className="flex items-center gap-2">
                <span className={`w-4 h-4 rounded border shrink-0 flex items-center justify-center ${done ? "bg-gray-900 border-gray-900" : "border-gray-300"}`}>{done && <Check className="w-3 h-3 text-white" />}</span>
                <span className={`flex-1 min-w-0 truncate ${done ? "text-gray-400 line-through" : ""}`}>{d.title}</span>
                {d.phase && <span className="text-xs text-gray-400">{d.phase}</span>}
              </li>
            ); })}
          </ul>
          <h3 className="font-medium mt-5 mb-2">Run of show <span className="text-gray-400 font-normal text-sm">· ready?</span></h3>
          {plan.agenda.length === 0 ? <p className="text-sm text-gray-400">No run-of-show set — add it on the Deliverables tab.</p> : (
            <ul className="rounded-lg border border-gray-200 divide-y divide-gray-100 text-sm">
              {plan.agenda.map((a, i) => <li key={i} className="px-3 py-1.5 flex gap-3"><span className="text-gray-400 w-14 tabular-nums shrink-0">{a.time}</span><span>{a.title}</span></li>)}
            </ul>
          )}
        </div>
        <div className="space-y-4">
          <div className="bg-white rounded-2xl border border-border p-5"><h3 className="font-medium mb-1">Final headcount</h3><p className="text-2xl font-semibold text-gray-900">{headcount ?? "—"}</p><p className="text-[11px] text-gray-400">{plan.capacity != null ? `of ${plan.capacity} capacity` : "expected"}</p></div>
          <div className="bg-white rounded-2xl border border-border p-5"><h3 className="font-medium mb-2">Confirm roles</h3>{plan.staffRoles.length === 0 ? <p className="text-sm text-gray-400">No roles listed.</p> : <div className="flex flex-wrap gap-2">{plan.staffRoles.map((r, i) => <span key={i} className="inline-flex items-center gap-1 text-sm bg-gray-100 text-gray-700 rounded-full px-2.5 py-0.5"><Users className="w-3 h-3" /> {r}</span>)}</div>}</div>
        </div>
      </div>
    </div>
  );
}

// ── Day-of view: live run-of-show + check-in ──────────────────────────────────
function DayOfView({ plan, temporal }: { plan: EventPlanning; temporal: "past" | "current" | "future" }) {
  const live = temporal === "current";
  const nowMin = (() => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); })();
  const toMin = (t: string) => { const m = t.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i); if (!m) return null; let h = Number(m[1]); const mi = Number(m[2] ?? 0); const ap = m[3]?.toLowerCase(); if (ap === "pm" && h < 12) h += 12; if (ap === "am" && h === 12) h = 0; return h * 60 + mi; };
  let curIdx = -1;
  if (live) plan.agenda.forEach((a, i) => { const t = toMin(a.time); if (t != null && t <= nowMin) curIdx = i; });
  return (
    <div className="space-y-6">
      {temporal === "future" && <ProjectionBanner label="Day of" />}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-6 items-start">
        <div className="bg-white rounded-2xl border border-border p-5">
          <h3 className="font-medium mb-3">Run of show {live && <span className="text-xs text-green-600">· live</span>}</h3>
          {plan.agenda.length === 0 ? <p className="text-sm text-gray-400">No run-of-show set.</p> : (
            <ul className="space-y-1.5 text-sm">
              {plan.agenda.map((a, i) => (
                <li key={i} className={`flex gap-3 rounded-lg px-2 py-1.5 ${i === curIdx ? "bg-green-50 border border-green-200" : ""}`}><span className="text-gray-500 w-14 tabular-nums shrink-0">{a.time}</span><span className="flex-1">{a.title}</span>{i === curIdx && <span className="text-xs text-green-700 font-medium shrink-0">now</span>}</li>
              ))}
            </ul>
          )}
        </div>
        <div className="space-y-4">
          <div className="bg-white rounded-2xl border border-border p-5"><h3 className="font-medium mb-1">Checked in</h3><p className="text-2xl font-semibold text-gray-900">—{plan.capacity != null && <span className="text-sm text-gray-400"> / {plan.capacity}</span>}</p><p className="text-[11px] text-gray-400">live count on the People tab</p></div>
          {live && curIdx >= 0 && curIdx + 1 < plan.agenda.length && (
            <div className="bg-white rounded-2xl border border-border p-5"><h3 className="font-medium mb-1">Coming up</h3><p className="text-sm text-gray-700">{plan.agenda[curIdx + 1].time} · {plan.agenda[curIdx + 1].title}</p></div>
          )}
        </div>
      </div>
    </div>
  );
}

// The fields a complete record of an event's category carries — shared by the completeness panel
// and the page-level "drop project knowledge" handler so both judge gaps identically. Budget/vendors
// aren't load-bearing for community ("neither") events, so they're skipped there.
export function completenessFields(plan: EventPlanning): { key: string; label: string; present: boolean }[] {
  const focus = eventFocus(plan.tags, plan.format, plan.focusOverride);
  return ([
    { key: "date", label: "Event date", present: !!plan.date },
    { key: "location", label: "Venue / location", present: !!plan.location },
    { key: "turnout", label: "Turnout", present: plan.rsvp != null || plan.headcount != null || plan.checkedIn != null },
    // Final spend = ACTUAL (non-estimate) money recorded. A bare estimate line still reads as
    // "missing final spend" — you budgeted, but didn't record what was actually spent.
    { key: "budget", label: "Final spend / actuals", present: (plan.budget?.lines ?? []).some((l) => l.status !== "estimate" && (l.confirmedAmount ?? 0) > 0) },
    { key: "outcome", label: "Outcome / verdict", present: !!plan.verdict?.trim() },
    { key: "agenda", label: "Run of show", present: plan.agenda.length > 0 },
    { key: "vendors", label: "Vendors", present: (plan.budget?.lines.some((l) => l.vendorName || l.vendorId) ?? false), skip: focus === "neither" },
    { key: "roles", label: "Staffing / roles", present: plan.staffRoles.length > 0 },
  ] as { key: string; label: string; present: boolean; skip?: boolean }[]).filter((f) => !f.skip);
}

// Ingest a dropped doc as PROJECT KNOWLEDGE for an EXISTING event (never a new event / structure).
// A budget sheet records actuals + is kept as a linked source; any other doc is kept as project
// context and run through the brief/debrief extractor to fill only the named gap fields (plus
// always-additive lessons). Returns a human message + whether anything changed (→ caller reloads).
export async function ingestEventDoc(eventId: string, file: File, gapKeys: string[]): Promise<{ message: string; applied: boolean }> {
  // Is this exact file already attached? Reuse its URL (so re-processed lines stay linked to the
  // same source for cascade-delete) and — for the LLM/prose path only — skip re-extraction. The
  // budget and run-of-show paths are idempotent, so we always let them RECONCILE: re-dropping a
  // sheet updates / back-fills lines (e.g. a line that a prior parse missed) without doubling.
  const attachedMat = (await getSourceMaterials(eventId)).find((m) => m.name.trim().toLowerCase() === file.name.trim().toLowerCase());
  // Memoized: safe to call from every tab of a workbook — the file uploads at most once.
  let sourcePromise: Promise<string | null> | null = null;
  const ensureSource = (type: string): Promise<string | null> => {
    if (attachedMat) return Promise.resolve(attachedMat.url);
    if (!sourcePromise) sourcePromise = (async () => {
      try { const url = await uploadDocument(file); await addSourceMaterial(eventId, { name: file.name, url, type: file.type || type }); return url; } catch { return null; }
    })();
    return sourcePromise;
  };

  // PDFs: read via pdf.js (lazy-loaded). Table structure is lost in a PDF, so we DON'T run the
  // CSV/table parsers on it — a budget/vendor table would come out garbled. Instead we keep it as
  // context and route prose (briefs/debriefs) to the LLM; if it looks like budget/vendor data we
  // nudge the user toward a CSV/Markdown table, which imports reliably.
  const isPdf = /\.pdf$/i.test(file.name) || file.type.includes("pdf");
  if (isPdf) {
    let pdfText = "";
    try { const { readPdfText } = await import("../lib/pdfText"); pdfText = await readPdfText(file); }
    catch { pdfText = ""; }
    await ensureSource("application/pdf"); // attach it regardless (previewable project context)
    if (!pdfText.trim()) {
      return { message: "Added the PDF, but couldn't read any text from it (it looks scanned / image-only). To pull data out, export it as .csv or .md, or paste the text.", applied: true };
    }
    const { looksLikeBudgetOrVendor } = await import("../lib/pdfText");
    if (looksLikeBudgetOrVendor(pdfText)) {
      return { message: "Added the PDF to project context. It looks like budget / vendor data — PDFs lose table structure, so it wasn't imported as lines. For a clean import, drop a CSV or Markdown table (or paste it).", applied: true };
    }
    if (attachedMat) return { message: `“${file.name}” is already added — nothing new to extract.`, applied: false };
    const x = await extractForBackfill(pdfText);
    const filled = await enrichEventFromExtract(eventId, x, gapKeys);
    return filled.length
      ? { message: `Updated from the PDF: ${filled.join(", ")}.`, applied: true }
      : { message: "Added the PDF to project context — nothing new to fill in for this event.", applied: true };
  }

  // A multi-tab workbook (.xlsx/.ods/…): parse each tab to CSV and route it INDEPENDENTLY through
  // the same detection as a standalone drop — a Budget tab fills lines, a Vendors tab makes
  // engagements, an Agenda tab fills run-of-show. Leftover prose tabs get one combined LLM pass.
  if (isWorkbookFile(file)) {
    let sheets;
    try { const { readWorkbook } = await import("../lib/workbook"); sheets = await readWorkbook(file); }
    catch { return { message: "Couldn't read that workbook — re-save it as .xlsx, or export each tab as .csv.", applied: false }; }
    if (!sheets.length) return { message: "That workbook has no data in any tab.", applied: false };
    await ensureSource(file.type || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    const parts: string[] = [];
    const prose: string[] = [];
    let applied = false;
    for (const sheet of sheets) {
      const r = await routeStructured(eventId, sheet.csv, gapKeys, ensureSource, true);
      if (r.matched) { parts.push(`${sheet.name}: ${r.summary}`); applied = applied || r.applied; }
      else prose.push(`# ${sheet.name}\n${sheet.csv}`);
    }
    // One extraction over the tabs no structured parser claimed (avoids an LLM call per tab).
    if (prose.length && !attachedMat) {
      const x = await extractForBackfill(prose.join("\n\n"));
      const filled = await enrichEventFromExtract(eventId, x, gapKeys);
      if (filled.length) { parts.push(`other tabs: ${filled.join(", ")}`); applied = true; }
    }
    return parts.length
      ? { message: `From ${sheets.length} tab${sheets.length === 1 ? "" : "s"} — ${parts.join(" · ")}.`, applied }
      : { message: `Read ${sheets.length} tab${sheets.length === 1 ? "" : "s"}, but found nothing to import (no budget, vendor, or schedule rows).`, applied: false };
  }

  // Reject Office/iWork binaries (.docx et al.) before file.text() turns them into garbage.
  const unsupported = unsupportedFileMessage(file);
  if (unsupported) return { message: unsupported, applied: false };

  const text = await file.text();
  if (!text.trim()) return { message: "Couldn't read any text from that file — try a .txt, .md, or .csv (or paste the text).", applied: false };

  const isSheet = /\.csv$/i.test(file.name) || /csv|spreadsheet|excel/i.test(file.type);
  const routed = await routeStructured(eventId, text, gapKeys, ensureSource, isSheet);
  if (routed.matched) return { message: routed.summary, applied: routed.applied };

  // Prose / LLM path: NOT idempotent (re-extraction re-adds lessons etc.), so skip if already here.
  if (attachedMat) return { message: `“${file.name}” is already added — nothing new to extract. Remove it first to re-process.`, applied: false };
  await ensureSource("text/plain"); // keep the doc as project context, then extract what it can fill
  const x = await extractForBackfill(text);
  const filled = await enrichEventFromExtract(eventId, x, gapKeys);
  if (filled.length) return { message: `Updated: ${filled.join(", ")}.`, applied: true };
  return { message: "Saved as project context — nothing new to fill in for this event.", applied: true };
}

// A pull-summary reads "<lead>: a, b, c" or "<lead> — a · b · c". When there are several pulls
// that's a blocky run-on, so split it into a lead line + one bullet per pull. Returns null for
// plain prose (no lead delimiter, or a single pull) so those stay a normal paragraph.
function splitPullMessage(msg: string): { lead: string; items: string[] } | null {
  const body = msg.replace(/\.$/, "").trim();
  const m = body.match(/^(.*?[:—])\s*(.+)$/);
  if (!m) return null;
  const rest = m[2];
  const sep = rest.includes(" · ") ? " · " : ", ";
  const items = rest.split(sep).map((s) => s.trim()).filter(Boolean);
  return items.length >= 2 ? { lead: m[1].trim(), items } : null;
}

// Route ONE blob of text (a dropped file, or a single workbook tab) to the structured parser it
// matches — vendors → budget → run-of-show. `matched: false` means it's prose; the caller decides
// how to handle that (LLM extraction). `summary` is a one-line, tab-embeddable result.
async function routeStructured(
  eventId: string,
  text: string,
  gapKeys: string[],
  ensureSource: (type: string) => Promise<string | null>,
  isSheet: boolean,
): Promise<{ matched: boolean; applied: boolean; summary: string }> {
  // A VENDOR list (header names a Vendor column) → engagements + candidates, each paired to a
  // budget line. Checked before budget so a vendor sheet with amounts doesn't land as bare budget.
  const vendorRows = parseVendors(text);
  if (vendorRows) {
    const docUrl = await ensureSource("text/csv"); // keep the sheet as project context (+ provenance)
    const r = await importVendors(eventId, vendorRows, docUrl);
    const bits = [`${r.vendors} vendor${r.vendors === 1 ? "" : "s"}`, `${r.tagged} budget line${r.tagged === 1 ? "" : "s"} tagged`];
    if (r.skipped) bits.push(`${r.skipped} tax/fee row${r.skipped === 1 ? "" : "s"} skipped`);
    return { matched: true, applied: r.vendors > 0 || r.tagged > 0, summary: `Recorded ${bits.join(", ")}. (Existing budget lines were tagged, not re-priced.)` };
  }

  const nonEmptyLines = text.split(/\r?\n/).filter((l) => l.trim()).length || 1;
  const parsed = parseBudgetText(text).filter((l) => l.label.trim() && l.label !== "Untitled" && l.amount != null);
  const budgetLines = (isSheet || (parsed.length >= 2 && parsed.length / nonEmptyLines >= 0.4)) ? parsed : [];
  if (budgetLines.length) {
    const docUrl = await ensureSource("text/csv");
    const n = await addBudgetActuals(eventId, budgetLines, docUrl);
    return { matched: n > 0, applied: n > 0, summary: n ? `${n} budget line${n === 1 ? "" : "s"} (final spend) — matching lines updated, not duplicated.` : "No budget rows found." };
  }
  // A run-of-show is a schedule, not prose — the brief extractor won't reliably pull it. Parse
  // time-prefixed rows directly and fill the agenda when it's a gap.
  const ros = parseRunOfShow(text);
  if (gapKeys.includes("agenda") && ros.length >= 2) {
    await ensureSource("text/plain");
    await setEventAgenda(eventId, ros);
    return { matched: true, applied: true, summary: `${ros.length} run-of-show items.` };
  }
  return { matched: false, applied: false, summary: "" };
}

// Pull run-of-show rows out of a dropped schedule: lines that begin with a time (9:00, 9:00 AM,
// 9am, or a 10:00–10:45 range), the rest of the line as the activity. Needs the leading token to
// be a real time (has ":MM" or am/pm) so "12 people" / "2024 recap" don't masquerade as rows.
function parseRunOfShow(text: string): { time: string; title: string }[] {
  const re = /^(\d{1,2}:\d{2}\s*(?:[ap]\.?m\.?)?(?:\s*[-–—]\s*\d{1,2}:\d{2}\s*(?:[ap]\.?m\.?)?)?|\d{1,2}\s*[ap]\.?m\.?)\s*[-–—:|·\t]?\s*(.+)$/i;
  const out: { time: string; title: string }[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(re);
    if (!m) continue;
    const time = m[1].replace(/\s+/g, " ").trim();
    const title = m[2].trim();
    if (title) out.push({ time, title });
  }
  return out;
}

// On the wrapped view, "what would make this complete" + a drop-to-fill enrichment target.
// Lists fields a complete record of this category has but this backfilled event lacks; dropping a
// doc (e.g. a budget sheet) extracts it and fills only the gaps. Resolved fields drop off the list.
function CompletenessPanel({ plan, eventId, onApplied, onResolveGap }: { plan: EventPlanning; eventId: string; onApplied: () => void; onResolveGap?: (key: string) => boolean }) {
  const focus = eventFocus(plan.tags, plan.format, plan.focusOverride);
  const fields = completenessFields(plan);
  const gaps = fields.filter((f) => !f.present);

  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<{ name: string | null; message: string }[] | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);

  // The non-deletable "Post-event reflections & insights" to-do. Auto-checks off (disappears) once
  // the record is complete; otherwise the owner can tick it manually (with a heads-up).
  const reflDeliv = plan.deliverables.find((d) => /reflection|insight/i.test(d.title));
  const reflOpen = !!reflDeliv && reflDeliv.status !== "Done";
  // "Complete" = no gaps left, OR the reflections deliverable is marked done (manually declared).
  // Same signal as the green "final record" check on the card, so the two never disagree.
  const complete = gaps.length === 0 || reflDeliv?.status === "Done";
  const [confirmRefl, setConfirmRefl] = useState(false);
  useEffect(() => {
    if (complete && reflDeliv && reflDeliv.status !== "Done") setDeliverableStatus(reflDeliv.id, "Done").then(() => onApplied()).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [complete, reflDeliv?.id, reflDeliv?.status]);
  const checkOffRefl = async () => { if (reflDeliv) await setDeliverableStatus(reflDeliv.id, "Done").catch(() => {}); setConfirmRefl(false); onApplied(); };

  // Accepts one file, several files, or a whole folder (dropped or picked). Each file runs through
  // the same gap-filling ingest; junk (dotfiles like .DS_Store, empty files) is skipped. Results are
  // reported per file so a folder drop reads as a checklist, not one blurred paragraph.
  const ingestFiles = async (files: File[]) => {
    setOver(false);
    const list = files.filter((f) => f && f.name && !f.name.startsWith(".") && f.size > 0);
    if (!list.length) return;
    setBusy(true); setResults(null);
    const gapKeys = gaps.map((g) => g.key);
    const multi = list.length > 1;
    const out: { name: string | null; message: string }[] = [];
    let anyApplied = false;
    for (const f of list) {
      try {
        const { message, applied } = await ingestEventDoc(eventId, f, gapKeys);
        out.push({ name: multi ? f.name : null, message });
        anyApplied = anyApplied || applied;
      } catch (e: any) {
        out.push({ name: multi ? f.name : null, message: e?.message ?? String(e) });
      }
    }
    setResults(out);
    if (anyApplied) onApplied();
    setBusy(false);
  };

  const drag = {
    onClick: () => fileRef.current?.click(),
    onDragEnter: (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); setOver(true); },
    onDragOver: (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); setOver(true); },
    onDragLeave: (e: React.DragEvent) => { e.stopPropagation(); setOver(false); },
    // filesFromDrop descends into a dropped folder; falls back to the flat file list.
    onDrop: (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); void filesFromDrop(e.dataTransfer).then(ingestFiles); },
  };

  return (
    <div {...drag} className={`rounded-2xl border-2 border-dashed px-4 py-3 cursor-pointer transition-colors ${over ? "border-amber-500 bg-amber-100" : "border-amber-200 bg-amber-50 hover:bg-amber-100/60"}`}>
      <input ref={fileRef} type="file" multiple hidden onChange={(e) => { void ingestFiles(Array.from(e.target.files ?? [])); e.currentTarget.value = ""; }} />
      <input ref={folderRef} type="file" hidden {...({ webkitdirectory: "", directory: "" } as any)} onChange={(e) => { void ingestFiles(Array.from(e.target.files ?? [])); e.currentTarget.value = ""; }} />
      <div className="flex items-center gap-2 mb-1">
        <Paperclip className="w-4 h-4 text-amber-700" />
        <h3 className="text-[15px] font-medium text-amber-900">{!complete ? "What would make this a complete record" : "Add further info"}</h3>
        {busy && <Loader2 className="w-4 h-4 animate-spin text-amber-700" />}
      </div>
      {!complete ? (
        <>
          <p className="text-[12px] text-amber-700 mb-2">Still missing for a complete {focus === "neither" ? "community" : focus} record — drop or click to add docs or a whole folder (debrief, budget sheet, brief); only the gaps fill in. <button onClick={(e) => { e.stopPropagation(); folderRef.current?.click(); }} className="underline hover:text-amber-900">Choose a folder</button></p>
          {/* Each gap is its own clickable block: clicking jumps to where the field is entered
              (onResolveGap); when there's no manual editor for it, we fall back to opening the doc
              picker so it can still be filled from a document. stopPropagation so the block's click
              doesn't also trigger the panel-level dropzone click. */}
          <div className="space-y-1.5" onClick={(e) => e.stopPropagation()}>
            {gaps.map((g) => (
              <button
                key={g.key}
                onClick={() => { if (!onResolveGap || !onResolveGap(g.key)) fileRef.current?.click(); }}
                className="group w-full flex items-center gap-2 rounded-lg border border-amber-200 bg-white/60 px-3 py-2 text-left hover:bg-amber-100 transition-colors"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
                <span className="flex-1 min-w-0 text-[13px] text-amber-900 group-hover:underline">{g.label}</span>
                <ChevronRight className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              </button>
            ))}
          </div>
        </>
      ) : (
        <p className="text-[12px] text-amber-700">This record looks complete. Drop or click to add docs or a folder, or correct anything. <button onClick={(e) => { e.stopPropagation(); folderRef.current?.click(); }} className="underline hover:text-amber-900">Choose a folder</button></p>
      )}
      {results && (results.length === 1 && !results[0].name ? (() => {
        const split = splitPullMessage(results[0].message);
        if (!split) return <p className="text-[12px] text-amber-800 mt-2">{results[0].message}</p>;
        return (
          <div className="text-[12px] text-amber-800 mt-2">
            <p>{split.lead}</p>
            <ul className="mt-1 space-y-0.5">
              {split.items.map((it, i) => (
                <li key={i} className="flex items-start gap-1.5">
                  <span className="w-1 h-1 rounded-full bg-amber-500 shrink-0 mt-1.5" />
                  <span>{it}</span>
                </li>
              ))}
            </ul>
          </div>
        );
      })() : (
        <div className="text-[12px] text-amber-800 mt-2">
          <p>{results.length} file{results.length === 1 ? "" : "s"} processed</p>
          <ul className="mt-1 space-y-0.5">
            {results.map((r, i) => (
              <li key={i} className="flex items-start gap-1.5">
                <span className="w-1 h-1 rounded-full bg-amber-500 shrink-0 mt-1.5" />
                <span>{r.name && <span className="font-medium">{r.name}</span>}{r.name ? " — " : ""}{r.message}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}

      {/* Post-event reflections & insights — shown until the record is complete (then auto-checks). */}
      {reflOpen && !complete && (
        <div className="mt-3 pt-3 border-t border-amber-200" onClick={(e) => e.stopPropagation()}>
          <button onClick={() => setConfirmRefl(true)} className="flex items-center gap-2 text-[13px] text-amber-900 hover:text-amber-950">
            <span className="w-4 h-4 rounded border border-amber-400 bg-white shrink-0" />
            Post-event reflections &amp; insights
          </button>
        </div>
      )}
      {confirmRefl && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 p-4" onClick={(e) => { e.stopPropagation(); setConfirmRefl(false); }}>
          <div className="bg-white rounded-2xl border border-gray-200 max-w-sm w-full p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg mb-1">Mark reflections complete?</h3>
            <p className="text-sm text-gray-600 mb-5">This event still isn't a complete record. Check this off? You can still add more information later.</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirmRefl(false)} className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900">Cancel</button>
              <button onClick={checkOffRefl} className="px-3 py-1.5 rounded-lg bg-gray-900 text-white text-sm hover:bg-black">Check it off</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Wrapped "Template" view: the pattern this event feeds. Reuses the pattern-mode TemplateView,
// pointed at the template the event is modeled on; if there's none, offers to derive one. Above
// it, proposes this event's NEW phases/roles/lessons to ADD to the template (propose-then-confirm,
// one-directional — never rewrites the template or sibling events).
function WrappedTemplate({ plan, eventId, onApplied, onOpenEvent }: { plan: EventPlanning; eventId: string; onApplied: () => void; onOpenEvent?: (id: string) => void }) {
  const templateId = plan.modeledOnEventId;
  const [tmpl, setTmpl] = useState<EventPlanning | null>(null);
  const [loading, setLoading] = useState(!!templateId);
  const [deriving, setDeriving] = useState(false);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false); // additions applied → show a condensed confirmation
  const [regenBusy, setRegenBusy] = useState(false);
  const [regenMsg, setRegenMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!templateId) { setTmpl(null); setLoading(false); return; }
    let live = true; setLoading(true);
    getEventPlanning(templateId).then((t) => { if (live) { setTmpl(t); setLoading(false); } }).catch(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [templateId]);

  // No template yet → look for an existing one of the same type to adopt (match, don't auto-merge).
  const [candidates, setCandidates] = useState<TemplateMatch[]>([]);
  useEffect(() => {
    if (templateId) return;
    let live = true;
    listTemplates().then((ts) => { if (live) setCandidates(matchTemplates(ts, { format: plan.format, tag: plan.tags[0] ?? null }).filter((m) => m.score >= 2)); }).catch(() => {});
    return () => { live = false; };
  }, [templateId]);
  const derive = async () => { setDeriving(true); try { await deriveTemplateFromEvent(eventId); onApplied(); } finally { setDeriving(false); } };
  const adopt = async (id: string) => { setBusy(true); try { await adoptTemplate(eventId, id); onApplied(); } finally { setBusy(false); } };

  const adds = tmpl ? templateAdditions(
    { id: tmpl.id, name: tmpl.title, format: tmpl.format, tags: tmpl.tags, phases: tmpl.phases.map((p) => p.name), staffRoles: tmpl.staffRoles, reflections: tmpl.reflections },
    { name: plan.title, date: null, location: null, owner: null, format: plan.format, tag: plan.tags[0] ?? null, headcount: null, turnoutActual: null, budgetTotal: null, verdict: "", phases: plan.phases.map((p) => p.name), staffRoles: plan.staffRoles, lessons: plan.reflections, heuristics: plan.heuristics, actuals: [], deliverables: [], agenda: [] },
  ) : null;
  const addKey = (kind: string, v: string) => `${kind}:${v}`;
  const [addedCount, setAddedCount] = useState(0);
  const apply = async () => {
    if (!templateId || !adds) return;
    const toAdd = {
      phases: adds.phases.filter((v) => !excluded.has(addKey("phase", v))),
      roles: adds.roles.filter((v) => !excluded.has(addKey("role", v))),
      lessons: adds.lessons.filter((v) => !excluded.has(addKey("lesson", v))),
    };
    const n = toAdd.phases.length + toAdd.roles.length + toAdd.lessons.length;
    if (!n) return;
    setBusy(true);
    try {
      await applyTemplateAdditions(templateId, toAdd);
      setAddedCount(n);
      // Refetch the TEMPLATE so the proposal recomputes as EMPTY — the added items must not
      // reappear in the "to add" list once confirmed.
      const fresh = await getEventPlanning(templateId).catch(() => null);
      if (fresh) setTmpl(fresh);
      setDone(true); // persistent confirmation — stays until explicitly dismissed / a refresh
      onApplied();   // refresh the event view too
    } finally { setBusy(false); }
  };
  const dismiss = () => setDone(false);
  // Regenerate the paired template's pattern from THIS (settled) event's source materials.
  const regenerate = async () => {
    if (!tmpl) return;
    setRegenBusy(true); setRegenMsg(null);
    try {
      const msg = await runRegenerate(tmpl, { template: true, source: plan });
      const fresh = await getEventPlanning(tmpl.id).catch(() => null);
      if (fresh) setTmpl(fresh);
      setRegenMsg(msg);
      setTimeout(() => setRegenMsg(null), 6000);
      onApplied();
    } catch (e: any) { setRegenMsg(e?.message ?? String(e)); setTimeout(() => setRegenMsg(null), 6000); }
    finally { setRegenBusy(false); }
  };

  if (loading) return <p className="text-sm text-gray-400">Loading template…</p>;
  if (!templateId || !tmpl) {
    return (
      <div className="bg-white rounded-2xl border border-border p-6">
        <h3 className="font-medium mb-1">No template yet</h3>
        <p className="text-sm text-gray-500 mb-4 max-w-md">This event isn't modeled on a template. {candidates.length ? "Build on a matching one, or derive a new template from its pattern." : "Derive one from its pattern — phases, roles, deliverables, learnings — so the next event of this kind can reuse it."}</p>
        {candidates.length > 0 && (
          <div className="space-y-1.5 mb-4">
            {candidates.map((m) => (
              <div key={m.template.id} className="flex items-center justify-between gap-2 rounded-lg border border-gray-200 px-3 py-2">
                <span className="text-sm">Looks like <span className="font-medium">{m.template.name}</span>{m.template.format ? ` (${m.template.format})` : ""}</span>
                <button onClick={() => adopt(m.template.id)} disabled={busy} className="shrink-0 px-2.5 py-1 rounded-lg border border-gray-300 bg-white text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50">Build on it</button>
              </div>
            ))}
          </div>
        )}
        <button onClick={derive} disabled={deriving} className="px-4 py-2 rounded-lg bg-gray-900 text-white text-sm hover:bg-black disabled:opacity-50">{deriving ? "Deriving…" : "Derive a new template from this event"}</button>
      </div>
    );
  }
  return (
    <div className="space-y-6">
      {/* Header card — regenerate the template's pattern from this event's dropped materials. */}
      <div className="bg-white rounded-2xl border border-border p-4 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-medium truncate">{tmpl.title}</h3>
          <p className="text-[13px] text-gray-500">Template · regenerate its pattern from this event's materials.</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {regenMsg && <span className="text-[13px] text-gray-500 max-w-[16rem] truncate" title={regenMsg}>{regenMsg}</span>}
          <button onClick={regenerate} disabled={regenBusy} title="Regenerate the template from this event's materials" aria-label="Regenerate template" className="w-8 h-8 rounded-full border border-gray-200 text-gray-500 hover:text-gray-900 hover:bg-gray-50 flex items-center justify-center disabled:opacity-60">
            {regenBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          </button>
        </div>
      </div>
      {done ? (
        // Persistent confirmation — stays until explicitly closed (or a page refresh). Links to
        // the template it was added to.
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <span className="inline-flex items-center gap-2 min-w-0">
            <Check className="w-4 h-4 shrink-0" />
            <span>Added {addedCount} item{addedCount === 1 ? "" : "s"} to{" "}
              {onOpenEvent ? (
                <button onClick={() => onOpenEvent(tmpl.id)} className="font-medium underline decoration-dotted underline-offset-2 hover:text-emerald-900">{tmpl.title}</button>
              ) : <span className="font-medium">“{tmpl.title}”</span>}.
            </span>
          </span>
          <button onClick={dismiss} className="shrink-0 text-emerald-600 hover:text-emerald-900" aria-label="Dismiss"><X className="w-4 h-4" /></button>
        </div>
      ) : adds && hasAdditions(adds) ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-[13px] font-medium text-amber-900 mb-1">This event adds to “{tmpl.title}”</p>
          <p className="text-[12px] text-amber-700 mb-2">Only what's new. Confirming adds to the template — it never rewrites the template's pattern or other events.</p>
          <div className="space-y-1">
            {([["phase", adds.phases], ["role", adds.roles], ["lesson", adds.lessons]] as const).flatMap(([kind, items]) => items.map((v) => {
              const k = addKey(kind, v);
              return (
                <label key={k} className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={!excluded.has(k)} onChange={() => setExcluded((p) => { const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n; })} />
                  <span className="text-gray-400 text-[11px] uppercase w-12 shrink-0">{kind}</span><span className="flex-1">{v}</span>
                </label>
              );
            }))}
          </div>
          <div className="flex items-center gap-2 mt-2">
            {(() => {
              const selected = adds.phases.length + adds.roles.length + adds.lessons.length - excluded.size;
              return <button onClick={apply} disabled={busy || selected <= 0} className="px-3 py-1.5 rounded-lg bg-gray-900 text-white text-sm hover:bg-black disabled:opacity-50">{busy ? "Adding…" : "Add to template"}</button>;
            })()}
          </div>
        </div>
      ) : null}
      <TemplateView plan={tmpl} eventId={tmpl.id} onExit={() => {}} onOpenEvent={onOpenEvent} />
    </div>
  );
}

// Wrapped "Deliverables" tab: a read-only RECORD of what shipped (and who owned it), grouped by
// phase. Everything's done by nature here — no statuses to change, no overdue, no worklist.
// Droppable phase card + draggable row for moving a deliverable between sections on the record.
function WrapDroppable({ id, children }: { id: string; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return <div ref={setNodeRef} className={`bg-white rounded-2xl border p-5 transition-shadow ${isOver ? "border-gray-400 ring-2 ring-gray-300" : "border-border"}`}>{children}</div>;
}
function WrapDraggable({ id, children }: { id: string; children: (h: { setNodeRef: (el: HTMLElement | null) => void; attributes: any; listeners: any; style: any; isDragging: boolean }) => React.ReactNode }) {
  const { setNodeRef, attributes, listeners, transform, isDragging } = useDraggable({ id });
  const style = transform ? { transform: `translate(${transform.x}px, ${transform.y}px)`, zIndex: 50, position: "relative" as const } : undefined;
  return <>{children({ setNodeRef, attributes, listeners, style, isDragging })}</>;
}

function WrappedDeliverables({ plan }: { plan: EventPlanning }) {
  const nodeNames = plan.phases.map((p) => p.name);
  const [dels, setDels] = useState<Deliverable[]>(plan.deliverables);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor));
  // Bucket a deliverable to a phase CARD. If its phase is EXACTLY one of the event's phases, use
  // that — do NOT run canonicalPhaseFor, which aliases by role and can collapse distinct buckets
  // (e.g. "Setup & check-in" → "Planning & coordination"), stranding the target as always-empty and
  // making a drop there bounce straight back. Only fall back to aliasing for a foreign phase name.
  const bucketOf = (phase: string | null | undefined) =>
    (phase && nodeNames.includes(phase)) ? phase : (canonicalPhaseFor(phase ?? "", nodeNames) || "Other");
  const byPhase = new Map<string, Deliverable[]>();
  for (const n of nodeNames) byPhase.set(n, []); // seed EVERY phase so empty ones still render as a drop target
  for (const d of dels) { const k = bucketOf(d.phase); if (!byPhase.has(k)) byPhase.set(k, []); byPhase.get(k)!.push(d); }
  const order = new Map(nodeNames.map((n, i) => [n, i]));
  const phaseOrder = [...byPhase.keys()].sort((a, b) => (order.get(a) ?? 99) - (order.get(b) ?? 99));
  // Per-phase colors (same palette as the timeline/template), so section + task dots match the
  // rest of the app instead of being flat gray. Unknown phases fall back by position.
  const colorByName = new Map(enrichPhases({ phases: plan.phases, walkthrough: plan.walkthrough, deliverables: dels }, DELIVERABLE_PHASES).map((p) => [p.name, p.color]));
  const colorFor = (name: string, i: number) => colorByName.get(name) ?? PHASE_COLORS[i % PHASE_COLORS.length];
  const done = dels.filter((d) => d.status === "Done").length;
  const whoFor = (d: Deliverable) => (d.ownerRole ? plan.roleAssignments[d.ownerRole] ?? d.ownerRole : null);
  // Drag a deliverable onto a different phase card → move it there (keeps its T-offsets/status).
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over) return;
    const id = String(e.active.id);
    const toPhase = String(e.over.id);
    const cur = dels.find((d) => d.id === id);
    const fromPhase = cur ? bucketOf(cur.phase) : null;
    if (fromPhase === toPhase) return;
    setDels((p) => p.map((d) => (d.id === id ? { ...d, phase: toPhase } : d)));
    setDeliverablePhase(id, toPhase).catch(() => {});
  };
  return (
    <section className="space-y-4">
      <p className="text-[13px] text-gray-500">What shipped — {done}/{dels.length} complete. Drag a task to move it to another section.</p>
      {/* Run of show — drop a schedule on the page to fill this; shows once recorded. */}
      <div className="bg-white rounded-2xl border border-border p-5">
        <h4 className="font-medium mb-2">Run of show</h4>
        {plan.agenda.length === 0 ? (
          <p className="text-sm text-gray-400">No run-of-show on record — drop the schedule (.docx / .txt / .csv) on this page to add it.</p>
        ) : (
          <ul className="divide-y divide-gray-100 text-sm">
            {plan.agenda.map((a, i) => (
              <li key={i} className="flex gap-3 py-1.5"><span className="text-gray-400 w-20 tabular-nums shrink-0">{a.time}</span><span className="text-gray-800">{a.title}</span></li>
            ))}
          </ul>
        )}
      </div>
      {dels.length === 0 && <p className="text-sm text-gray-400">No deliverables on record.</p>}
      {/* pointerWithin: the drop resolves to whichever phase CARD the pointer is over — reliable for
          dropping a small row onto a large card (closestCorners would keep matching the origin card). */}
      <DndContext sensors={sensors} collisionDetection={pointerWithin} onDragEnd={onDragEnd}>
      {phaseOrder.map((name, i) => {
        const color = colorFor(name, i);
        return (
        <WrapDroppable key={name} id={name}>
          <h4 className="font-medium mb-2 flex items-center gap-2"><span className={`w-2.5 h-2.5 rounded-full shrink-0 ${color.dot}`} />{name}</h4>
          {byPhase.get(name)!.length === 0 && <p className="text-sm text-gray-400 py-2">Empty — drag a task here.</p>}
          <ul className="divide-y divide-gray-100 text-sm">
            {byPhase.get(name)!.map((d) => (
              <WrapDraggable key={d.id} id={d.id}>
                {({ setNodeRef, attributes, listeners, style, isDragging }) => (
                  <li ref={setNodeRef} style={style} className={`flex items-center gap-2 py-2 ${isDragging ? "opacity-60 bg-white shadow" : ""}`}>
                    <button type="button" {...attributes} {...listeners} className="shrink-0 cursor-grab touch-none text-gray-300 hover:text-gray-500 active:cursor-grabbing" aria-label="Drag to another section" title="Drag to move to another section"><GripVertical className="w-4 h-4" /></button>
                    <span className={`w-2 h-2 rounded-full shrink-0 ${color.dot} ${d.status === "Done" ? "" : "opacity-40"}`} title={d.status === "Done" ? "Done" : d.status ?? "Todo"} />
                    <span className="flex-1 min-w-0 truncate text-gray-800">{d.title}</span>
                    {whoFor(d) && <span className="text-[12px] text-gray-500 inline-flex items-center gap-1 shrink-0"><Users className="w-3 h-3" /> {whoFor(d)}</span>}
                  </li>
                )}
              </WrapDraggable>
            ))}
          </ul>
        </WrapDroppable>
        );
      })}
      </DndContext>
    </section>
  );
}

// Locked rundown: a settled event is a read-only record. No phase navigation, no editing —
// just the summarized info (outcome, the numbers, what shipped, lessons, who filled which role,
// who mattered, the debrief notes).
// The focus classification, as an editable pill. Hover shows an × to clear it to "Community" (which
// drops the hiring/client-only tiles); clicking opens a picker (Hiring / Client / Community / Auto).
// Auto (null) falls back to the keyword classifier. Persists via setEventFocus and lifts the change
// so the surrounding view re-derives its tiles immediately.
function FocusPill({ eventId, focus, override, onChange }: { eventId: string; focus: EventFocus; override: EventFocus | null; onChange: (f: EventFocus | null) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);
  const set = (f: EventFocus | null) => { onChange(f); void setEventFocus(eventId, f).catch(() => {}); setOpen(false); };
  const color = focus === "hiring" ? "bg-violet-50 text-violet-700 border border-violet-200" : focus === "client" ? "bg-blue-50 text-blue-700 border border-blue-200" : "bg-gray-100 text-gray-500 border border-transparent";
  const opts: { key: EventFocus | null; label: string }[] = [
    { key: "hiring", label: "Hiring-focused" }, { key: "client", label: "Client / conference" },
    { key: "neither", label: "Community" }, { key: null, label: "Auto-detect" },
  ];
  return (
    <span ref={ref} className="relative group/focus inline-flex items-center">
      <button onClick={() => setOpen((o) => !o)} title="Set what this event is for" className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full ${color} hover:brightness-95`}>
        {FOCUS_LABEL[focus]}
        {override && <span className="text-[9px] opacity-60">·set</span>}
      </button>
      {/* Hover-to-clear: only shown when there's a non-community focus to remove. */}
      {focus !== "neither" && (
        <button onClick={() => set("neither")} title="Remove focus (→ Community)" className="ml-0.5 opacity-0 group-hover/focus:opacity-100 text-gray-400 hover:text-red-600 transition-opacity"><X className="w-3 h-3" /></button>
      )}
      {open && (
        <span className="absolute z-50 top-full right-0 mt-1 w-40 rounded-lg border border-border bg-white shadow-lg p-1 text-left">
          {opts.map((o) => {
            const active = o.key === null ? override === null : override === o.key;
            return (
              <button key={o.label} onClick={() => set(o.key)} className={`block w-full text-left px-2 py-1 rounded text-[13px] ${active ? "bg-gray-100 font-medium" : "hover:bg-gray-50"}`}>
                {o.label}{o.key === null && <span className="text-gray-400"> (keyword guess)</span>}
              </button>
            );
          })}
        </span>
      )}
    </span>
  );
}

function LockedRundown({ plan, assignedTarget, onOpenPeople, onOpenBudget, onApplied, onFocusChange }: { plan: EventPlanning; assignedTarget: number | null; onOpenPeople: () => void; onOpenBudget?: () => void; onApplied?: () => void; onFocusChange?: (f: EventFocus | null) => void }) {
  const [stats, setStats] = useState<PeopleStats | null>(null);
  const [tags, setTags] = useState<EventPersonTag[]>([]);
  const [lessons, setLessons] = useState<string[]>(plan.reflections ?? []);
  const removeLearning = (i: number) => {
    const next = lessons.filter((_, j) => j !== i);
    setLessons(next);
    setEventReflections(plan.id, next).catch(() => {});
    onApplied?.();
  };
  useEffect(() => {
    let live = true;
    getEventPeopleStats(plan.id).then((s) => { if (live) setStats(s); }).catch(() => {});
    listEventTags(plan.id).then((t) => { if (live) setTags(t); }).catch(() => {});
    return () => { live = false; };
  }, [plan.id]);

  // General turnout = heads counted / estimated (event-level stat). Known people = the individuals
  // we actually have records for (identified attendees). They differ — you count more heads than you
  // can name. Show general turnout big; float known-people small when it's a different number.
  const counted = plan.checkedIn ?? null;                       // heads counted at the event
  const estimated = plan.rsvp ?? stats?.registered ?? null;     // RSVPs / expected
  const known = stats?.total ?? null;                           // identified attendee records
  const showPct = estimated && counted != null ? Math.round((counted / estimated) * 100) : null;
  const lines = plan.budget?.lines ?? [];
  const spent = lines.filter((l) => l.status === "paid").reduce((s, l) => s + (l.confirmedAmount ?? 0), 0);
  const target = assignedTarget ?? plan.budget?.targetAmount ?? null;
  const perHead = counted ? Math.round(spent / counted) : null;
  const focus = eventFocus(plan.tags, plan.format, plan.focusOverride);
  const roles = Object.entries(plan.roleAssignments ?? {});
  const tagged = new Map<string, { name: string | null; starred: boolean }>();
  for (const t of tags.filter((t) => t.status === "confirmed")) {
    const cur = tagged.get(t.attendeeId) ?? { name: t.name, starred: false };
    cur.starred = cur.starred || t.priority; tagged.set(t.attendeeId, cur);
  }
  // A tile becomes a button (with a chevron affordance) when it links somewhere.
  const Tile = ({ label, value, hint, onClick }: { label: string; value: React.ReactNode; hint?: string; onClick?: () => void }) => {
    const cls = "bg-gradient-to-b from-primary/5 to-white to-60% rounded-2xl border border-border p-5";
    const body = (
      <>
        <p className="text-[13px] text-gray-500 mb-1 inline-flex items-center gap-1">{label}{onClick && <ChevronRight className="w-3.5 h-3.5 text-gray-400" />}</p>
        <p className="text-2xl font-semibold text-gray-900">{value}</p>
        {hint && <p className="text-[11px] text-gray-400">{hint}</p>}
      </>
    );
    return onClick
      ? <button onClick={onClick} className={`${cls} w-full text-left hover:bg-gray-50/80 transition-colors`}>{body}</button>
      : <div className={cls}>{body}</div>;
  };

  return (
    <div className="space-y-6">
      {/* outcome banner */}
      <div className="rounded-2xl border border-gray-200 bg-gray-50 px-5 py-4">
        <div className="flex items-center gap-2 mb-1">
          <Lock className="w-4 h-4 text-gray-400" />
          <h3 className="font-medium">Final record</h3>
          {plan.settledAt && <span className="text-[12px] text-gray-400">settled {fmtShort(plan.settledAt.slice(0, 10))}</span>}
          <span className="ml-auto"><FocusPill eventId={plan.id} focus={focus} override={plan.focusOverride} onChange={(f) => onFocusChange?.(f)} /></span>
        </div>
        <p className="text-sm text-gray-800">{plan.verdict ? plan.verdict : <span className="text-gray-400">No verdict recorded.</span>}</p>
      </div>

      {/* the numbers */}
      <div className={`grid grid-cols-1 sm:grid-cols-2 gap-4 ${focus === "neither" ? "lg:grid-cols-3" : "lg:grid-cols-4"}`}>
        {/* Turnout (the people card): general turnout counted/estimated, with known-people floating. Links to People. */}
        <button onClick={onOpenPeople} className="relative w-full text-left bg-gradient-to-b from-primary/5 to-white to-60% rounded-2xl border border-border p-5 hover:bg-gray-50/80 transition-colors">
          {known != null && known !== counted && (
            <span className="absolute top-2 right-3 text-[11px] text-gray-400" title="people we have records for (by name/email)">{known} known</span>
          )}
          <p className="text-[13px] text-gray-500 mb-1 inline-flex items-center gap-1">Turnout <ChevronRight className="w-3.5 h-3.5 text-gray-400" /></p>
          <p className="text-2xl font-semibold text-gray-900">{counted ?? estimated ?? "—"}{estimated != null && counted != null && <span className="text-base text-gray-400"> / {estimated}</span>}</p>
          <p className="text-[11px] text-gray-400">{showPct != null ? `${showPct}% show rate` : counted != null ? "counted" : "RSVPs"}</p>
        </button>
        <Tile label="Final spend" value={<>{money(spent)}{target != null && <span className="text-base text-gray-400"> / {money(target)}</span>}</>} hint={target != null ? (spent > target ? `${money(spent - target)} over` : `${money(target - spent)} under`) : "paid"} onClick={onOpenBudget} />
        <Tile label="Cost per head" value={perHead != null ? money(perHead) : "—"} hint="spend ÷ counted" onClick={onOpenBudget} />
        {focus === "hiring" && <Tile label="Candidates flagged" value={attendeesFlagged(tags) || "—"} hint="tagged candidate" onClick={onOpenPeople} />}
        {focus === "client" && <Tile label="Clients & partners" value={[...tagged.values()].length || "—"} hint="tagged" onClick={onOpenPeople} />}
      </div>

      {/* Learnings — full width. Same data as reflections, the post-event framing. */}
      <div>
        <h4 className="font-medium mb-2">Learnings</h4>
        {lessons.length === 0 ? (
          <div className="bg-white rounded-2xl border border-border p-6 text-sm text-gray-400">None recorded.</div>
        ) : (
          <div className="bg-white rounded-2xl border border-border divide-y divide-gray-100">
            {lessons.map((l, i) => (
              <div key={i} className="group px-6 py-4 flex gap-3">
                <Lightbulb className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
                <p className="text-sm text-gray-700 flex-1">{l}</p>
                <button onClick={() => removeLearning(i)} title="Delete learning" aria-label="Delete learning" className="shrink-0 text-gray-300 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity"><X className="w-3.5 h-3.5" /></button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Roles — full width when present. */}
      {roles.length > 0 && (
        <div className="bg-white rounded-2xl border border-border p-5">
          <h4 className="font-medium mb-2">Roles</h4>
          <ul className="space-y-1 text-sm">{roles.map(([role, who]) => <li key={role} className="flex justify-between gap-2"><span className="text-gray-500">{role}</span><span className="text-gray-800">{who}</span></li>)}</ul>
        </div>
      )}

      {/* Who mattered + Vendors — equal split below Learnings (same width & height). */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
        <button onClick={onOpenPeople} className="h-full bg-white rounded-2xl border border-border p-5 text-left hover:bg-gray-50">
          <h4 className="font-medium mb-1 inline-flex items-center gap-1.5">Who mattered <ChevronRight className="w-4 h-4 text-gray-400" /></h4>
          {tagged.size === 0 ? <p className="text-[13px] text-gray-400">No one tagged.</p> : (
            <div className="flex items-center gap-2 flex-wrap text-[13px]">
              <span className="text-gray-600">{tagged.size} tagged</span>
              {[...tagged.values()].slice(0, 5).map((p, i) => <span key={i} className="inline-flex items-center gap-1 bg-gray-100 text-gray-700 rounded-full px-2.5 py-0.5">{p.starred && <Star className="w-3 h-3 text-amber-500" fill="currentColor" />}{p.name ?? "—"}</span>)}
            </div>
          )}
        </button>
        <div className="h-full bg-white rounded-2xl border border-border p-5">
          <h4 className="font-medium mb-2">Vendors <span className="text-gray-400 font-normal text-sm">· who we used</span></h4>
          {plan.engagements.length === 0 ? <p className="text-sm text-gray-400">No vendors recorded.</p> : (
            <ul className="space-y-1 text-sm">
              {plan.engagements.map((e) => {
                const sel = e.candidates.find((c) => c.isSelected);
                return (
                  <li key={e.id} className="flex justify-between gap-2">
                    <span className="text-gray-500 truncate">{e.category ?? "—"}{sel?.vendorName ? ` · ${sel.vendorName}` : ""}</span>
                    <span className="text-gray-800 shrink-0">{e.confirmedAmount != null ? money(e.confirmedAmount) : e.stage}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {/* debrief notes */}
      {plan.debriefNotes && (
        <details className="bg-white rounded-2xl border border-border p-5">
          <summary className="font-medium cursor-pointer">Debrief notes</summary>
          <p className="mt-2 text-sm text-gray-700 whitespace-pre-wrap">{plan.debriefNotes}</p>
        </details>
      )}
    </div>
  );
}
const attendeesFlagged = (tags: EventPersonTag[]) => new Set(tags.filter((t) => t.status === "confirmed" && t.lens === "candidate").map((t) => t.attendeeId)).size;

// Settling lifecycle: just wrapped → debriefed → settled. "Settle" carries the event's
// confirmed reflections back to the template it was modeled on (atomic, via settle_event RPC).
const SETTLE_STEPS: { key: SettleState; label: string }[] = [
  { key: "just_wrapped", label: "Just wrapped" },
  { key: "debriefed", label: "Debriefed" },
  { key: "settled", label: "Settled" },
];
function SettlingTracker({ plan, spent, target, onApplied }: { plan: EventPlanning; spent: number; target: number | null; onApplied: () => void }) {
  // Post-event view only renders once the date has passed → default to "just wrapped".
  const state: SettleState = plan.settleState ?? "just_wrapped";
  const idx = SETTLE_STEPS.findIndex((s) => s.key === state);
  const [verdict, setVerdict] = useState(plan.verdict ?? "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [confirmSettle, setConfirmSettle] = useState(false); // unassigned-roles "are you sure" gate
  // Roles → people: the owner resolves each staff role to a person as part of settling.
  const roles = plan.staffRoles ?? [];
  const [assigns, setAssigns] = useState<Record<string, string>>(plan.roleAssignments ?? {});
  const unassigned = roles.filter((r) => !(assigns[r] ?? "").trim()).length;
  // Assignees are chosen from accounts (profiles), @instalily.ai only — same control as Staffing.
  const { profiles } = useProfile();
  const team = profiles.filter((p) => (p.email ?? "").toLowerCase().endsWith("@instalily.ai"));
  const assignRole = (role: string, name: string | null) => {
    setAssigns((prev) => {
      const next = { ...prev };
      if (name) next[role] = name; else delete next[role];
      setRoleAssignments(plan.id, next).catch(() => {});
      return next;
    });
  };

  const saveVerdict = () => { if ((verdict.trim() || null) !== (plan.verdict ?? null)) setEventVerdict(plan.id, verdict).catch(() => {}); };
  const markDebriefed = async () => { setBusy(true); try { await setSettleState(plan.id, "debriefed"); onApplied(); } finally { setBusy(false); } };
  const settle = async () => {
    setBusy(true); setMsg(null);
    try {
      if (verdict.trim() !== (plan.verdict ?? "")) await setEventVerdict(plan.id, verdict).catch(() => {});
      if (roles.length) await setRoleAssignments(plan.id, assigns).catch(() => {});
      const r = await settleEvent(plan.id);
      setMsg(r.template ? `Settled · carried ${r.reflectionsCarried} learning${r.reflectionsCarried === 1 ? "" : "s"} back to the template.` : "Settled · no template to carry learnings to.");
      onApplied();
    } catch (e: any) { setMsg(e?.message ?? String(e)); }
    finally { setBusy(false); }
  };

  return (
    <section className="bg-white rounded-2xl border border-border p-5">
      <div className="flex items-center justify-between gap-3 mb-3">
        <h3 className="font-medium">Wrap-up</h3>
        {plan.settledAt && <span className="text-[12px] text-gray-400">settled {fmtShort(plan.settledAt.slice(0, 10))}</span>}
      </div>
      {/* tracker */}
      <div className="flex items-center gap-2 mb-4">
        {SETTLE_STEPS.map((s, i) => (
          <div key={s.key} className="flex items-center gap-2">
            <span className={`flex items-center justify-center w-6 h-6 rounded-full text-[12px] shrink-0 ${i < idx ? "bg-emerald-600 text-white" : i === idx ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-400"}`}>{i < idx ? <Check className="w-3.5 h-3.5" /> : i + 1}</span>
            <span className={`text-sm ${i === idx ? "text-gray-900 font-medium" : i < idx ? "text-gray-600" : "text-gray-400"}`}>{s.label}</span>
            {i < SETTLE_STEPS.length - 1 && <span className="w-6 h-px bg-gray-200" />}
          </div>
        ))}
      </div>
      {/* recorded outcome */}
      <label className="block text-[13px] text-gray-500 mb-1">Outcome / verdict</label>
      <textarea
        value={verdict}
        onChange={(e) => setVerdict(e.target.value)}
        onBlur={saveVerdict}
        disabled={state === "settled"}
        rows={2}
        placeholder="One-line verdict — how did it land? what's the call on running it again?"
        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-300 disabled:bg-gray-50 disabled:text-gray-500"
      />
      {/* roles → people (only when the event carries staff roles) */}
      {roles.length > 0 && (
        <div className="mt-4">
          <div className="flex items-center gap-2 mb-1">
            <label className="block text-[13px] text-gray-500">Assign roles</label>
            {unassigned > 0 && <span className="text-[11px] text-amber-600">{unassigned} unassigned</span>}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {roles.map((r) => (
              <div key={r} className="flex items-center gap-2">
                <span className="text-sm text-gray-600 w-32 shrink-0 truncate" title={r}>{r}</span>
                <AssigneePicker
                  team={team}
                  current={assigns[r] || null}
                  disabled={state === "settled"}
                  onPick={(name) => assignRole(r, name)}
                />
              </div>
            ))}
          </div>
        </div>
      )}
      {/* final actuals + transition */}
      <div className="flex items-center justify-between gap-3 mt-3">
        <p className="text-[12px] text-gray-400">Final spend {money(spent)}{target != null && <> of {money(target)} target</>}.</p>
        <div className="flex items-center gap-2">
          {state === "just_wrapped" && <button onClick={markDebriefed} disabled={busy} className="px-3 py-1.5 rounded-lg border border-gray-300 bg-white text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50">Mark debriefed</button>}
          {/* Assigning people is no longer required to settle — unassigned roles just prompt a confirm. */}
          {state === "debriefed" && <button onClick={() => { if (unassigned > 0) setConfirmSettle(true); else void settle(); }} disabled={busy} className="px-3 py-1.5 rounded-lg bg-gray-900 text-white text-sm hover:bg-black disabled:opacity-50">{busy ? "Settling…" : "Settle & write back"}</button>}
          {state === "settled" && <span className="inline-flex items-center gap-1 text-sm text-emerald-700"><Check className="w-4 h-4" /> Settled</span>}
        </div>
      </div>
      {msg && <p className="text-[12px] text-gray-500 mt-2">{msg}</p>}

      {confirmSettle && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/30 p-4" onClick={() => !busy && setConfirmSettle(false)}>
          <div className="bg-white rounded-2xl border border-border max-w-sm w-full p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg mb-1">Settle without everyone tagged?</h3>
            <p className="text-sm text-gray-600 mb-5">{unassigned} role{unassigned === 1 ? "" : "s"} {unassigned === 1 ? "isn't" : "aren't"} assigned to a person. You can settle now and tag them later.</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirmSettle(false)} disabled={busy} className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900">Cancel</button>
              <button onClick={() => { setConfirmSettle(false); void settle(); }} disabled={busy} className="px-3 py-1.5 rounded-lg bg-gray-900 text-white text-sm hover:bg-black disabled:opacity-50">Settle anyway</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

// ── Post-event view: how it went → close it out → reflection → attendees ──────
// Stats, close-out and attendee tagging render immediately on wrap (real captured data);
// only the reflection section waits on the debrief. This view is past-only — no projections.
function PostEventView({ plan, temporal, onOpenDeliverable, onOpenPeople, assignedTarget, onApplied, onFocusChange }: { plan: EventPlanning; temporal: "past" | "current" | "future"; onOpenDeliverable: (id: string) => void; onOpenPeople: () => void; assignedTarget: number | null; onApplied: () => void; onFocusChange?: (f: EventFocus | null) => void }) {
  const future = temporal === "future"; // only when previewing post on a not-yet-passed event
  const [stats, setStats] = useState<PeopleStats | null>(null);
  const [attendees, setAttendees] = useState<PersonView[]>([]);
  useEffect(() => {
    if (future) return; // nothing real to load for an event that hasn't happened
    let live = true;
    getEventPeopleStats(plan.id).then((s) => { if (live) setStats(s); }).catch(() => {});
    listAttendeesForEvent(plan.id).then((a) => { if (live) setAttendees(a); }).catch(() => {});
    return () => { live = false; };
  }, [plan.id, future]);

  const rsvp = plan.rsvp ?? stats?.registered ?? null;
  // Turnout = check-in scans. Past events usually have a guest list but were never scanned in, so a
  // raw 0 is misleading — fall back to the number of people on the list (the attendance record for a
  // backfilled event). Future previews keep the true 0 (nobody's attended yet).
  const scanned = stats?.checkedIn ?? 0;
  const checkedIn = (!future && scanned === 0) ? (stats?.total ?? null) : (stats?.checkedIn ?? null);
  const showPct = rsvp && checkedIn != null ? Math.round((checkedIn / rsvp) * 100) : null;
  const lines = plan.budget?.lines ?? [];
  const spent = lines.filter((l) => l.status === "paid").reduce((s, l) => s + (l.confirmedAmount ?? 0), 0);
  const target = assignedTarget ?? plan.budget?.targetAmount ?? null;
  const overUnder = target != null ? spent - target : null;
  // Cost per head divides by the best turnout count we have: checked-in, else RSVPs, else expected.
  const turnoutCount = checkedIn ?? rsvp ?? plan.headcount ?? null;
  const perHead = turnoutCount ? Math.round(spent / turnoutCount) : null;
  const flagged = attendees.filter((a) => a.applicationStatus && a.applicationStatus !== "none").length;
  // What the event is FOR shapes how we measure turnout (candidate vs client signal vs none).
  const focus = eventFocus(plan.tags, plan.format, plan.focusOverride);
  const clientCount = attendees.filter((a) => a.type === "Client" || a.type === "Partner").length;

  // Dropping a file ANYWHERE on the post-event view = debrief / post-event material → route it
  // into the reflection extractor and scroll there.
  const [over, setOver] = useState(false);
  const [incoming, setIncoming] = useState<{ text: string; nonce: number } | null>(null);
  const dropNonce = useRef(0);
  const onDropMaterial = async (file?: File | null) => {
    setOver(false);
    if (!file) return;
    try {
      const text = await file.text();
      if (!text.trim()) return;
      dropNonce.current += 1;
      setIncoming({ text, nonce: dropNonce.current });
      setTimeout(() => document.getElementById("post-event-reflection")?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
    } catch { /* unreadable file — ignore */ }
  };

  return (
    <div
      // stopPropagation so the drop is handled HERE as debrief material, not bubbled to the
      // app-level handler that opens the create-event flow + jumps to the Events page.
      onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); setOver(true); }}
      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setOver(true); }}
      onDragLeave={(e) => { e.stopPropagation(); if (e.currentTarget === e.target) setOver(false); }}
      onDrop={(e) => { e.preventDefault(); e.stopPropagation(); void onDropMaterial(e.dataTransfer.files?.[0]); }}
      className="relative space-y-6"
    >
      {over && (
        <div className="absolute inset-0 z-20 rounded-2xl bg-white/85 border-2 border-dashed border-gray-800 flex items-center justify-center pointer-events-none">
          <span className="inline-flex items-center gap-2 text-sm text-gray-800"><Paperclip className="w-4 h-4" /> Drop debrief / post-event material to process</span>
        </div>
      )}
      {future && <ProjectionBanner label="Post-event" />}

      {/* 0 · Settling lifecycle — just wrapped → debriefed → settled + recorded outcome */}
      {!future && <SettlingTracker plan={plan} spent={spent} target={target} onApplied={onApplied} />}

      {/* 1 · How it went — real captured data, no projections. The 4th metric is the event's
          purpose signal: candidates (hiring) / clients (client) / none (community). */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <h3 className="text-lg font-medium">How it went</h3>
          <FocusPill eventId={plan.id} focus={focus} override={plan.focusOverride} onChange={(f) => onFocusChange?.(f)} />
        </div>
        <div className={`grid grid-cols-1 sm:grid-cols-2 gap-4 ${focus === "neither" ? "lg:grid-cols-3" : "lg:grid-cols-4"}`}>
          <div className="bg-white rounded-2xl border border-border p-5">
            <p className="text-[13px] text-gray-500 mb-1">Turnout</p>
            <p className="text-2xl font-semibold text-gray-900">{checkedIn ?? "—"}<span className="text-base text-gray-400"> / {rsvp ?? "—"}</span></p>
            <p className="text-[11px] text-gray-400">{showPct != null ? `${showPct}% show rate` : "checked in / RSVPs"}</p>
          </div>
          <div className="bg-white rounded-2xl border border-border p-5">
            <p className="text-[13px] text-gray-500 mb-1">Spend vs target</p>
            <p className="text-2xl font-semibold text-gray-900">{money(spent)}{target != null && <span className="text-base text-gray-400"> / {money(target)}</span>}</p>
            <p className={`text-[11px] ${overUnder == null ? "text-gray-400" : overUnder > 0 ? "text-red-600" : "text-emerald-600"}`}>{overUnder == null ? "paid to date" : overUnder > 0 ? `${money(overUnder)} over` : overUnder < 0 ? `${money(-overUnder)} under` : "on target"}</p>
          </div>
          <div className="bg-white rounded-2xl border border-border p-5">
            <p className="text-[13px] text-gray-500 mb-1">Cost per head</p>
            <p className="text-2xl font-semibold text-gray-900">{perHead != null ? money(perHead) : "—"}</p>
            <p className="text-[11px] text-gray-400">spend ÷ {checkedIn != null ? "checked in" : rsvp != null ? "RSVPs" : "expected"}</p>
          </div>
          {/* purpose signal — hiring shows candidates, client shows clients, community shows nothing */}
          {focus === "hiring" && (
            <div className="bg-white rounded-2xl border border-border p-5">
              <p className="text-[13px] text-gray-500 mb-1">Flagged in Greenhouse</p>
              <p className="text-2xl font-semibold text-gray-900">{flagged || "—"}</p>
              <p className="text-[11px] text-gray-400">attendees with an application</p>
            </div>
          )}
          {focus === "client" && (
            <div className="bg-white rounded-2xl border border-border p-5">
              <p className="text-[13px] text-gray-500 mb-1">Clients & partners</p>
              <p className="text-2xl font-semibold text-gray-900">{clientCount || "—"}</p>
              <p className="text-[11px] text-gray-400">in the room</p>
            </div>
          )}
        </div>
      </section>

      {/* 2 · Close it out — actionable post-event work + the debrief */}
      <CloseItOut plan={plan} onOpenDeliverable={onOpenDeliverable} onOpenPeople={onOpenPeople} onApplied={onApplied} />

      {/* 3 · Post-event reflection — gated on the debrief; doesn't block the rest */}
      <ReflectionSection plan={plan} onApplied={onApplied} incoming={incoming} />

      {/* 4 · Who mattered — summary + entry point only; the tagging workspace lives on People */}
      <WhoMattered eventId={plan.id} onOpenPeople={onOpenPeople} />
    </div>
  );
}

// Overview "Who mattered" — early-signals summary, NOT the triage UI. Counts + top chips + a
// "Tag the room →" that opens the People-page workspace where tagging actually happens.
function WhoMattered({ eventId, onOpenPeople }: { eventId: string; onOpenPeople: () => void }) {
  const [tags, setTags] = useState<EventPersonTag[]>([]);
  useEffect(() => { let live = true; listEventTags(eventId).then((t) => { if (live) setTags(t); }).catch(() => {}); return () => { live = false; }; }, [eventId]);
  const confirmed = tags.filter((t) => t.status === "confirmed");
  const proposals = tags.filter((t) => t.status === "proposed").length;
  const byPerson = new Map<string, { name: string | null; email: string | null; starred: boolean }>();
  for (const t of confirmed) {
    const cur = byPerson.get(t.attendeeId) ?? { name: t.name, email: t.email, starred: false };
    cur.starred = cur.starred || t.priority;
    byPerson.set(t.attendeeId, cur);
  }
  const people = [...byPerson.values()];
  const flagged = people.filter((p) => p.starred).length;
  const top = [...people].sort((a, b) => Number(b.starred) - Number(a.starred)).slice(0, 3);

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-lg font-medium">Who mattered</h3>
          <p className="text-[12px] text-gray-400">early signals · who we think, not results</p>
        </div>
        <button onClick={onOpenPeople} className="text-sm text-gray-600 hover:text-gray-900 inline-flex items-center gap-1">Tag the room <ChevronRight className="w-4 h-4" /></button>
      </div>
      <button onClick={onOpenPeople} className="w-full bg-white rounded-2xl border border-border p-5 text-left hover:bg-gray-50">
        {people.length === 0 ? (
          <p className="text-sm text-gray-500">{proposals ? `${proposals} proposal${proposals === 1 ? "" : "s"} to review.` : "No one tagged yet."} Open the People workspace to tag the room.</p>
        ) : (
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-sm text-gray-700">{people.length} tagged · {flagged} starred{proposals ? ` · ${proposals} to review` : ""}</span>
            <span className="flex items-center gap-1.5 flex-wrap">
              {top.map((p, i) => <span key={i} className="inline-flex items-center gap-1 text-[13px] bg-gray-100 text-gray-700 rounded-full px-2.5 py-0.5">{p.starred && <Star className="w-3 h-3 text-amber-500" fill="currentColor" />}{p.name ?? p.email ?? "—"}</span>)}
            </span>
          </div>
        )}
      </button>
    </section>
  );
}

// The day-after debrief: gated to client/recruiting/larger events; V0 books it as an in-app task
// (idempotent), confirm-first. Live calendar booking + invites isn't wired yet.
function DebriefCard({ plan, onApplied }: { plan: EventPlanning; onApplied: () => void }) {
  const existing = plan.deliverables.find((d) => /debrief/i.test(d.title));
  const funding = fundingFor(plan.tags);
  const autoWorthy = funding.category === "Hosted" || funding.category === "Sponsorship"; // off for Internal/community
  const due = plan.date ? addDays(plan.date, 1) : null;
  const invitees = [...plan.owners.map((o) => o.name), ...plan.staffRoles];
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const postPhase = plan.phases[plan.phases.length - 1]?.name ?? "Wrap-up";

  const schedule = async () => {
    setBusy(true);
    try { await scheduleDebrief(plan.id, due ?? localToday(), postPhase); onApplied(); }
    finally { setBusy(false); setConfirming(false); }
  };

  if (existing) {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 flex items-center gap-3">
        <CalendarPlus className="w-5 h-5 text-emerald-700 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-[15px] font-medium text-emerald-900">Debrief scheduled{existing.dueDate ? ` · ${fmtShort(existing.dueDate)}` : ""}</p>
          <p className="text-[12px] text-emerald-700">In-app task — notes will sync into Reflection below once it's recorded.</p>
        </div>
      </div>
    );
  }
  // Quieter affordance for events we don't auto-offer (Internal / recurring community).
  const tone = autoWorthy ? "border-amber-200 bg-amber-50" : "border-gray-200 bg-gray-50";
  return (
    <div className={`rounded-xl border px-4 py-3 ${tone}`}>
      <div className="flex items-center gap-3">
        <CalendarPlus className={`w-5 h-5 shrink-0 ${autoWorthy ? "text-amber-700" : "text-gray-400"}`} />
        <div className="flex-1 min-w-0">
          <p className={`text-[15px] font-medium ${autoWorthy ? "text-amber-900" : "text-gray-700"}`}>{autoWorthy ? "Schedule a 30-min debrief" : "Add a debrief (optional)"}</p>
          <p className={`text-[12px] ${autoWorthy ? "text-amber-700" : "text-gray-500"}`}>
            {due ? `Day after · ${fmtShort(due)} at 10:00 AM` : "Day after the event"} · {invitees.length ? invitees.join(", ") : "owners"}
          </p>
        </div>
        {confirming ? (
          <span className="flex items-center gap-2 shrink-0">
            <button onClick={schedule} disabled={busy} className="px-3 py-1.5 rounded-lg bg-gray-900 text-white text-sm hover:bg-black disabled:opacity-50">{busy ? "Scheduling…" : "Confirm"}</button>
            <button onClick={() => setConfirming(false)} className="text-sm text-gray-500 hover:text-gray-800">Cancel</button>
          </span>
        ) : (
          <button onClick={() => setConfirming(true)} className="shrink-0 px-3 py-1.5 rounded-lg border border-gray-300 bg-white text-sm text-gray-700 hover:bg-gray-50">Schedule</button>
        )}
      </div>
      {confirming && <p className="text-[11px] text-gray-500 mt-2">Adds an in-app debrief task. (Live Google Calendar booking with invites isn't wired yet — it'll land on the task for now.)</p>}
    </div>
  );
}

function CloseItOut({ plan, onOpenDeliverable, onOpenPeople, onApplied }: { plan: EventPlanning; onOpenDeliverable: (id: string) => void; onOpenPeople: () => void; onApplied: () => void }) {
  const postDeliverables = plan.deliverables.filter((d) => stageOf(d) === "post");
  return (
    <section>
      <h3 className="text-lg font-medium mb-3">Close it out</h3>
      <div className="space-y-3">
        <DebriefCard plan={plan} onApplied={onApplied} />
        <div className="bg-white rounded-2xl border border-border p-5">
          <div className="flex items-center justify-between mb-2">
            <h4 className="font-medium">Post-event tasks</h4>
            <button onClick={onOpenPeople} className="text-[13px] text-gray-500 hover:text-gray-900 inline-flex items-center gap-1">Tag prospects <ChevronRight className="w-3.5 h-3.5" /></button>
          </div>
          <ul className="space-y-1 text-sm">
            {postDeliverables.length === 0 && <li className="text-gray-400">No post-event tasks.</li>}
            {postDeliverables.map((d) => (
              <li key={d.id}>
                <button onClick={() => onOpenDeliverable(d.id)} className="w-full text-left flex items-center gap-2 rounded-lg px-2 py-1.5 -mx-2 hover:bg-gray-50">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${d.status === "Done" ? "bg-green-500" : "bg-gray-300"}`} />
                  <span className={`flex-1 truncate ${d.status === "Done" ? "line-through text-gray-400" : ""}`}>{d.title}</span>
                  <ChevronRight className="w-3.5 h-3.5 text-gray-300" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

// Reflection: a DEBRIEF transcript → the debrief extractor → propose-then-confirm, routed by
// what a debrief actually produces. Lessons→template (via guardrails→settle), follow-ups→
// deliverables, outcome→verdict, actuals→budget, people→proposed tags in the People inbox.
type DebriefProposal = DebriefExtract & { peopleResult?: { proposed: number; unmatched: string[] } };
function ReflectionSection({ plan, onApplied, incoming }: { plan: EventPlanning; onApplied: () => void; incoming?: { text: string; nonce: number } | null }) {
  const debrief = plan.deliverables.find((d) => /debrief/i.test(d.title));
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [p, setP] = useState<DebriefProposal | null>(null);
  const [open, setOpen] = useState(false);
  const reflectionsRef = useRef<string[]>(plan.reflections);
  const notesFileRef = useRef<HTMLInputElement>(null);
  const postPhase = plan.phases[plan.phases.length - 1]?.name ?? "Wrap-up";
  const due = plan.date ? addDays(plan.date, 1) : null;

  const extract = async (override?: string) => {
    const t = (override ?? notes).trim();
    if (!t) return;
    setBusy(true); setErr(null);
    try {
      saveDebriefNotes(plan.id, t).catch(() => {}); // keep the raw transcript as event knowledge
      const d = await extractDebrief(t);
      // People go straight to the People confirm-inbox as PROPOSED tags (matched by name).
      const peopleResult = d.peopleTags.length ? await proposeTagsFromDebrief(plan.id, d.peopleTags).catch(() => ({ proposed: 0, unmatched: [] as string[] })) : { proposed: 0, unmatched: [] };
      setP({ ...d, peopleResult });
    } catch (e: any) { setErr(e?.message ?? String(e)); }
    finally { setBusy(false); }
  };

  // Material dropped anywhere on the post-event view arrives here as debrief notes → extract.
  useEffect(() => {
    if (!incoming?.text?.trim()) return;
    setNotes(incoming.text); setOpen(true);
    void extract(incoming.text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incoming?.nonce]);

  const dropLesson = (i: number) => setP((s) => (s ? { ...s, lessons: s.lessons.filter((_, j) => j !== i) } : s));
  const dropFollowUp = (i: number) => setP((s) => (s ? { ...s, followUps: s.followUps.filter((_, j) => j !== i) } : s));
  const dropActual = (i: number) => setP((s) => (s ? { ...s, actuals: s.actuals.filter((_, j) => j !== i) } : s));
  const clearOutcome = () => setP((s) => (s ? { ...s, outcome: { ...s.outcome, verdict: "" } } : s));

  // Lessons → event guardrails (carried to the TEMPLATE on settle). Prefer the prescribed change.
  const addLesson = async (i: number, text: string) => {
    reflectionsRef.current = [...reflectionsRef.current, text];
    await setEventReflections(plan.id, reflectionsRef.current).catch(() => {});
    dropLesson(i); onApplied();
  };
  const addFollowUp = async (i: number, action: string) => {
    await addDeliverable(plan.id, { title: action, phase: postPhase, ownerRole: null, dueDate: due, offsetStart: 1 }).catch(() => {});
    dropFollowUp(i); onApplied();
  };
  const addOutcome = async (verdict: string) => {
    await setEventVerdict(plan.id, verdict).catch(() => {});
    clearOutcome(); onApplied();
  };
  const addActual = async (i: number, line: string, amount: number | null) => {
    if (plan.budget?.id) await upsertBudgetLines(plan.budget.id, [{ label: line, amount }]).catch(() => {});
    dropActual(i); onApplied();
  };

  const ItemRow = ({ text, sub, route, onConfirm, onDismiss }: { text: string; sub?: string; route: string; onConfirm: () => void; onDismiss: () => void }) => (
    <li className="flex items-start gap-2 rounded-lg border border-gray-200 px-3 py-2">
      <span className="flex-1 min-w-0 text-sm text-gray-800">{text}{sub && <span className="block text-[12px] text-gray-500">{sub}</span>}<span className="ml-2 text-[11px] text-gray-400">→ {route}</span></span>
      <button onClick={onConfirm} className="shrink-0 text-emerald-600 hover:text-emerald-800" title="Confirm"><Check className="w-4 h-4" /></button>
      <button onClick={onDismiss} className="shrink-0 text-gray-300 hover:text-red-600" title="Dismiss"><X className="w-4 h-4" /></button>
    </li>
  );

  const count = p ? p.lessons.length + p.followUps.length + p.actuals.length + (p.outcome.verdict ? 1 : 0) : 0;
  const hasProposal = !!p && (count > 0 || (p.peopleResult?.proposed ?? 0) > 0);

  return (
    <section id="post-event-reflection" className="scroll-mt-24">
      <h3 className="text-lg font-medium mb-3">Post-event reflection</h3>
      <div className="bg-white rounded-2xl border border-border p-5 space-y-4">
        {/* waiting state */}
        {!hasProposal && (
          <div className="flex items-start gap-3">
            <Lightbulb className="w-5 h-5 text-gray-300 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              {debrief
                ? <p className="text-sm text-gray-600">Debrief scheduled{debrief.dueDate ? ` for ${fmtShort(debrief.dueDate)}` : ""} · its notes will sync here. <span className="text-gray-400">Drop a transcript anywhere on this page, or paste notes below.</span></p>
                : <p className="text-sm text-gray-600">No debrief scheduled. <span className="text-gray-400">Drop a transcript (.txt/.vtt) anywhere on this page, or paste notes below</span> — EventHub extracts learnings, follow-ups, outcome, actuals, and people.</p>}
              {plan.debriefNotes && <p className="text-[12px] text-gray-400 mt-1">Debrief notes saved as event knowledge.</p>}
            </div>
          </div>
        )}

        {/* manual notes input */}
        {!open && !hasProposal ? (
          <div className="flex items-center gap-3">
            <button onClick={() => setOpen(true)} className="text-sm text-gray-600 hover:text-gray-900 inline-flex items-center gap-1"><Plus className="w-4 h-4" /> Paste debrief notes</button>
            <button onClick={() => notesFileRef.current?.click()} className="text-sm text-gray-600 hover:text-gray-900 inline-flex items-center gap-1"><Paperclip className="w-4 h-4" /> Attach a transcript</button>
            <input ref={notesFileRef} type="file" hidden onChange={(e) => { const f = e.target.files?.[0]; e.currentTarget.value = ""; if (f) void f.text().then((t) => { setNotes(t); setOpen(true); void extract(t); }); }} />
          </div>
        ) : !hasProposal ? (
          <div className="space-y-2">
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={6} placeholder="Paste the debrief transcript or notes…" className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
            <div className="flex items-center gap-2">
              <button onClick={() => extract()} disabled={busy || !notes.trim()} className="px-3 py-1.5 rounded-lg bg-gray-900 text-white text-sm hover:bg-black disabled:opacity-50">{busy ? "Extracting…" : "Extract"}</button>
              <button onClick={() => { setOpen(false); setNotes(""); }} className="text-sm text-gray-500 hover:text-gray-800">Cancel</button>
              {err && <span className="text-sm text-red-600">{err}</span>}
            </div>
          </div>
        ) : null}

        {/* propose-then-confirm, by debrief route */}
        {p && hasProposal && (
          <div className="space-y-4">
            <p className="text-[13px] text-gray-500">From the debrief{p.focus !== "unclear" ? ` · read as ${p.focus}` : ""} — confirm what's real, dismiss the rest. Nothing's applied until you confirm.</p>
            {p.lessons.length > 0 && (
              <div><p className="text-[13px] font-medium text-gray-700 mb-1">Learnings → template</p><ul className="space-y-1.5">{p.lessons.map((l, i) => {
                const text = l.proposedChange || l.text;
                return <ItemRow key={i} text={text} sub={l.proposedChange && l.text !== l.proposedChange ? l.text : undefined} route={l.area || "template"} onConfirm={() => addLesson(i, text)} onDismiss={() => dropLesson(i)} />;
              })}</ul></div>
            )}
            {p.followUps.length > 0 && (
              <div><p className="text-[13px] font-medium text-gray-700 mb-1">Follow-ups → deliverables</p><ul className="space-y-1.5">{p.followUps.map((f, i) => <ItemRow key={i} text={f.action} sub={[f.owner, f.person].filter(Boolean).join(" · ") || undefined} route="deliverable" onConfirm={() => addFollowUp(i, f.action)} onDismiss={() => dropFollowUp(i)} />)}</ul></div>
            )}
            {p.outcome.verdict && (
              <div><p className="text-[13px] font-medium text-gray-700 mb-1">Outcome → verdict</p><ul className="space-y-1.5"><ItemRow text={p.outcome.verdict} sub={p.outcome.turnoutNote || undefined} route="event verdict" onConfirm={() => addOutcome(p.outcome.verdict)} onDismiss={clearOutcome} /></ul></div>
            )}
            {p.actuals.length > 0 && (
              <div><p className="text-[13px] font-medium text-gray-700 mb-1">Actuals → budget</p><ul className="space-y-1.5">{p.actuals.map((a, i) => <ItemRow key={i} text={`${a.line}${a.amount != null ? ` · ${money(a.amount)}` : ""}`} sub={a.note || undefined} route="budget line" onConfirm={() => addActual(i, a.line, a.amount)} onDismiss={() => dropActual(i)} />)}</ul></div>
            )}
            {(p.peopleResult?.proposed ?? 0) > 0 && (
              <p className="text-[13px] text-gray-600">{p.peopleResult!.proposed} {p.peopleResult!.proposed === 1 ? "person" : "people"} flagged → review in the <span className="font-medium">People</span> tagging inbox.{p.peopleResult!.unmatched.length ? ` (${p.peopleResult!.unmatched.length} name${p.peopleResult!.unmatched.length === 1 ? "" : "s"} not matched to an attendee)` : ""}</p>
            )}
            {p.peopleTags.length > 0 && (p.peopleResult?.proposed ?? 0) === 0 && (
              <p className="text-[13px] text-gray-400">{p.peopleTags.length} person mention{p.peopleTags.length === 1 ? "" : "s"} found, but none matched this event's attendees.</p>
            )}
            <button onClick={() => { setP(null); setNotes(""); setOpen(false); }} className="text-[13px] text-gray-500 hover:text-gray-800">Done</button>
          </div>
        )}
      </div>
    </section>
  );
}

// Two-step budget stepper: budget target (set directly in the Budget tab) → spend tracking.
function BudgetCard({ plan, onOpenBudget, onSetTarget }: { plan: EventPlanning; onOpenBudget: () => void; onSetTarget?: () => void }) {
  const lines = plan.budget?.lines ?? [];
  const committed = lines.filter((l) => l.status !== "estimate").reduce((s, l) => s + (l.confirmedAmount ?? 0), 0);
  const target = plan.eventBudgetTarget ?? plan.budget?.targetAmount ?? null;
  const pct = target ? Math.min(100, Math.round((committed / target) * 100)) : 0;
  const over = target != null && committed > target;

  return (
    <div className="bg-white rounded-2xl border border-border p-5">
      <div className="flex items-center justify-between gap-2 mb-3">
        <h3 className="font-medium">Budget</h3>
        <button onClick={onOpenBudget} className="text-[13px] text-gray-600 border border-gray-300 rounded-md px-1.5 py-0.5 hover:bg-gray-50">Budget tab</button>
      </div>
      {target == null ? (
        // No target yet → an amber nudge, same treatment as the setup fields; links to the Budget tab.
        // Once a target exists it tracks against it, and any budget captures from Slack land below.
        <button onClick={onSetTarget ?? onOpenBudget} className="group w-full flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-left hover:bg-amber-100 transition-colors">
          <DollarSign className="w-5 h-5 text-amber-700 shrink-0" />
          <span className="flex-1 min-w-0">
            <span className="block text-[15px] font-medium text-amber-900 group-hover:underline">Set a budget target</span>
            <span className="block text-[13px] text-amber-700">Then track spend against it here.</span>
          </span>
        </button>
      ) : (
        <div>
          <div className="h-2 bg-gray-100 rounded-full overflow-hidden"><div className={`h-full rounded-full transition-all ${over ? "bg-red-400/80" : "bg-gradient-to-r from-gray-400 to-gray-900"}`} style={{ width: `${pct}%` }} /></div>
          <p className={`text-[15px] mt-1.5 ${over ? "text-red-500" : "text-gray-500"}`}>{money(committed)} of {money(target)} {over ? `· ${money(committed - target)} over` : `· ${money(target - committed)} left`}</p>
        </div>
      )}
    </div>
  );
}

// Overview deliverables card: current-phase pill + done/total + progress + a "coming up" list.
// Coarse stage of a deliverable: before the event, day-of, or after — from its offset, with
// a phase-name fallback when there's no timing.
type Stage = "pre" | "during" | "post";
const STAGE_ORDER: Stage[] = ["pre", "during", "post"];
const STAGE_LABEL: Record<Stage, string> = { pre: "Pre-event", during: "Run of show", post: "Post-event" };
function stageOf(d: Deliverable): Stage {
  if (d.offsetStart != null) return d.offsetStart < 0 ? "pre" : d.offsetStart === 0 ? "during" : "post";
  const p = (d.phase ?? "").toLowerCase();
  if (/day[-\s]?of|run.?of.?show|\blive\b|event day/.test(p)) return "during";
  if (/wrap|post|after|thank|reflect|recap|mortem|measure|debrief/.test(p)) return "post";
  return "pre";
}

function OverviewDeliverables({ plan, onOpen }: { plan: EventPlanning; onOpen: (id: string) => void }) {
  const phases = enrichPhases({ phases: plan.phases, walkthrough: plan.walkthrough, deliverables: plan.deliverables }, DELIVERABLE_PHASES);
  const colorOf = new Map(phases.map((p) => [p.name, p.color]));
  const t = today();

  // Bucket into pre / run-of-show / post, then advance to the earliest stage with open work.
  const byStage: Record<Stage, Deliverable[]> = { pre: [], during: [], post: [] };
  for (const d of plan.deliverables) byStage[stageOf(d)].push(d);
  const stagesWithItems = STAGE_ORDER.filter((s) => byStage[s].length > 0);
  const current: Stage = STAGE_ORDER.find((s) => byStage[s].length > 0 && byStage[s].some((d) => d.status !== "Done"))
    ?? stagesWithItems[stagesWithItems.length - 1] ?? "pre";

  const items = byStage[current].slice().sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"));
  const done = items.filter((d) => d.status === "Done").length;
  const total = items.length;
  const pct = total ? Math.round((done / total) * 100) : 0;

  return (
    <div className="bg-white rounded-2xl border border-border p-5">
      <div className="flex items-center justify-between gap-2 mb-2">
        <h3 className="font-medium">Deliverables · <span className="text-gray-500">{STAGE_LABEL[current]}</span></h3>
        <p className={`text-sm ${pct >= 100 ? "text-green-600" : "text-gray-500"}`}>{done} of {total} done</p>
      </div>
      {/* Stage progression: completed stages checked, current emphasized. Click a stage (e.g.
          Run of show) to jump to that section in the Deliverables tab. */}
      <div className="flex items-center gap-1.5 text-[15px] mb-3">
        {STAGE_ORDER.map((s, i) => {
          const has = byStage[s].length > 0;
          const allDone = has && byStage[s].every((d) => d.status === "Done");
          const isCur = s === current;
          const firstId = byStage[s][0]?.id;
          return (
            <span key={s} className="inline-flex items-center gap-1.5">
              {i > 0 && <span className="text-gray-300">›</span>}
              <button
                type="button"
                disabled={!has}
                onClick={() => firstId && onOpen(firstId)}
                title={has ? `Go to ${STAGE_LABEL[s]} in Deliverables` : undefined}
                className={`inline-flex items-center gap-1 ${isCur ? "text-gray-900 font-medium" : allDone ? "text-green-600" : "text-gray-400"} ${has ? "cursor-pointer hover:underline" : "cursor-default"}`}
              >
                {allDone && !isCur && <Check className="w-3 h-3" />}{STAGE_LABEL[s]}
              </button>
            </span>
          );
        })}
      </div>
      <div className="h-2 bg-gray-100 rounded-full overflow-hidden mb-4"><div className={`h-full rounded-full transition-all ${pct >= 100 ? "bg-gradient-to-r from-green-400 to-green-600" : "bg-gradient-to-r from-gray-400 to-gray-900"}`} style={{ width: `${pct}%` }} /></div>
      <ul className="space-y-1 text-sm">
        {items.length === 0 && <li className="text-gray-400">Nothing in this stage.</li>}
        {items.map((d) => {
          const overdue = d.dueDate && d.dueDate < t && d.status !== "Done";
          const c = d.phase ? colorOf.get(d.phase) : undefined;
          const isDone = d.status === "Done";
          return (
            <li key={d.id}>
              <button onClick={() => onOpen(d.id)} className="w-full text-left flex items-center gap-2 rounded-lg px-2 py-1.5 -mx-2 hover:bg-gray-50 transition-colors">
                <span className={`w-2 h-2 rounded-full shrink-0 ${c ? c.dot : "bg-gray-300"}`} title={d.phase ?? "Unphased"} />
                <span className={`flex-1 min-w-0 truncate ${isDone ? "line-through text-gray-400" : "text-gray-900"}`}>{d.title}{d.phase && <span className="text-gray-400"> · {d.phase}</span>}</span>
                {d.ownerRole && <span className="text-[15px] text-gray-400 shrink-0 inline-flex items-center gap-1"><Users className="w-3 h-3" /> {d.ownerRole}</span>}
                <span className={`text-[15px] shrink-0 ${overdue ? "text-red-600 font-medium" : "text-gray-400"}`}>{isDone ? "done" : overdue ? "overdue" : d.dueDate ?? "—"}</span>
                <ChevronRight className="w-3.5 h-3.5 text-gray-300 shrink-0" />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ── Brief-sourced prose, now editable on the planning page ───────────────────
// Run-of-show: editable time + activity rows, persisted as a whole array on each change.
// Parse/format clock times ("6:00", "18:30") to/from minutes — for run-of-show retiming.
const parseClock = (s: string): number | null => { const m = s.match(/^\s*(\d{1,2}):(\d{2})\s*$/); return m ? +m[1] * 60 + +m[2] : null; };
const fmtClock = (mins: number): string => { const x = ((mins % 1440) + 1440) % 1440; return `${Math.floor(x / 60)}:${String(x % 60).padStart(2, "0")}`; };

function AgendaEditor({ eventId, initial }: { eventId: string; initial: RunOfShowItem[] }) {
  const [items, setItems] = useState<RunOfShowItem[]>(initial);
  const save = (next: RunOfShowItem[]) => { setItems(next); setEventAgenda(eventId, next).catch(() => {}); };
  const setRow = (i: number, patch: Partial<RunOfShowItem>) => save(items.map((a, j) => (j === i ? { ...a, ...patch } : a)));
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  // Run of show: dragging a row reorders it AND auto-adjusts its time to sit between its new
  // neighbors (this is the time-adjust behavior that does NOT apply to planning deliverables).
  const onDragEnd = (e: DragEndEvent) => {
    const from = Number(e.active.id), to = e.over ? Number(e.over.id) : from;
    if (Number.isNaN(to) || from === to) return;
    const next = arrayMove(items, from, to);
    const prev = next[to - 1] ? parseClock(next[to - 1].time) : null;
    const after = next[to + 1] ? parseClock(next[to + 1].time) : null;
    let t: string | null = null;
    if (prev != null && after != null) t = fmtClock(Math.round((prev + after) / 2));
    else if (prev != null) t = fmtClock(prev + 30);
    else if (after != null) t = fmtClock(after - 30);
    if (t != null) next[to] = { ...next[to], time: t };
    save(next);
  };
  return (
    <div className="bg-white rounded-2xl border border-border p-5">
      <h3 className="font-medium mb-3">Run of show</h3>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={items.map((_, i) => String(i))} strategy={verticalListSortingStrategy}>
          <div className="space-y-2">
            {items.length === 0 && <p className="text-sm text-gray-400">Nothing scheduled yet.</p>}
            {items.map((a, i) => (
              <SortableRow key={i} id={String(i)}>
                {({ setNodeRef, style, attributes, listeners, isDragging }) => (
                  <div ref={setNodeRef} style={style} className={`flex items-center gap-2 group ${isDragging ? "opacity-60" : ""}`}>
                    <button type="button" {...attributes} {...listeners} className="shrink-0 cursor-grab touch-none text-gray-300 hover:text-gray-500 active:cursor-grabbing" aria-label="Drag to reorder" title="Drag to reorder — retimes between neighbors"><GripVertical className="w-4 h-4" /></button>
                    <input value={a.time} onChange={(e) => setRow(i, { time: e.target.value })} placeholder="6:00" className="w-16 px-2 py-1 border border-gray-200 rounded text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-gray-300" />
                    <input value={a.title} onChange={(e) => setRow(i, { title: e.target.value })} placeholder="Activity" className="flex-1 px-2 py-1 border border-gray-200 rounded text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
                    <button onClick={() => save(items.filter((_, j) => j !== i))} className="text-gray-300 hover:text-red-600 opacity-0 group-hover:opacity-100" aria-label="Remove"><X className="w-3.5 h-3.5" /></button>
                  </div>
                )}
              </SortableRow>
            ))}
          </div>
        </SortableContext>
      </DndContext>
      <button onClick={() => save([...items, { time: "", title: "" }])} className="mt-3 text-[15px] text-gray-500 hover:text-gray-900 inline-flex items-center gap-1"><Plus className="w-3 h-3" /> Add row</button>
    </div>
  );
}

// Reusable string-list editor (chips for staffing, bullets for guardrails).
function StringListEditor({ title, initial, onSave, variant, addLabel, placeholder, empty }: { title: string; initial: string[]; onSave: (v: string[]) => void; variant: "chips" | "bullets"; addLabel: string; placeholder: string; empty: string }) {
  const [items, setItems] = useState<string[]>(initial);
  const [draft, setDraft] = useState("");
  const save = (next: string[]) => { setItems(next); onSave(next); };
  const add = () => { const t = draft.trim(); if (!t) return; save([...items, t]); setDraft(""); };
  return (
    <div className="bg-white rounded-2xl border border-border p-5 flex flex-col h-full">
      <h3 className="font-medium mb-3">{title}</h3>
      {items.length === 0 && <p className="text-sm text-gray-400 mb-2">{empty}</p>}
      {variant === "chips" ? (
        <div className="flex flex-wrap gap-2 mb-2">
          {items.map((r, i) => (
            <span key={i} className="inline-flex items-center gap-1 text-sm bg-gray-100 text-gray-700 rounded-full pl-2.5 pr-1.5 py-0.5"><Users className="w-3 h-3" /> {r}<button onClick={() => save(items.filter((_, j) => j !== i))} className="text-gray-400 hover:text-red-600" aria-label="Remove"><X className="w-3 h-3" /></button></span>
          ))}
        </div>
      ) : (
        <ul className="space-y-1.5 text-sm text-gray-600 mb-2">
          {items.map((r, i) => (
            <li key={i} className="flex items-start gap-2 group"><span className="text-gray-300 mt-0.5">•</span><span className="flex-1">{r}</span><button onClick={() => save(items.filter((_, j) => j !== i))} className="text-gray-300 hover:text-red-600 shrink-0 opacity-0 group-hover:opacity-100" aria-label="Remove"><X className="w-3.5 h-3.5" /></button></li>
          ))}
        </ul>
      )}
      {/* Growing spacer: when the card is stretched (e.g. Guardrails matching the left column),
          the extra height lands here, between the list and the add-field. Collapses to 0 otherwise. */}
      <div className="flex-1 min-h-0" />
      <div className="flex items-center gap-2">
        <input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add(); }} placeholder={placeholder} className="flex-1 px-2 py-1 border border-gray-200 rounded text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
        <button onClick={add} disabled={!draft.trim()} className="text-[15px] text-gray-500 hover:text-gray-900 disabled:opacity-40 inline-flex items-center gap-1"><Plus className="w-3 h-3" /> {addLabel}</button>
      </div>
    </div>
  );
}

// ── Resources (reference links) ──────────────────────────────────────────────
// Open-only: Google Docs / Sheets / Drive folders. Never processed or ingested.
function ResourcesSection({ links, eventId, setPlan }: { links: ReferenceLink[]; eventId: string; setPlan: React.Dispatch<React.SetStateAction<EventPlanning | null>> }) {
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [err, setErr] = useState<string | null>(null);

  // A Drive/SharePoint folder link is a folder; everything else is a plain link. No manual toggle.
  const looksLikeFolder = (u: string) => /\/(drive\/)?folders?\//i.test(u) || /sharepoint\.com\/.*\/Forms\//i.test(u);

  const persist = async (next: ReferenceLink[]) => {
    await setEventReferenceLinks(eventId, next);
    setPlan((p) => (p ? { ...p, referenceLinks: next } : p));
  };

  const add = async () => {
    const u = url.trim();
    const l = label.trim();
    if (!l) { setErr("Label is required."); return; }
    if (!u.startsWith("http")) { setErr("URL must start with http."); return; }
    setErr(null);
    const id = "rl-" + (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));
    const next: ReferenceLink[] = [...links, { id, label: l, url: u, kind: looksLikeFolder(u) ? "folder" : "link" }];
    await persist(next);
    setLabel(""); setUrl("");
  };

  const remove = async (id: string) => {
    await persist(links.filter((l) => l.id !== id));
  };

  const hostOf = (u: string) => { try { return new URL(u).hostname; } catch { return u; } };

  return (
    <div className="bg-white rounded-2xl border border-border p-5">
      <h3 className="font-medium mb-3">Resources</h3>
      {links.length === 0 ? (
        <p className="text-sm text-gray-400 mb-4">No linked resources yet — add a Google Doc, sheet, or folder.</p>
      ) : (
        <ul className="space-y-2 mb-4">
          {links.map((rl) => (
            <li key={rl.id} className="flex items-center gap-3 group">
              <span className="shrink-0 text-gray-400">
                {rl.kind === "folder" ? <Folder className="w-4 h-4" /> : <Link2 className="w-4 h-4" />}
              </span>
              <div className="min-w-0 flex-1">
                <a href={rl.url} target="_blank" rel="noreferrer" className="text-sm font-medium text-blue-600 hover:underline truncate block">{rl.label}</a>
                <span className="text-xs text-gray-400 truncate block">{hostOf(rl.url)}</span>
              </div>
              <button onClick={() => remove(rl.id)} className="shrink-0 text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity" aria-label="Remove">
                <X className="w-3.5 h-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Label"
          className="border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm w-36 focus:outline-none focus:ring-1 focus:ring-gray-400"
        />
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://…"
          className="border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm w-56 focus:outline-none focus:ring-1 focus:ring-gray-400"
          onKeyDown={(e) => { if (e.key === "Enter") { void add(); } }}
        />
        <button
          onClick={() => { void add(); }}
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-gray-900 text-white text-sm hover:bg-gray-700"
        >
          <Plus className="w-3.5 h-3.5" /> Add
        </button>
      </div>
      {err && <p className="text-xs text-red-500 mt-1.5">{err}</p>}
    </div>
  );
}

type GCalMatchCandidate = { gcalEventId: string; summary: string; start: string; htmlLink: string };

function GCalMatchConfirmCard({ eventId, candidates, onResolved }: { eventId: string; candidates: [string, GCalMatchCandidate][]; onResolved: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const resolve = async (decision: 'link' | 'create') => {
    setBusy(true); setErr(null);
    try {
      await resolveGcalMatch(eventId, decision);
      onResolved();
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3">
      <div className="flex items-start gap-3">
        <Calendar className="w-5 h-5 text-blue-700 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-[15px] font-medium text-blue-900">Found a matching calendar event</p>
          <p className="text-[13px] text-blue-700 mt-0.5">A similar event already exists on your Google Calendar. Link to it or create a separate one.</p>
          <ul className="mt-2 space-y-1">
            {candidates.map(([, c]) => (
              <li key={c.gcalEventId} className="text-[13px] text-blue-800">
                <a href={c.htmlLink} target="_blank" rel="noreferrer" className="font-medium underline underline-offset-2 hover:text-blue-900">{c.summary}</a>
                <span className="text-blue-600 ml-1">— {new Date(c.start).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
              </li>
            ))}
          </ul>
          {err && <p className="text-[13px] text-red-600 mt-2">{err}</p>}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button size="sm" variant="secondary" onClick={() => void resolve('link')} disabled={busy}>
            {busy ? "Working…" : "Link to it"}
          </Button>
          <Button size="sm" onClick={() => void resolve('create')} disabled={busy}>
            Create new
          </Button>
        </div>
      </div>
    </div>
  );
}

function Overview({ plan, eventId, onApplied, onOpenBudget, onOpenTimeline, onOpenDeliverable, onOpenPeople, onOpenEvent, reflectionJump, reopened = false, setPlan }: { plan: EventPlanning; eventId: string; onApplied: () => void; onOpenBudget: () => void; onOpenTimeline: () => void; onOpenDeliverable: (id: string) => void; onOpenPeople: () => void; onOpenEvent?: (id: string) => void; reflectionJump?: number; reopened?: boolean; setPlan: React.Dispatch<React.SetStateAction<EventPlanning | null>> }) {
  const facts = buildFacts(plan);
  // Phase-aware view: the timeline's date-derived "now" sets the default; clicking a node
  // previews another phase's view (Overview-internal state, not tab navigation).
  const { markers, currentKey } = deriveMarkers(plan);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  // Jump to the post-event reflection (e.g. from the "Post-event reflections & insights"
  // deliverable): force the post view, then scroll to the reflection section once it mounts.
  useEffect(() => {
    if (!reflectionJump) return;
    const postKey = markers.find((m) => m.view === "post")?.key;
    if (postKey) setSelectedKey(postKey);
    const t = setTimeout(() => document.getElementById("post-event-reflection")?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reflectionJump]);
  const selKey = selectedKey ?? currentKey;
  const selIdx = markers.findIndex((m) => m.key === selKey);
  const curIdx = markers.findIndex((m) => m.key === currentKey);
  const selectedView: ViewMode = markers[selIdx]?.view ?? "planning";
  const temporal: "past" | "current" | "future" = selIdx === curIdx ? "current" : selIdx > curIdx ? "future" : "past";
  // A settled event is LOCKED: the timeline becomes a static record and the body collapses to a
  // read-only rundown — no moving between phases.
  // A settled event is read-only — UNLESS its workspace was reopened, which restores the live,
  // click-through timeline + phase-aware body (as with an active event).
  const locked = plan.settleState === "settled" && !reopened;
  // Use the cached digest; only regenerate on Resync (which also pulls Gmail).
  const [summary, setSummary] = useState<string | null>(plan.overviewSummary);
  const [resyncing, setResyncing] = useState(false);
  const [resyncMsg, setResyncMsg] = useState<string | null>(null);


  const resync = async () => {
    setResyncing(true); setResyncMsg(null);
    try {
      let synced = 0;
      try { const r = await syncGmail(eventId); synced = r.recorded; } catch { /* sync optional */ }
      const s = await getPlanningSummary(buildFacts(plan));
      await saveOverviewSummary(eventId, s);
      setSummary(s);
      setResyncMsg(`Regenerated${synced ? ` · ${synced} new email${synced === 1 ? "" : "s"}` : ""}.`);
      onApplied();
    } catch (e: any) { setResyncMsg(e?.message ?? String(e)); }
    finally { setResyncing(false); }
  };

  // Status digest is stored as one fact per line → render as bullets when present.
  const summaryBullets = (summary ?? "").split("\n").map((l) => l.replace(/^[\s•\-*]+/, "").trim()).filter(Boolean);
  // Synthesized one-liner used when there's no Claude digest yet (never a blank empty state).
  const synth: string[] = [plan.macroStage ?? "Planning"];
  if (facts.daysOut != null) synth.push(facts.daysOut > 0 ? `${facts.daysOut}d to event` : facts.daysOut === 0 ? "event today" : `${-facts.daysOut}d ago`);
  if (plan.eventBudgetTarget != null) synth.push(`${money(plan.eventBudgetTarget)} budget`);
  synth.push(`${facts.deliverables.done}/${facts.deliverables.total} deliverables`);
  if (plan.staffRoles.length) synth.push(`${plan.staffRoles.length} open role${plan.staffRoles.length === 1 ? "" : "s"}`);
  const synthDigest = synth.join(" · ");

  // Past by DATE (not phase-navigation temporal): a done event should read as a record to complete,
  // not an active plan — so it gets the completeness panel instead of the active-planning prompts.
  const pastByDate = !!plan.date && plan.date < new Date().toISOString().slice(0, 10);

  const tgt = plan.eventBudgetTarget ?? facts.budget?.target ?? null;
  void onOpenEvent; // retired with the carried-learnings card; prop kept for the caller.

  const gcalMatchCandidates = plan.gcalMatchPending
    ? Object.entries(plan.gcalMatchPending).filter((e): e is [string, { gcalEventId: string; summary: string; start: string; htmlLink: string }] => e[1] !== null)
    : [];

  // ── Slack captures ─────────────────────────────────────────────────────────
  // Pins land in the ledger as `proposed`; the composed Overview surfaces them per home
  // (open → Open·next-up, budget → Budget, person → Staffing) as engageable violet cards.
  const [captures, setCaptures] = useState<SlackCapture[]>([]);
  const reloadCaptures = () => { void listSlackCaptures(eventId).then(setCaptures); };
  useEffect(() => {
    void loadAndAutoApply();                                      // show + auto-apply already-stored captures
    // then pull new; only re-run the apply pass if the scrape actually stored/changed something
    void runSlackScrape(eventId).then((r) => { if (r?.ok && ((r.stored ?? 0) + (r.dismissed ?? 0) > 0)) void loadAndAutoApply(); }).catch(() => {});
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [eventId]);
  // Captures arrive in Slack while this page may already be open — there's no realtime channel, so
  // re-run the load+apply pass on focus and a slow poll, so a new fact appears (applied) without a reload.
  useEffect(() => {
    const refresh = () => { if (!document.hidden) void loadAndAutoApply(); };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    const iv = setInterval(refresh, 20000);
    return () => { window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); clearInterval(iv); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);
  const capByHome = (h: CaptureHome) => captures.filter((c) => c.home === h);

  // A budget capture that matches an existing line is ambiguous — replace the figure, add on top, or
  // keep separate? Rather than guess, we flag it and let the user choose (see the modal below).
  type BudgetChoice = { capture: SlackCapture; amount: number | null; status: BudgetStatus; match: BudgetLineTracker };
  const [budgetChoice, setBudgetChoice] = useState<BudgetChoice | null>(null);
  const [acceptQueue, setAcceptQueue] = useState<BudgetChoice[]>([]); // remaining prompts during Accept-all

  const budgetParams = (c: SlackCapture) => {
    const text = `${c.summary} ${c.detail ?? ""} ${c.sourceQuote ?? ""}`;
    return { amount: parseMoney(c.detail) ?? parseMoney(c.summary) ?? parseMoney(c.sourceQuote), status: parseBudgetStatus(text) };
  };

  // Promote a capture into its home's record, then mark it confirmed. Returns a BudgetChoice (does
  // NOT settle) when a budget capture matches an existing line — the caller decides how to prompt.
  const promoteCapture = async (c: SlackCapture): Promise<BudgetChoice | null> => {
    if (c.home === "budget") {
      const { amount, status } = budgetParams(c);
      const match = await findBudgetLineMatch(eventId, c.summary);
      if (match) return { capture: c, amount, status, match };
      await insertBudgetLine(eventId, c.summary, amount, status);
    } else if (c.home === "person") {
      const { name, role } = parsePersonRole(c.summary);
      if (!plan.staffRoles.includes(role)) await setEventStaffRoles(eventId, [...plan.staffRoles, role]);
      if (name) await setRoleAssignments(eventId, { ...(plan.roleAssignments ?? {}), [role]: name });
    }
    // Vendors are no longer a capture home — a cost capture is home 'budget' and lands as a budget
    // row above (loose line); the user can tag its optional vendor in place afterward.
    await confirmSlackCapture(c.id);
    return null;
  };

  // Single confirm from a card. Budget match → raise the merge modal; otherwise settle.
  const promoteAndConfirm = async (c: SlackCapture) => {
    const choice = await promoteCapture(c);
    if (choice) { setBudgetChoice(choice); return; }
    reloadCaptures();
    onApplied();
  };

  // ── Live-but-labeled: captures apply on arrival instead of waiting for a confirm click. Only the
  // "super unclear" ones stay a Confirm card — the AI flagged ambiguity, or a budget figure that
  // collides with an existing line (that Replace/Add/Separate call is genuinely the user's). Applied
  // captures stay visible, flagged, offering Undo (reverse) / Edit / Move / dismiss (keep, clear card).
  const capApplied = (c: SlackCapture) => !!(c.flags as any)?.applied;
  const capHeld = (c: SlackCapture) => !!(c.flags as any)?.ambiguity || !!(c.flags as any)?.conflict;

  // Apply one budget/plan/open capture (person is batched in loadAndAutoApply). Returns false when it
  // must stay held (budget figure collides with an existing line at a *different* amount → user merges).
  const applyCapture = async (c: SlackCapture): Promise<boolean> => {
    let undo: Record<string, unknown> = { kind: c.home };
    if (c.home === "budget") {
      const { amount, status } = budgetParams(c);
      const match = await findBudgetLineMatch(eventId, c.summary);
      if (match) {
        // Already on the event. Same/absent figure → don't duplicate; just pin the Slack link on the
        // existing line and clear the card. A *different* figure is genuinely new → hold for the merge.
        const sameFigure = amount == null || amount === match.confirmedAmount;
        if (!sameFigure) return false;
        if (c.sourceRef) await setBudgetLineSlackRef(match.id, c.sourceRef);
        await dismissSlackCapture(c.id);
        return true;
      }
      const lineId = await insertBudgetLine(eventId, c.summary, amount, status);
      if (c.sourceRef) await setBudgetLineSlackRef(lineId, c.sourceRef);
      undo = { kind: "budget", lineId };
    }
    await setCaptureFlags(c.id, { ...c.flags, applied: true, undo });
    return true;
  };

  // Load captures and auto-apply any that just arrived (not yet applied, not held). Person captures
  // share the staff-roles array (setEventStaffRoles overwrites), so they're resolved as one batch.
  // Serialized by applyingRef: overlapping triggers (mount + scrape + focus/poll) would otherwise each
  // read a capture as un-applied before flags.applied persists and double-apply it (e.g. two budget
  // lines). Concurrent calls set rerunRef so a final pass runs once after the in-flight one finishes.
  const applyingRef = useRef(false);
  const rerunRef = useRef(false);
  const loadAndAutoApply = async (): Promise<void> => {
    if (applyingRef.current) { rerunRef.current = true; return; }
    applyingRef.current = true;
    try {
      await runAutoApplyPass();
    } finally {
      applyingRef.current = false;
      if (rerunRef.current) { rerunRef.current = false; await loadAndAutoApply(); }
    }
  };
  const runAutoApplyPass = async () => {
    const caps = await listSlackCaptures(eventId);
    const pending = caps.filter((c) => !capApplied(c) && !capHeld(c));
    if (pending.length === 0) { setCaptures(caps); return; }

    const persons = pending.filter((c) => c.home === "person");
    if (persons.length) {
      const roles = [...plan.staffRoles];
      const assigns = { ...(plan.roleAssignments ?? {}) };
      const refs = { ...(plan.roleSlackRefs ?? {}) };
      for (const c of persons) {
        const { name, role } = parsePersonRole(c.summary);
        if (roles.includes(role)) {
          // Role already on the event (pre-existing or added earlier this pass) → don't duplicate;
          // pin the Slack link on the role and clear the card. Don't overwrite the existing assignment.
          if (c.sourceRef && !refs[role]) refs[role] = c.sourceRef;
          await dismissSlackCapture(c.id);
        } else {
          roles.push(role);
          if (name) assigns[role] = name;
          if (c.sourceRef) refs[role] = c.sourceRef;
          await setCaptureFlags(c.id, { ...c.flags, applied: true, undo: { kind: "person", role, roleWasNew: true, hadAssignment: false, prevName: null } });
        }
      }
      await setEventStaffRoles(eventId, roles);
      await setRoleAssignments(eventId, assigns);
      await setEventRoleSlackRefs(eventId, refs);
    }
    for (const c of pending.filter((c) => c.home !== "person")) await applyCapture(c);

    setCaptures(await listSlackCaptures(eventId));
    onApplied();
  };

  // Fix a misclassified capture's lane (e.g. a vendor read as a person) before it's settled.
  const reclassifyCapture = async (c: SlackCapture, home: CaptureHome) => {
    await setCaptureHome(c.id, home);
    reloadCaptures();
  };

  // Keep = clear the card, keep what it applied. Discard = reverse what it applied, then remove.
  const keepCapture = async (c: SlackCapture) => { await dismissSlackCapture(c.id); reloadCaptures(); onApplied(); };
  const discardCaptureEvt = async (c: SlackCapture) => { await discardCapture({ id: c.id, eventId, undo: (c.flags as any)?.undo ?? null }); reloadCaptures(); onApplied(); };
  const editCaptureEvt = async (c: SlackCapture, summary: string, detail: string | null) => { await editSlackCapture(c.id, { summary, detail }); reloadCaptures(); };
  // Selection for the From-Slack panel (mirrors the series).
  const [capSel, setCapSel] = useState<Set<string>>(new Set());
  const toggleCapSel = (id: string) => setCapSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const bulkKeepCaps = async () => { for (const id of capSel) { const c = captures.find((x) => x.id === id); if (c) await dismissSlackCapture(c.id); } setCapSel(new Set()); reloadCaptures(); onApplied(); };
  const bulkDiscardCaps = async () => { for (const id of capSel) { const c = captures.find((x) => x.id === id); if (c) await discardCapture({ id: c.id, eventId, undo: (c.flags as any)?.undo ?? null }); } setCapSel(new Set()); reloadCaptures(); onApplied(); };
  // A capture → the shared card model (badge = applied, warning = held reason).
  const captureModel = (c: SlackCapture): SlackCardModel => ({
    id: c.id, home: c.home, summary: c.summary, detail: c.detail, sourceRef: c.sourceRef,
    badge: capApplied(c) ? <span className="text-[10px] text-emerald-700">✓ added</span> : undefined,
    warning: capHeld(c) ? (((c.flags as any)?.ambiguity as string) ?? `conflicts with the set ${(c.flags as any)?.conflict?.field ?? "value"} — won't overwrite`) : null,
  });
  const capCard = (c: SlackCapture) => (
    <SlackCard
      model={captureModel(c)} tone={capApplied(c) ? "emerald" : "violet"}
      selected={capSel.has(c.id)} onToggleSelect={() => toggleCapSel(c.id)}
      onKeep={() => keepCapture(c)} onDiscard={() => discardCaptureEvt(c)}
      onEdit={(s, d) => editCaptureEvt(c, s, d)} onMove={(h) => reclassifyCapture(c, h)}
      onResolve={capHeld(c) ? () => promoteAndConfirm(c) : undefined}
    />
  );
  const capturesPanel = (
    <SlackCaptureList
      models={captures.map(captureModel)} selected={capSel}
      onToggleAll={(on) => setCapSel(on ? new Set(captures.map((c) => c.id)) : new Set())}
      onBulkKeep={bulkKeepCaps} onBulkDiscard={bulkDiscardCaps}
      card={(m) => { const c = captures.find((x) => x.id === m.id); return c ? capCard(c) : null; }}
    />
  );

  // Resolve the merge flag, then advance the Accept-all queue if one is running.
  const resolveBudgetChoice = async (mode: "replace" | "add" | "separate") => {
    if (!budgetChoice) return;
    const { capture, amount, status, match } = budgetChoice;
    if (mode === "separate") {
      await insertBudgetLine(eventId, capture.summary, amount, status);
    } else {
      const nextAmount = mode === "add" ? (match.confirmedAmount ?? 0) + (amount ?? 0) : amount;
      await setBudgetLineAmountStatus(match.id, nextAmount, maxBudgetStatus(status, match.status));
    }
    await confirmSlackCapture(capture.id);
    const [next, ...rest] = acceptQueue;
    setBudgetChoice(next ?? null);
    setAcceptQueue(rest);
    reloadCaptures();
    onApplied();
  };

  // The active planning home gets the composed layout; the phase views keep the classic body.
  const planningActive = !locked && selectedView === "planning";

  // Setup-nudge navigation, shared by the classic amber cards (phase views) and the new
  // Open·next-up "Setup" group (planning view).
  const highlightField = (id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    // Use inline styles, NOT added classes: when the target's tab finishes loading it re-renders and
    // React resets className from JSX (wiping ring-* classes → the highlight flashes and vanishes).
    // React doesn't manage this element's `style`, so an inline outline lingers until the click-away.
    el.style.outline = "2px solid rgb(252 211 77)"; // amber-300
    el.style.outlineOffset = "2px";
    el.style.borderRadius = "6px";
    const clear = () => { el.style.outline = ""; el.style.outlineOffset = ""; el.style.borderRadius = ""; };
    setTimeout(() => document.addEventListener("mousedown", clear, { once: true }), 0);
  };
  // Always ring the budget target field once the Budget tab has mounted it — poll for the element so
  // it works regardless of whether past-event comparables/projections are present.
  const reviewBudgetField = () => {
    let tries = 0;
    const tick = () => {
      if (document.getElementById("budget-target-field")) { highlightField("budget-target-field"); return; }
      if (tries++ < 20) setTimeout(tick, 100);
    };
    setTimeout(tick, 120);
  };
  const settleSetup = (key: SetupFlagKey) => {
    setPlan((p) => {
      if (!p) return p;
      const next = [...p.setupProgress, key];
      void saveSetupState(eventId, next, p.setupComplete);
      return { ...p, setupProgress: next };
    });
  };
  const SETUP_META: Record<SetupFlagKey, { title: string; blurb: string; Icon: typeof Calendar; go: () => void }> = {
    date: { title: "Set the event date", blurb: "Unlocks scheduling and deliverable due-dates.", Icon: Calendar, go: () => highlightField("hlf-date") },
    headcount: { title: "Add expected headcount", blurb: "Sizes budget and logistics.", Icon: Users, go: () => highlightField("hlf-headcount") },
    owners: { title: "Add owners", blurb: "Give this event a co-owner.", Icon: UserPlus, go: () => highlightField("hlf-owners") },
    budget: { title: "Review budget targets", blurb: "Set targets from comparable past events.", Icon: DollarSign, go: () => { onOpenBudget(); reviewBudgetField(); } },
    timeline: { title: "Check timeline", blurb: "Add dated deliverables.", Icon: ClipboardList, go: onOpenTimeline },
  };
  // Resolve a completeness gap by jumping to where it's entered manually. Returns false when this
  // view has no manual editor for the field (outcome / run-of-show / vendors / roles) — the panel
  // then falls back to its doc drop/picker so the gap can still be filled from a document.
  const resolveGap = (key: string): boolean => {
    switch (key) {
      case "date": highlightField("hlf-date"); return true;
      case "location": highlightField("hlf-location"); return true;
      case "turnout": onOpenPeople(); return true;
      case "budget": onOpenBudget(); return true;
      default: return false;
    }
  };
  const openFlags = visibleFlags(plan);
  // "Anything open" = a setup gap OR any proposed Slack capture (the Open card hosts the From-Slack
  // inbox of all captures). Drives the top-slot choice.
  const anythingOpen = openFlags.length > 0 || captures.length > 0;
  const [linBusy, setLinBusy] = useState(false);
  const createLinear = async () => { setLinBusy(true); try { await syncEventToLinear(eventId); onApplied(); } finally { setLinBusy(false); } };
  // "Create a project in Linear" as an open item (shown until linked) — matches the setup-flag cards.
  const linearOpenItem = !plan.linearProjectId ? (
    <div className="flex items-center gap-1 rounded-xl border border-amber-200 bg-amber-50 pr-2">
      <button onClick={createLinear} disabled={linBusy} className="group flex-1 min-w-0 flex items-center gap-3 rounded-xl px-4 py-3 text-left hover:bg-amber-100 transition-colors disabled:opacity-60">
        {linBusy ? <Loader2 className="w-5 h-5 text-amber-700 shrink-0 animate-spin" /> : <Activity className="w-5 h-5 text-amber-700 shrink-0" />}
        <span className="flex-1 min-w-0">
          <span className="block text-[15px] font-medium text-amber-900 group-hover:underline">Create a project in Linear</span>
          <span className="block text-[13px] text-amber-700">Adds a project in the EventHub Linear team, one issue per deliverable.</span>
        </span>
      </button>
    </div>
  ) : null;

  return (
    <div className="space-y-6">
      {/* Budget merge flag: a capture whose label matches an existing line — replace / add / separate. */}
      {budgetChoice && (() => {
        const { capture, amount, status, match } = budgetChoice;
        const newLabel = `${amount != null ? money(amount) : "no amount"} ${BUDGET_STATUS_META[status].label.toLowerCase()}`;
        const cur = `${match.confirmedAmount != null ? money(match.confirmedAmount) : "no amount"} ${BUDGET_STATUS_META[match.status].label.toLowerCase()}`;
        const sum = (match.confirmedAmount ?? 0) + (amount ?? 0);
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={() => setBudgetChoice(null)}>
            <div className="bg-white rounded-2xl border border-border shadow-xl max-w-md w-full p-5" onClick={(e) => e.stopPropagation()}>
              <h3 className="font-medium mb-1">Same budget line?</h3>
              <p className="text-[13px] text-gray-600 mb-4">The capture <b>“{capture.summary}”</b> ({newLabel}) matches an existing line <b>“{match.label}”</b> ({cur}).</p>
              <div className="space-y-2">
                <button onClick={() => void resolveBudgetChoice("replace")} className="w-full text-left rounded-lg border border-violet-300 bg-violet-50 px-3 py-2.5 hover:bg-violet-100">
                  <span className="block text-[14px] font-medium text-violet-900">Replace the figure → {amount != null ? money(amount) : "—"}</span>
                  <span className="block text-[12px] text-violet-700">The new number supersedes the old (a quote became the final).</span>
                </button>
                <button onClick={() => void resolveBudgetChoice("add")} className="w-full text-left rounded-lg border border-gray-200 px-3 py-2.5 hover:bg-gray-50">
                  <span className="block text-[14px] font-medium text-gray-900">Add on top → {money(sum)}</span>
                  <span className="block text-[12px] text-gray-500">An additional cost on the same line.</span>
                </button>
                <button onClick={() => void resolveBudgetChoice("separate")} className="w-full text-left rounded-lg border border-gray-200 px-3 py-2.5 hover:bg-gray-50">
                  <span className="block text-[14px] font-medium text-gray-900">Keep as a separate line</span>
                  <span className="block text-[12px] text-gray-500">A different item that just has a similar name.</span>
                </button>
              </div>
              <button onClick={() => setBudgetChoice(null)} className="mt-3 text-[13px] text-gray-400 hover:text-gray-600">Cancel</button>
            </div>
          </div>
        );
      })()}

      {/* Match-confirmation card: shown when a similar Google Calendar event was found and needs the
          user to decide whether to link to it or create a fresh one. */}
      {gcalMatchCandidates.length > 0 && (
        <GCalMatchConfirmCard eventId={eventId} candidates={gcalMatchCandidates} onResolved={onApplied} />
      )}

      {/* Past or locked → "what would make this a complete record" (+ drop-to-fill), so any
          done event can be finished into a complete record. Upcoming → the GCal prompt. */}
      {(locked || temporal === "past" || pastByDate) ? (
        // "Complete record" is a post-phase concern — only in the Post view (not planning / day-of).
        selectedView === "post" ? <CompletenessPanel plan={plan} eventId={eventId} onApplied={onApplied} onResolveGap={resolveGap} /> : null
      ) : (
        // Always mount GCalSync in the active planning view — it self-hides (returns null) when
        // there's nothing left to sync, but staying mounted lets the post-sync "Added ✓ / synced ✓"
        // confirmation (this-session only, gone on reload) show even after the LAST integration.
        <GCalSync
          eventId={eventId}
          synced={!!plan.gcalEventId}
          htmlLink={plan.gcalHtmlLink}
          gcalAvailable={!!plan.date}
          matchPending={plan.gcalMatchPending}
          variant="action"
          onSynced={onApplied}
          linearSynced={!!plan.linearProjectId}
          linearProjectUrl={plan.linearProjectUrl}
          onLinearSynced={onApplied}
          showLinear={false}
        />
      )}

      {/* Timeline first, then open-items + status below it — the SAME relative order as the planning
          view (which folds the flags into "Open · next up" beneath the timeline). Keeps the layout
          consistent across planning / day-of / post instead of flags jumping above the timeline. */}
      <OverviewTimeline markers={markers} currentKey={currentKey} selectedKey={selKey} onSelect={setSelectedKey} locked={locked} />

      {/* Calendar meetings related to this event — self-hides when there are none. */}
      <div className="mt-4"><UpcomingMeetings eventId={eventId} /></div>

      {/* Day-of / day-before views surface the SAME "Open" card as the planning view (setup fields +
          captured proposals), so the yellow bars group under "Open" consistently. Post drops them —
          its "complete record" gap blocks are the open items there. OpenNextUp self-hides when empty. */}
      {!planningActive && selectedView !== "post" && (
        <>
          <OpenNextUp setupFlags={openFlags} setupMeta={SETUP_META} onDismissSetup={settleSetup} capturesCount={captures.length} capturesPanel={capturesPanel} />
          {linearOpenItem}
        </>
      )}

      {/* "Where things stand" — shown in EVERY non-planning phase view too (day-before / day-of /
          post), identical to the planning view's card, so the status section is consistent across
          all phases (was a different classic one-liner block before). */}
      {!planningActive && (
        <WhereThingsStand bullets={summaryBullets} fallback={synthDigest} onRefresh={resync} refreshing={resyncing} note={resyncMsg} />
      )}

      {/* Locked → read-only rundown; otherwise the phase-aware body the selected node chooses. */}
      {locked ? (
        <LockedRundown plan={plan} assignedTarget={tgt} onOpenPeople={onOpenPeople} onOpenBudget={onOpenBudget} onApplied={onApplied} onFocusChange={(f) => setPlan((p) => (p ? { ...p, focusOverride: f } : p))} />
      ) : selectedView === "day-before" ? (
        <DayBeforeView plan={plan} temporal={temporal} />
      ) : selectedView === "day-of" ? (
        <DayOfView plan={plan} temporal={temporal} />
      ) : selectedView === "post" ? (
        <PostEventView plan={plan} temporal={temporal} onOpenDeliverable={onOpenDeliverable} onOpenPeople={onOpenPeople} assignedTarget={tgt} onApplied={onApplied} onFocusChange={(f) => setPlan((p) => (p ? { ...p, focusOverride: f } : p))} />
      ) : (
        // PLANNING view — composed Overview: Open·next-up ⇄ Where-things-stand, then Budget|Staffing,
        // then Learnings. Cut vs. the old stack: deliverables preview, at-a-glance, Linear box,
        // auto-updates, carried-learnings card (compounding now permeates the state cards inline).
        <div className="space-y-6">
          {/* Stable order: Open·next-up (when present) always above Where-things-stand.
              Open is conditionally rendered; Where-things-stand is always shown below it. */}
          {anythingOpen && (
            <OpenNextUp setupFlags={openFlags} setupMeta={SETUP_META} onDismissSetup={settleSetup} capturesCount={captures.length} capturesPanel={capturesPanel} />
          )}

          {linearOpenItem}

          <WhereThingsStand bullets={summaryBullets} fallback={synthDigest} onRefresh={resync} refreshing={resyncing} note={resyncMsg} />

          {/* Budget | Staffing — the two current-state cards, side by side. Each carries its own
              proposed Slack captures (budget / person) as engageable violet cards. */}
          <div className="grid grid-cols-2 gap-6 items-start">
            <div id="ov-budget" className="space-y-3 min-w-0 rounded-2xl">
              <BudgetCard plan={plan} onOpenBudget={onOpenBudget} onSetTarget={() => { onOpenBudget(); reviewBudgetField(); }} />
              {capByHome("budget").map((c) => (
                <SlackCard key={c.id} model={captureModel(c)} tone={capApplied(c) ? "emerald" : "violet"}
                  onKeep={() => keepCapture(c)} onDiscard={() => discardCaptureEvt(c)}
                  onEdit={(s, d) => editCaptureEvt(c, s, d)} onMove={(h) => reclassifyCapture(c, h)}
                  onResolve={capHeld(c) ? () => promoteAndConfirm(c) : undefined} />
              ))}
            </div>
            <div id="ov-staffing" className="space-y-3 min-w-0 rounded-2xl">
              {/* Who + vendors both surface here — a mislabeled one (e.g. a vendor read as staff) is
                  reclassified in place via the card's "move" menu. */}
              {capByHome("person").map((c) => (
                <SlackCard key={c.id} model={captureModel(c)} tone={capApplied(c) ? "emerald" : "violet"}
                  onKeep={() => keepCapture(c)} onDiscard={() => discardCaptureEvt(c)}
                  onEdit={(s, d) => editCaptureEvt(c, s, d)} onMove={(h) => reclassifyCapture(c, h)}
                  onResolve={capHeld(c) ? () => promoteAndConfirm(c) : undefined} />
              ))}
              <StaffingEditor eventId={eventId} initialRoles={plan.staffRoles} initialAssignments={plan.roleAssignments ?? {}} defaultAssignee={plan.owners[0]?.name ?? null} roleSlackRefs={plan.roleSlackRefs ?? {}} />
            </div>
          </div>

          {/* Learnings — this event's own (the write side of compounding). */}
          <StringListEditor title="Learnings" initial={plan.reflections} onSave={(v) => setEventReflections(eventId, v).catch(() => {})} variant="bullets" addLabel="Add note" placeholder="Add a learning" empty="No learnings yet." />
        </div>
      )}


      {/* Resources — open-only reference links (Google Docs / Sheets / folders). Full width, bottom. */}
      <ResourcesSection links={plan.referenceLinks ?? []} eventId={eventId} setPlan={setPlan} />
    </div>
  );
}

// Retired from the composed Overview: the deliverables preview, at-a-glance tiles, the Linear-update
// box, auto-updates, and the carried-learnings card. Kept in the file because the forthcoming
// Activity summary + inline compounding hints will reuse parts (AutoUpdates → Activity feed,
// CarriedLessons → in-card hints). Referenced here so the compiler doesn't flag them dead meanwhile.
void [LinearUpdateBox, OverviewDeliverables, GlanceTile, CarriedLessons];

// "Open" — what EventHub surfaces for you to act on. NOT a task list: only two kinds of thing live
// here, a field to set or a proposal to confirm. No free-floating to-dos, no checkbox affordance.
//   Setup — key event fields still unset (date, headcount, owners, budget). 2-col.
//   From Slack — the inbox of ALL proposed captures (each tagged with its category, and also
//     previewed in its own section). Accept all settles them; each card can jump to its section.
// Yields the top slot entirely (renders nothing) when both groups are empty.
function OpenNextUp({ setupFlags, setupMeta, onDismissSetup, capturesCount, capturesPanel }: {
  setupFlags: SetupFlagKey[];
  setupMeta: Record<SetupFlagKey, { title: string; blurb: string; Icon: typeof Calendar; go: () => void }>;
  onDismissSetup: (key: SetupFlagKey) => void;
  capturesCount: number;
  capturesPanel: ReactNode;
}) {
  if (setupFlags.length === 0 && capturesCount === 0) return null;
  return (
    <div id="ov-open" className="bg-white rounded-2xl border border-border p-5">
      <h3 className="font-medium">Open</h3>
      <p className="text-[13px] text-gray-500 mt-0.5 mb-4">Event fields to set, and what's been pulled from Slack (applied automatically — keep, discard, edit, or move any).</p>

      {setupFlags.length > 0 && (
        <div className="mb-4">
          <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400 mb-2">Setup</p>
          {/* Same amber treatment as the classic setup nudges, but half-width in a 2-col grid and
              more compact: click links to the field; the check dismisses ("don't show this again"). */}
          <div className="grid grid-cols-2 gap-2">
            {setupFlags.map((key) => {
              const m = setupMeta[key];
              return (
                <div key={key} className="flex items-center gap-1 rounded-lg border border-amber-200 bg-amber-50 pr-1.5 min-w-0">
                  <button onClick={m.go} className="group flex-1 min-w-0 flex items-center gap-2 rounded-lg px-2.5 py-2 text-left hover:bg-amber-100 transition-colors">
                    <m.Icon className="w-4 h-4 text-amber-700 shrink-0" />
                    <span className="flex-1 min-w-0">
                      <span className="block text-[13px] font-medium text-amber-900 group-hover:underline truncate">{m.title}</span>
                      <span className="block text-[11px] text-amber-700 truncate">{m.blurb}</span>
                    </span>
                  </button>
                  <button onClick={() => onDismissSetup(key)} title="Dismiss — don't show this again" className="w-4 h-4 rounded-full border border-amber-300 text-amber-700 hover:bg-amber-100 flex items-center justify-center shrink-0">
                    <Check className="w-2.5 h-2.5" />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {capturesCount > 0 && (
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400 mb-2">From Slack · {capturesCount}</p>
          {capturesPanel}
        </div>
      )}
    </div>
  );
}

// "Where things stand" — the synthesized, read-only narrative. It reports; the sections below hold
// the truth. Prose-voice bullets, one light thought per line; a refresh regenerates from activity.
function WhereThingsStand({ bullets, fallback, onRefresh, refreshing, note }: {
  bullets: string[]; fallback: string; onRefresh: () => void; refreshing: boolean; note: string | null;
}) {
  const lines = bullets.length > 0 ? bullets : [fallback];
  return (
    <div className="bg-white rounded-2xl border border-border p-5">
      <div className="flex items-start justify-between gap-3 mb-3">
        <h3 className="flex items-center gap-1.5 font-medium"><Sparkles className="w-4 h-4 text-yellow-500" /> Where things stand</h3>
        <button onClick={onRefresh} disabled={refreshing} title="Regenerate from the latest activity" className="shrink-0 inline-flex items-center gap-1 text-[12px] text-gray-400 hover:text-gray-600 disabled:opacity-50">
          <RefreshCw className={`w-3 h-3 ${refreshing ? "animate-spin" : ""}`} /> {refreshing ? "refreshing…" : "refresh"}
        </button>
      </div>
      <div className="space-y-2 text-[14px] text-gray-700 leading-relaxed">
        {lines.map((l, i) => <p key={i}>{l}</p>)}
      </div>
      {note && <p className="text-[12px] text-gray-400 mt-2">{note}</p>}
      <p className="text-[12px] text-gray-400 mt-3 pt-3 border-t border-gray-100">Synthesized from Slack + activity. Details and edits live in the sections below.</p>
    </div>
  );
}

function GlanceTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="min-w-0">
        <p className="text-sm text-gray-600">{label}</p>
        {hint && <p className="text-[15px] text-gray-400 truncate">{hint}</p>}
      </div>
      <p className="text-lg font-semibold text-gray-900 shrink-0">{value}</p>
    </div>
  );
}

// ── Page ownership / dev round-trip ───────────────────────────────────────────
const DEPLOY_STATUSES = ["none", "building", "preview", "live", "failed"];

function DeveloperManager({ eventId }: { eventId: string }) {
  const [devs, setDevs] = useState<Developer[]>([]);
  const [email, setEmail] = useState("");
  useEffect(() => { listDevelopers(eventId).then(setDevs).catch(() => {}); }, [eventId]);
  const add = async () => { const e = email.trim(); if (!e) return; const d = await addDeveloper(eventId, e); setDevs((p) => [...p, d]); setEmail(""); };
  const remove = async (id: string) => { await removeDeveloper(id); setDevs((p) => p.filter((d) => d.id !== id)); };
  return (
    <div className="bg-white rounded-2xl border border-border p-5">
      <h3 className="font-medium mb-1">Developer access</h3>
      <p className="text-[15px] text-gray-400 mb-3">Per-event. Unlocks eject / pull / push / promote for this page only. (Enforced once auth lands.)</p>
      <div className="space-y-2 mb-3">
        {devs.length === 0 && <p className="text-sm text-gray-400">No developers yet.</p>}
        {devs.map((d) => (
          <div key={d.id} className="flex items-center justify-between text-sm">
            <span>{d.email}</span>
            <button onClick={() => remove(d.id)} className="text-gray-300 hover:text-red-600" aria-label="Remove"><Trash2 className="w-3.5 h-3.5" /></button>
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <input value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add(); }} placeholder="developer@email.com" className="flex-1 px-2 py-1 border border-border rounded text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
        <button onClick={add} disabled={!email.trim()} className="px-3 py-1 bg-gray-200 rounded text-sm hover:bg-gray-300 disabled:opacity-50">Add</button>
      </div>
    </div>
  );
}

function PageOwnership({ eventId, initial }: { eventId: string; initial: PageState }) {
  const [page, setPage] = useState(initial);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [diff, setDiff] = useState<{ field: string; was: string; now: string }[] | null>(null);
  const isAdmin = true; // stub until auth/roles land

  const eject = async () => { setBusy(true); try { setPage(await ejectPage(eventId)); setConfirming(false); } finally { setBusy(false); } };
  const save = (f: Parameters<typeof setPageFields>[1]) => { void setPageFields(eventId, f); };
  const regen = async () => {
    const cur = await regeneratePageDraft(eventId);
    const snap = page.ejectedSnapshot ?? {};
    const keys = Array.from(new Set([...Object.keys(cur), ...Object.keys(snap)]));
    setDiff(keys
      .map((k) => ({ field: k, was: JSON.stringify((snap as any)[k] ?? null), now: JSON.stringify((cur as any)[k] ?? null) }))
      .filter((x) => x.was !== x.now));
  };
  const promote = async () => { await promoteToLive(eventId, page.previewUrl); setPage((p) => ({ ...p, liveUrl: p.previewUrl, lastDeployStatus: "live" })); };

  if (page.ownership === "generated") {
    return (
      <div className="space-y-6">
        <div className="bg-white rounded-2xl border border-border p-5">
          <div className="flex items-center gap-2 mb-2">
            <span className="px-2.5 py-1 rounded-full text-[15px] bg-blue-100 text-blue-700">Generated</span>
            <span className="text-sm text-gray-500">Data-bound — renders from event data.</span>
          </div>
          <p className="text-sm text-gray-600 mb-4">Take this page to code for bespoke work (custom hero, animation, novel layout). Auto-fill stops and data binding freezes — regeneration will only produce a draft to diff.</p>
          <Button onClick={() => setConfirming(true)}><Code2 className="w-4 h-4" /> Take to code (Eject)</Button>
          {confirming && (
            <div className="mt-3 text-sm bg-amber-50 border border-amber-300 rounded-lg p-3">
              <p className="font-medium">Eject this page to code?</p>
              <p className="text-gray-700 mt-1">Data binding freezes for this page; regeneration will no longer auto-fill — only draft a diff. The seed includes <span className="font-medium">public fields only</span> (name, date, location, tags, description, format, audience, cover, Luma). Budget, vendors, and candidates are never written into ejected source.</p>
              <div className="flex gap-2 mt-2">
                <Button size="sm" onClick={eject} disabled={busy}>{busy ? "Ejecting…" : "Eject"}</Button>
                <button onClick={() => setConfirming(false)} className="px-3 py-1 text-sm text-gray-600 hover:text-gray-900">Cancel</button>
              </div>
            </div>
          )}
        </div>
        <DeveloperManager eventId={eventId} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl border border-border p-5 space-y-4">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="px-2.5 py-1 rounded-full text-[15px] bg-purple-100 text-purple-700">Dev-owned</span>
          <span className="text-sm text-gray-500">Deployed from code · binding frozen{page.ejectedAt ? ` · ejected ${page.ejectedAt.slice(0, 10)}` : ""}</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
          <div><p className="text-gray-500 text-[15px] mb-1">Repo path</p><p className="font-mono">{page.repoRef ?? "—"}</p></div>
          <div>
            <p className="text-gray-500 text-[15px] mb-1">Deploy status</p>
            <select defaultValue={page.lastDeployStatus ?? "none"} onChange={(e) => { setPage((p) => ({ ...p, lastDeployStatus: e.target.value })); save({ lastDeployStatus: e.target.value }); }} className="px-2 py-1 border border-gray-300 rounded text-sm">
              {DEPLOY_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <p className="text-gray-500 text-[15px] mb-1">Preview URL</p>
            <div className="flex items-center gap-2">
              <input defaultValue={page.previewUrl ?? ""} onBlur={(e) => { setPage((p) => ({ ...p, previewUrl: e.target.value || null })); save({ previewUrl: e.target.value || null }); }} placeholder="https://preview…" className="flex-1 px-2 py-1 border border-gray-300 rounded text-sm" />
              {page.previewUrl && <a href={page.previewUrl} target="_blank" rel="noreferrer" className="text-gray-500 hover:text-gray-900"><ExternalLink className="w-4 h-4" /></a>}
            </div>
          </div>
          <div>
            <p className="text-gray-500 text-[15px] mb-1">Live URL</p>
            <div className="flex items-center gap-2">
              <input defaultValue={page.liveUrl ?? ""} onBlur={(e) => { setPage((p) => ({ ...p, liveUrl: e.target.value || null })); save({ liveUrl: e.target.value || null }); }} placeholder="https://live…" className="flex-1 px-2 py-1 border border-gray-300 rounded text-sm" />
              {page.liveUrl && <a href={page.liveUrl} target="_blank" rel="noreferrer" className="text-gray-500 hover:text-gray-900"><ExternalLink className="w-4 h-4" /></a>}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 pt-3 border-t border-gray-100">
          <button onClick={regen} className="inline-flex items-center gap-1 px-3 py-1.5 border border-gray-300 rounded-lg text-sm hover:bg-gray-50"><RefreshCw className="w-3.5 h-3.5" /> Regenerate draft to diff</button>
          <Button size="sm" onClick={promote} disabled={!page.previewUrl || !isAdmin} title="Admin sign-off: promote preview → live"><Globe className="w-3.5 h-3.5" /> Promote to live (Admin)</Button>
        </div>
        {diff && (
          <div className="text-sm border border-gray-200 rounded-lg p-3">
            <p className="font-medium mb-2">Data drift since eject {diff.length === 0 && <span className="text-gray-400 font-normal">— none</span>}</p>
            {diff.map((d) => (
              <div key={d.field} className="py-1 border-t border-gray-100 first:border-0">
                <p className="text-[15px] text-gray-500">{d.field}</p>
                <p className="text-[15px]"><span className="text-red-600 line-through">{d.was}</span> → <span className="text-green-700">{d.now}</span></p>
              </div>
            ))}
            <p className="text-[15px] text-gray-400 mt-2">Reference only — never auto-applied. Update the code to match.</p>
          </div>
        )}
        <p className="text-[15px] text-gray-400">EventHub doesn't host or render dev-owned pages — they deploy from code. Git dir creation, CI preview builds, and promote run in your pipeline; these fields surface their state.</p>
      </div>
      <DeveloperManager eventId={eventId} />
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
type Tab = "overview" | "people" | "budget" | "deliverables" | "page";
const TABS: { key: Tab; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "deliverables", label: "Deliverables" },
  { key: "people", label: "People" },
  { key: "budget", label: "Budget" },
  { key: "page", label: "Page" },
];

// Top-right "⋮" menu on the event page.
function EventMenu({ onReset, onDelete, onUnlinkLinear, linked }: { onReset: () => void; onDelete: () => void; onUnlinkLinear?: () => void; linked?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500 hover:text-gray-800" aria-label="Event menu"><MoreVertical className="w-5 h-5" /></button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-40 mt-1 w-48 bg-white border border-border rounded-lg shadow-lg p-1">
            <button onClick={() => { setOpen(false); onReset(); }} className="flex items-center gap-2 w-full px-2 py-1.5 rounded hover:bg-gray-50 text-sm text-gray-700"><RefreshCw className="w-4 h-4" /> Reset event</button>
            {linked && onUnlinkLinear && (
              <button onClick={() => { setOpen(false); onUnlinkLinear(); }} className="flex items-center gap-2 w-full px-2 py-1.5 rounded hover:bg-red-50 text-sm text-red-600"><X className="w-4 h-4" /> Unlink Linear</button>
            )}
            <button onClick={() => { setOpen(false); onDelete(); }} className="flex items-center gap-2 w-full px-2 py-1.5 rounded hover:bg-red-50 text-sm text-red-600"><Trash2 className="w-4 h-4" /> Delete event</button>
          </div>
        </>
      )}
    </div>
  );
}

// Start/end time editor that holds a local draft and only persists on an explicit Save (which appears
// once you've changed something), with a "Saved ✓" confirmation — so edits can't quietly get lost.
function TimeRangeEditor({ eventId, startTime, endTime, onSaved }: { eventId: string; startTime: string | null; endTime: string | null; onSaved: (s: string | null, e: string | null) => void }) {
  const [s, setS] = useState(startTime ?? "");
  const [e, setE] = useState(endTime ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<boolean>(!!(startTime || endTime));
  useEffect(() => { setS(startTime ?? ""); setE(endTime ?? ""); if (startTime || endTime) setExpanded(true); }, [startTime, endTime]);
  const dirty = (s || null) !== (startTime ?? null) || (e || null) !== (endTime ?? null);
  const save = async () => {
    setSaving(true); setErr(null);
    try {
      await updateEvent(eventId, { startTime: s || null, endTime: e || null });
      onSaved(s || null, e || null); setSaved(true); setTimeout(() => setSaved(false), 1800);
    } catch (ex: any) {
      // Surface the failure instead of leaving the button silently stuck — otherwise a rejected write
      // (e.g. a stale PostgREST schema cache that doesn't know the time columns) just looks like "Save
      // does nothing." The edit stays in the fields so nothing is lost.
      setErr(ex?.message ?? String(ex));
    } finally { setSaving(false); }
  };
  // Hide the native per-input clock picker indicator — we show a single Clock icon to the left instead.
  const cls = "px-1 py-0.5 border border-gray-200 rounded text-[13px] focus:outline-none focus:ring-2 focus:ring-gray-300 [&::-webkit-calendar-picker-indicator]:hidden";
  if (!expanded) {
    return <button onClick={() => setExpanded(true)} className="inline-flex items-center gap-1.5 text-gray-400 hover:text-gray-700"><Clock className="w-4 h-4" /> + time</button>;
  }
  return (
    <span className="inline-flex items-center gap-1">
      <Clock className="w-4 h-4 text-gray-400 shrink-0 mr-0.5" />
      <input type="time" value={s} onChange={(ev) => setS(ev.target.value)} title="Start time" className={cls} />
      <span className="text-gray-400">–</span>
      <input type="time" value={e} onChange={(ev) => setE(ev.target.value)} title="End time" className={cls} />
      {dirty && <button onClick={() => void save()} disabled={saving} className="text-[12px] px-2 py-0.5 rounded bg-gray-900 text-white hover:bg-black disabled:opacity-50">{saving ? "Saving…" : "Save"}</button>}
      {saved && !dirty && <span className="text-[12px] text-emerald-600 inline-flex items-center gap-0.5"><Check className="w-3 h-3" /> Saved</span>}
      {err && <span className="text-[12px] text-red-600" title={err}>Couldn’t save — {err}</span>}
    </span>
  );
}

export function EventPlanningPage({ eventId, onBack, onOpenEvent, onReview }: Props) {
  const [plan, setPlan] = useState<EventPlanning | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [wrappedView, setWrappedView] = useState<"event" | "template">("event"); // segmented toggle on a wrapped event
  const [eventSubTab, setEventSubTab] = useState<"record" | "deliverables" | "budget" | "people">("record"); // tabs UNDER "This event"
  const [reopened, setReopened] = useState(false); // wrapped event re-opened to the normal workspace
  const [deliverableJump, setDeliverableJump] = useState<string | null>(null); // Overview → a specific deliverable
  const [reflectionJump, setReflectionJump] = useState(0); // Deliverables → the post-event reflection page
  // People is a tab here (keeps the event header/tabs); links set the status it opens on.
  const [peopleStatus, setPeopleStatus] = useState<'all' | 'registered' | 'checkedIn' | 'waitlisted' | 'speakers'>('all');
  const goPeople = (status: typeof peopleStatus) => { setPeopleStatus(status); setTab('people'); };
  const [version, setVersion] = useState(0); // bumps on each fetch → remounts tab content with fresh data
  const [reload, setReload] = useState(0);   // bumped when an auto-update applies a change

  // Drag-and-drop ONTO an open event = project knowledge for THIS event (context + gap-fill), never
  // a new-event brief. We stop the drop from bubbling to the app-level create/backfill handler.
  const [dropOver, setDropOver] = useState(false);
  const [dropBusy, setDropBusy] = useState(false);
  const [dropMsg, setDropMsg] = useState<string | null>(null);
  const dropDepth = useRef(0);
  const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes("Files");
  const onPageDrop = async (files: File[]) => {
    if (!plan || !files.length) return;
    // Dropping a doc onto a PAST/wrapped event = enrich it → open the review-and-edit (same as
    // backfill), pre-merged with this event. An ACTIVE event keeps the quick silent gap-fill.
    const isPast = plan.settleState === "settled" || plan.macroStage === "Wrapped" || (!!plan.date && plan.date < new Date().toISOString().slice(0, 10));
    if (isPast) { setEnrichDrop({ files }); return; } // modal opens as a bottom pill, extracts, then review
    setDropBusy(true); setDropMsg(null);
    try {
      const gapKeys = completenessFields(plan).filter((f) => !f.present).map((f) => f.key);
      let anyApplied = false;
      const msgs: string[] = [];
      // A dropped folder can carry many files — process each into THIS event.
      for (const file of files) {
        try {
          const { message, applied } = await ingestEventDoc(eventId, file, gapKeys);
          msgs.push(message);
          if (applied) anyApplied = true;
        } catch (e: any) { msgs.push(`${file.name}: ${e?.message ?? String(e)}`); }
      }
      setDropMsg(files.length === 1 ? msgs[0] : `Processed ${files.length} files${anyApplied ? "" : " — nothing new applied"}.`);
      if (anyApplied) setReload((r) => r + 1);
    } catch (e: any) { setDropMsg(e?.message ?? String(e)); }
    finally { setDropBusy(false); }
  };
  // Auto-dismiss the result toast a few seconds after it lands.
  useEffect(() => {
    if (!dropMsg) return;
    const id = setTimeout(() => setDropMsg(null), 6000);
    return () => clearTimeout(id);
  }, [dropMsg]);
  // Always clear the drag overlay once a drop ends anywhere — capture phase, so it fires even when
  // an inner zone (completeness panel, budget area) stops the event from bubbling to the page.
  useEffect(() => {
    const reset = () => { dropDepth.current = 0; setDropOver(false); };
    window.addEventListener("drop", reset, true);
    window.addEventListener("dragend", reset, true);
    return () => { window.removeEventListener("drop", reset, true); window.removeEventListener("dragend", reset, true); };
  }, []);
  const pageDrag = {
    onDragEnter: (e: React.DragEvent) => { if (!hasFiles(e)) return; e.preventDefault(); e.stopPropagation(); dropDepth.current++; setDropOver(true); },
    onDragOver: (e: React.DragEvent) => { if (!hasFiles(e)) return; e.preventDefault(); e.stopPropagation(); },
    onDragLeave: (e: React.DragEvent) => { e.stopPropagation(); dropDepth.current = Math.max(0, dropDepth.current - 1); if (dropDepth.current === 0) setDropOver(false); },
    // filesFromDrop descends into a dropped folder (falls back to the flat file list) — so folders
    // work, not just single files.
    onDrop: (e: React.DragEvent) => { if (!hasFiles(e)) return; e.preventDefault(); e.stopPropagation(); dropDepth.current = 0; setDropOver(false); void filesFromDrop(e.dataTransfer).then((fs) => { if (fs.length) void onPageDrop(fs); }); },
  };

  // Refetch when the tab changes (or an auto-update applies) so the Overview and each
  // section reflect edits made on the others (every mutation writes to the DB).
  useEffect(() => {
    let cancelled = false;
    getEventPlanning(eventId)
      .then((p) => { if (!cancelled) { setPlan(p); setVersion((v) => v + 1); } })
      .catch((e) => { if (!cancelled) setError(e.message ?? String(e)); });
    return () => { cancelled = true; };
  }, [eventId, tab, reload]);

  // Auto-resync FROM Linear on load — once per event open, and only if it's ALREADY linked.
  // Pulls each issue's current state back onto its deliverable (so a ticket moved in Linear
  // reflects here), then refreshes if anything changed. Won't create a project for unsynced
  // events; the ref guard prevents re-firing on tab switches / reload bumps.
  const autoLinearRef = useRef<string | null>(null);
  useEffect(() => {
    if (!plan?.linearProjectId) return;
    if (autoLinearRef.current === eventId) return;
    autoLinearRef.current = eventId;
    pullEventFromLinear(eventId)
      .then((r) => { if (r?.pulled > 0) setReload((x) => x + 1); })
      .catch(() => {});
  }, [eventId, plan?.linearProjectId]);

  // Back steps to the Overview tab first (e.g. from the Budget tab), then out of the event.
  // Matches the Events status pills (Future/In-Process/Past) in size + style, so the top-left
  // control keeps the same placement/sizing when switching between the list and an event.
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmUnlink, setConfirmUnlink] = useState(false);
  const [unlinking, setUnlinking] = useState(false);
  const [enrichDrop, setEnrichDrop] = useState<{ files: File[] } | null>(null);
  // Clear imported/derived content back to a clean slate (keeps identity); refresh after.
  const doReset = async () => { try { await resetEvent(eventId); } finally { setConfirmReset(false); setReload((r) => r + 1); } };
  // Unlink from Linear: delete the Linear project + its issues, clear the linkage here. Refresh after
  // so the "Sync to Linear" button returns and the deliverables show no ticket links.
  const doUnlink = async () => {
    setUnlinking(true);
    try { await unlinkLinear(eventId); setConfirmUnlink(false); setReload((r) => r + 1); }
    catch (e: any) { setError(e?.message ?? String(e)); setConfirmUnlink(false); }
    finally { setUnlinking(false); }
  };
  const back = (
    <button onClick={() => { if (tab !== "overview") setTab("overview"); else onBack(); }} className="inline-flex items-center gap-1 mb-6 px-2 py-1 rounded-lg bg-white border border-border text-gray-700 hover:bg-gray-50 transition-colors">
      <ChevronLeft className="w-4 h-4" /> {tab !== "overview" ? "Overview" : "Previous"}
    </button>
  );
  // Delete this event (same confirm + cascade as deleting from the events list); back to the list after.
  const doDelete = async () => { try { await deleteEvent(eventId); onBack(); } catch (e: any) { setError(e?.message ?? String(e)); } };

  if (error) return <div>{back}<p className="text-red-600 bg-red-50 border border-red-200 rounded-lg p-4">Couldn’t load event: {error}</p></div>;
  if (!plan) return <div>{back}<p className="text-gray-500 py-12 text-center">Loading planning view…</p></div>;

  // A template renders in pattern mode (walkthrough-forward, no live/ops affordances).
  if (plan.isTemplate) return <TemplateView key={version} plan={plan} eventId={eventId} onExit={onBack} onOpenEvent={onOpenEvent} onReview={onReview} onApplied={() => setReload((r) => r + 1)} />;

  const headcount = plan.capacity != null ? `${plan.rsvp ?? 0} / ${plan.capacity} expected` : plan.rsvp != null ? `${plan.rsvp} expected` : "—";
  // One "wrapped" concept: a settled event (backfill / post-event tail) OR a macro_stage Wrapped one.
  const wrapped = plan.settleState === "settled" || plan.macroStage === "Wrapped";

  // Re-run AI extraction on the attached materials and ADD anything missing (shared util; events
  // fill phases + deliverables). Non-destructive; refresh after so the view reflects new content.
  const regenerateFromMaterials = async (): Promise<string> => {
    const msg = await runRegenerate(plan, { template: false });
    setReload((r) => r + 1);
    return msg;
  };

  return (
    <div {...pageDrag} className="relative">
      {/* Top-right event menu (⋮) — Delete for now, same confirm + cascade as the list. */}
      <div className="absolute top-0 right-0 z-20"><EventMenu onReset={() => setConfirmReset(true)} onDelete={() => setConfirmDelete(true)} onUnlinkLinear={() => setConfirmUnlink(true)} linked={!!plan.linearProjectId} /></div>
      {confirmReset && (
        <ConfirmModal
          title="Reset event?"
          message={`Clear all imported content for “${plan.title}” — deliverables, phases, roles, run of show, learnings, budget lines, vendors, turnout, verdict, and attached docs. Keeps the name, date, location, tags, and owners. This can’t be undone.`}
          confirmLabel="Reset"
          danger
          onConfirm={doReset}
          onClose={() => setConfirmReset(false)}
        />
      )}
      {confirmUnlink && (
        <ConfirmModal
          title="Unlink from Linear?"
          message={`Delete the Linear project for “${plan.title}” and every issue in it, then unlink this event. The deliverables stay in EventHub, but their Linear tickets are removed. This can’t be undone.`}
          confirmLabel={unlinking ? "Unlinking…" : "Unlink & delete in Linear"}
          danger
          onConfirm={doUnlink}
          onClose={() => { if (!unlinking) setConfirmUnlink(false); }}
        />
      )}
      {enrichDrop && (
        <BackfillModal
          enrich={{ eventId, plan }}
          initialFiles={enrichDrop.files}
          startMinimized
          onClose={() => setEnrichDrop(null)}
          onCreated={() => { setEnrichDrop(null); setReload((r) => r + 1); }}
        />
      )}
      {confirmDelete && (
        <ConfirmModal
          title="Delete event?"
          message={`Permanently delete “${plan.title}” and everything attached to it (budget, vendors, planning, attendee links). This can’t be undone.`}
          confirmLabel="Delete"
          danger
          onConfirm={doDelete}
          onClose={() => setConfirmDelete(false)}
        />
      )}
      {/* Dropping a file on an open event adds it as project knowledge for THIS event — not a new one. */}
      {dropOver && (
        <div className="fixed inset-0 z-[90] bg-primary/5 border-4 border-dashed border-primary/40 flex items-center justify-center pointer-events-none">
          <span className="text-lg text-gray-700 bg-white/90 px-4 py-2 rounded-full inline-flex items-center gap-2">
            <Paperclip className="w-5 h-5" /> Drop to add to “{plan.title}” as project context
          </span>
        </div>
      )}
      {(dropBusy || dropMsg) && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[95] inline-flex items-center gap-2 bg-gray-900 text-white text-sm px-4 py-2 rounded-full shadow-lg">
          {dropBusy ? <><Loader2 className="w-4 h-4 animate-spin" /> Adding to this event…</> : <><span>{dropMsg}</span><button onClick={() => setDropMsg(null)} className="text-gray-400 hover:text-white" aria-label="Dismiss"><X className="w-4 h-4" /></button></>}
        </div>
      )}
      {back}

      <SourceMaterials items={plan.sourceMaterials} className="mb-6" onDelete={async (m) => { await deleteSourceMaterial(eventId, m.name).catch(() => {}); setReload((r) => r + 1); }} onRegenerate={regenerateFromMaterials} />

      {/* Header */}
      <div className="relative bg-white rounded-2xl border border-border p-8 mb-6">
        <div className="header-row flex gap-10">
          <div className="flex-1 min-w-0">
            <div className="mb-3"><TagStack tags={plan.tags} editable onChange={(tags) => { setPlan((p) => (p ? { ...p, tags } : p)); void updateEventTags(eventId, tags); }} /></div>
            {/* Tier 1 — identity: title + status, vertically centered */}
            <div className="mb-4 flex items-center gap-3 flex-wrap">
              <EditableTitle value={plan.title} onChange={(name) => { setPlan((p) => (p ? { ...p, title: name } : p)); void updateEvent(eventId, { name }); }} className="text-3xl leading-none" />
              <StatusControl eventId={eventId} status={plan.status} eventDate={plan.date} showLabel={false} onChange={(s) => setPlan((p) => (p ? { ...p, status: s } : p))} />
            </div>
            {/* Tier 2 — core facts: date block · time · format · location · expected · speakers */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 mb-3 text-sm text-gray-600">
              <div id="hlf-date" className="inline-flex items-center gap-1 border border-gray-200 rounded pl-1.5 pr-1 py-0.5">
                {!plan.lumaEventId ? (
                  <DateEdit
                    value={plan.date}
                    onChange={(iso) => {
                      setPlan((p) => (p ? { ...p, date: iso } : p));
                      void setEventDate(eventId, iso);
                    }}
                    placeholder="Date"
                  />
                ) : (
                  <span>{plan.date ?? "Date"}</span>
                )}
                {/* Show whenever the event has a date: synced → calendar link + delink, pending → review,
                    unsynced → an "add to calendar" button. (Previously gated to synced/pending only, which
                    left a dated-but-unsynced event with no way to attach.) */}
                {plan.date && (
                  <GcalLinkControl eventId={eventId} synced={!!plan.gcalEventId} htmlLink={plan.gcalHtmlLink} gcalEventIds={plan.gcalEventIds} hasDate={!!plan.date} matchPending={plan.gcalMatchPending} onChange={() => setReload((x) => x + 1)} />
                )}
              </div>
              <TimeRangeEditor eventId={eventId} startTime={plan.startTime} endTime={plan.endTime} onSaved={(s, e) => setPlan((p) => (p ? { ...p, startTime: s, endTime: e } : p))} />
              <span id="hlf-location" className="inline-flex items-center rounded-md"><LocationEdit value={plan.location} onChange={(location) => { setPlan((p) => (p ? { ...p, location } : p)); void updateEvent(eventId, { location }); }} /></span>
              <button id="hlf-headcount" onClick={() => goPeople('all')} className="flex items-center gap-1.5 hover:text-gray-900 text-left">
                <Users className="w-4 h-4" /><span className={headcount === "—" ? "text-gray-400" : ""}>{headcount === "—" ? "Expected" : headcount}</span>
              </button>
              <SpeakerField eventId={eventId} />
            </div>
            {/* Tier 3 — owners + format (format lives here so its hover fan-out has room and isn't clipped by the cover image) */}
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 mb-4 text-sm text-gray-400">
              <span id="hlf-owners" className="inline-flex items-center rounded-md">
                <OwnerPicker eventId={eventId} owners={plan.owners} onChange={(owners) => setPlan((p) => (p ? { ...p, owners, owner: owners.map((o) => o.name).join(", ") || null } : p))} />
              </span>
              <FormatPicker value={parseFormats(plan.format)} onChange={(arr) => { const format = joinFormats(arr); setPlan((p) => (p ? { ...p, format } : p)); void setEventFormat(eventId, format); }} />
            </div>
            {/* Attach-actions — set apart from the facts; folder+series up top, slack+luma below */}
            <div className="mb-5 pt-4 border-t border-gray-100 space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <DocLinkControl url={plan.docLink} onSave={(u) => { setPlan((p) => (p ? { ...p, docLink: u } : p)); void updateEvent(eventId, { docLink: u }); }} label="Folder" icon={<Folder className="w-4 h-4" />} placeholder="Paste Drive folder link…" />
                <SeriesAttach eventId={eventId} />
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <SlackChannelControl eventId={eventId} title={plan.title} slackChannel={plan.slackChannel} onChange={() => setReload((x) => x + 1)} />
                <LumaAttach eventId={eventId} initialUrl={plan.lumaUrl} descriptions={plan.outreach.filter(isLumaDescription)} draft={{ name: plan.title, date: plan.date, startTime: plan.startTime, endTime: plan.endTime, location: plan.location, description: plan.description || "" }} />
                {/* Past + Luma-linked → the background sync skips it; let the owner pull late additions by hand (add-only). */}
                {plan.lumaEventId && plan.date && plan.date < today() && <LumaResync eventId={eventId} onDone={() => setReload((x) => x + 1)} />}
              </div>
            </div>
          </div>
          <CoverImage
            eventId={eventId}
            cover={plan.coverImageUrl}
            lumaCover={plan.lumaCoverUrl}
            customCover={plan.customCoverUrl}
            position={plan.coverPosition}
            onChange={(patch) => setPlan((p) => (p ? { ...p, coverImageUrl: patch.cover, ...(patch.custom !== undefined ? { customCoverUrl: patch.custom } : {}) } : p))}
            onPosition={(coverPosition) => setPlan((p) => (p ? { ...p, coverPosition } : p))}
          />
        </div>
        <OpenInLinear eventId={eventId} projectUrl={plan.linearProjectUrl} className="absolute bottom-4 right-6" onSynced={() => setReload((x) => x + 1)} />
      </div>

      {wrapped && !reopened ? (
        /* WRAPPED layout — a record + a pattern, not a workspace. Toggle replaces the tab row.
           "Wrapped" = settled (backfill / post-event tail) OR macro_stage Wrapped — one concept. */
        <>
          <div className="border-b border-gray-200 mb-6 flex items-center justify-between gap-3">
            <div className="inline-flex rounded-lg bg-gray-100 p-0.5 my-2">
              {([["event", "This event"], ["template", "Template"]] as const).map(([k, label]) => (
                <button key={k} onClick={() => setWrappedView(k)} className={`px-3 py-1 rounded-md text-sm transition-colors ${wrappedView === k ? "bg-white shadow-sm text-gray-900" : "text-gray-500 hover:text-gray-800"}`}>{label}</button>
              ))}
            </div>
            <button onClick={() => setReopened(true)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-300 bg-white text-sm text-gray-700 hover:bg-gray-50 shrink-0">
              <LockOpen className="w-4 h-4" /> Reopen workspace
            </button>
          </div>
          {wrappedView === "template" ? (
            <WrappedTemplate plan={plan} eventId={eventId} onApplied={() => setReload((r) => r + 1)} onOpenEvent={onOpenEvent} />
          ) : (
            <div>
              {/* Sub-tabs UNDER "This event" (People + Deliverables live here, not on par with Template). */}
              <div className="flex items-center gap-4 mb-5 text-sm">
                {([["record", "Summary"], ["deliverables", "Deliverables"], ["budget", "Budget"], ["people", "People"]] as const).map(([k, label]) => (
                  <button key={k} onClick={() => setEventSubTab(k)} className={`pb-1 border-b-2 transition-colors ${eventSubTab === k ? "border-gray-900 text-gray-900 font-medium" : "border-transparent text-gray-500 hover:text-gray-800"}`}>{label}</button>
                ))}
              </div>
              <div key={eventSubTab}>
                {eventSubTab === "record" && (
                  <div className="space-y-6">
                    {/* gaps + drop-to-fill (budget, turnout, …) — what would make this record complete */}
                    <CompletenessPanel plan={plan} eventId={eventId} onApplied={() => setReload((r) => r + 1)} onResolveGap={(key) => {
                      if (key === "turnout") { setEventSubTab("people"); return true; }
                      if (key === "budget" || key === "vendors") { setEventSubTab("budget"); return true; }
                      return false; // date/location/outcome/agenda/roles → doc picker fallback
                    }} />
                    <LockedRundown plan={plan} assignedTarget={plan.eventBudgetTarget ?? plan.budget?.targetAmount ?? null} onOpenPeople={() => setEventSubTab("people")} onOpenBudget={() => setEventSubTab("budget")} onApplied={() => setReload((r) => r + 1)} onFocusChange={(f) => setPlan((p) => (p ? { ...p, focusOverride: f } : p))} />
                  </div>
                )}
                {eventSubTab === "deliverables" && <WrappedDeliverables plan={plan} />}
                {eventSubTab === "budget" && (plan.budget
                  ? <BudgetTracker budget={plan.budget} eventId={eventId} eventBudgetTarget={plan.eventBudgetTarget} location={plan.location} />
                  : <div className="bg-white rounded-2xl border border-border p-6">
                      <p className="text-sm text-gray-500 mb-3">No budget yet for this event.</p>
                      <button onClick={async () => { await ensureEventBudget(eventId); setReload((r) => r + 1); }} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-900 text-white text-sm hover:bg-black"><Plus className="w-4 h-4" /> Start a budget</button>
                    </div>)}
                {eventSubTab === "people" && <PeoplePage eventFilter={{ id: eventId, name: plan.title, tag: plan.tags[0] ?? null, status: peopleStatus }} />}
              </div>
            </div>
          )}
        </>
      ) : (
      <>
      {/* Tabs — brand Tabs (line variant = underline-on-active). "Close workspace" sits on this same
          line (right side) so it mirrors "Reopen workspace" on the wrapped view's toggle row — the
          control keeps the same format, size, and position when toggling between the two views. */}
      <div className="border-b border-gray-200 mb-6 flex items-center justify-between gap-3">
        <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
          <TabsList variant="line">
            {TABS.map((tt) => (
              <TabsTrigger key={tt.key} value={tt.key}>{tt.label}</TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        {wrapped && reopened && (
          <button onClick={() => setReopened(false)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-300 bg-white text-sm text-gray-700 hover:bg-gray-50 shrink-0 my-1.5">
            <Lock className="w-4 h-4" /> Close workspace
          </button>
        )}
      </div>

      <div key={`${tab}-${version}`}>
        {tab === "overview" && (
          <Overview plan={plan} eventId={eventId} onApplied={() => setReload((r) => r + 1)} onOpenBudget={() => setTab("budget")} onOpenTimeline={() => setTab("deliverables")} onOpenDeliverable={(id) => { setDeliverableJump(id); setTab("deliverables"); }} onOpenPeople={() => setTab("people")} onOpenEvent={onOpenEvent} reflectionJump={reflectionJump} reopened={reopened} setPlan={setPlan} />
        )}
        {tab === "people" && <PeoplePage eventFilter={{ id: eventId, name: plan.title, tag: plan.tags[0] ?? null, status: peopleStatus }} />}
        {tab === "budget" && (plan.budget
          ? <div className="space-y-6">
              <BudgetProjections plan={plan} eventId={eventId} onApplied={() => setReload((r) => r + 1)} />
              <BudgetTracker budget={plan.budget} eventId={eventId} eventBudgetTarget={plan.eventBudgetTarget} location={plan.location} />
            </div>
          : <div className="bg-white rounded-2xl border border-border p-6">
              <p className="text-sm text-gray-500 mb-3">No budget yet for this event.</p>
              <button onClick={async () => { await ensureEventBudget(eventId); setReload((r) => r + 1); }} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-900 text-white text-sm hover:bg-black"><Plus className="w-4 h-4" /> Start a budget</button>
            </div>)}
        {tab === "deliverables" && (
          <div className="space-y-6">
            <SuggestedDeliverables plan={plan} eventId={eventId} onApplied={() => setReload((r) => r + 1)} />
            <BenchmarkEditor eventId={eventId} benchmarks={plan.benchmarks} deliverables={plan.deliverables} setPlan={setPlan} />
            <Deliverables eventId={eventId} initial={plan.deliverables} phases={plan.phases} benchmarks={plan.benchmarks} markers={deriveMarkers(plan).markers} currentKey={deriveMarkers(plan).currentKey} jumpId={deliverableJump} linearProjectUrl={plan.linearProjectUrl} onLinearSynced={() => setReload((r) => r + 1)} onOpenReflection={() => { setReflectionJump((n) => n + 1); setTab("overview"); }} />
            <AgendaEditor eventId={eventId} initial={plan.agenda} />
          </div>
        )}
        {tab === "page" && (
          <div className="space-y-6">
            <EventPageBuilder plan={plan} />
            <details className="bg-white rounded-2xl border border-border">
              <summary className="px-5 py-3 cursor-pointer text-sm text-gray-600 hover:text-gray-900">Advanced — take to code (eject)</summary>
              <div className="px-5 pb-5"><PageOwnership eventId={eventId} initial={plan.page} /></div>
            </details>
          </div>
        )}
      </div>
      </>
      )}

      {/* Linear command launcher (morph bubble → centered window) — workspace only; a wrapped record
          has no active worklist. Scoped to THIS event. */}
      {!(wrapped && !reopened) && (
        <LinearLauncher eventId={eventId} linearSynced={!!plan.linearProjectId} onApplied={() => setReload((r) => r + 1)} />
      )}
    </div>
  );
}
