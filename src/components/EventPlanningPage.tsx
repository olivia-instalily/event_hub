import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { TemplateView, PhaseRail, enrichPhases, tLabel as railLabel } from "./TemplateView";
import { SourceMaterials } from "./SourceMaterials";
import {
  Calendar, Users, Plus, Trash2, Check, Paperclip,
  AlertCircle, Lightbulb, ChevronRight, ChevronLeft, ExternalLink,
  Mail, Activity, Send, Pencil, X, Clock, RefreshCw, Link2, Code2, Globe, LayoutGrid, List, Mic, Lock, ArrowDown, ArrowUp, MessageSquare, GripVertical, CalendarPlus, Star,
} from "lucide-react";
import { DndContext, closestCenter, PointerSensor, KeyboardSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy, arrayMove, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  getEventPlanning, getCarriedLessons, updateEventTags, updateEvent, setEventDate, setEventFormat, attachLuma, createLumaEvent, syncEventToGoogleCalendar, pullEventFromLinear,
  setMacroStage, addEngagement, deleteEngagement, setEngagementStage,
  addCandidate, updateCandidate, deleteCandidate, selectCandidate, clearCandidateSelection, suggestVendors, listBudgetLines,
  addTrackerLine, deleteBudgetLine, setBudgetStatus, setBudgetSyncUrl, attachLineDoc, setBudgetTarget, updateBudgetLine,
  addDeliverable, setDeliverableStatus, setDeliverableDueDate, deleteDeliverable,
  getPlanningSummary, saveOverviewSummary,
  getEventPeopleStats, listAttendeesForEvent, scheduleDebrief, extractBrief,
  listEventTags, type EventPersonTag,
  type PersonView, type PeopleStats,
  setEventAgenda, setEventStaffRoles, setEventReflections,
  listEventUpdates, recordEventUpdate, detectUpdate, syncGmail, summarizeCorrespondence,
  ejectPage, regeneratePageDraft, setPageFields, promoteToLive, listDevelopers, addDeveloper, removeDeveloper,
  type EventUpdate, type DetectedUpdate, type PageState, type Developer,
  MACRO_STAGES, ENGAGEMENT_STAGES,
  type EventPlanning, type EngagementWithCandidates, type VendorCandidate,
  type PlanningBudget, type BudgetLineTracker, type Deliverable, type CarriedLesson,
  type PlanningFacts, type VendorSuggestion, type BudgetStatus, BUDGET_STATUSES,
  type EventPhase, type RunOfShowItem, type OutreachTemplate,
} from "../lib/db";
import { TagStack } from "./TagStack";
import { FormatPicker, parseFormats, joinFormats } from "./FormatPicker";
import { Button } from "@instalily/ui/button";
import { StatCard } from "./StatCard";
import { Tabs, TabsList, TabsTrigger } from "@instalily/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@instalily/ui/select";
import { LocationEdit } from "./LocationEdit";
import { EditableTitle } from "./EditableTitle";
import { StatusControl } from "./StatusControl";
import { FileDrop } from "./FileDrop";
import { EventPageBuilder } from "./EventPageBuilder";
import { CoverImage } from "./CoverImage";
import { OwnerPicker } from "./OwnerPicker";
import { GCalSync } from "./GCalSync";
import { LinearSync } from "./LinearSync";
import { LinearUpdateBox } from "./LinearUpdateBox";
import { DateEdit } from "./DateEdit";
import { BudgetDropZone, BudgetDropArea, BudgetImportModal } from "./BudgetImport";
import { EventSetup } from "./EventSetup";
import { ScopingForm } from "./ScopingForm";
import { PeoplePage } from "./PeoplePage";
import { loadScoping, saveScoping, fundingFor, type ScopingForm as ScopingData } from "../lib/scoping";
import { domainFromUrl, isFreeMailDomain } from "../lib/url";

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

const DELIVERABLE_PHASES = ["Planning", "Week-of", "Event day", "Wrap"];
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

function LumaAttach({ eventId, initialUrl, draft, descriptions }: { eventId: string; initialUrl: string | null; draft: LumaDraft; descriptions?: OutreachTemplate[] }) {
  const [url, setUrl] = useState(initialUrl);
  const [mode, setMode] = useState<"idle" | "menu" | "attach" | "create">("idle");
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const attach = async () => {
    const u = input.trim(); if (!u) return;
    setBusy(true); setErr(null);
    try { const r = await attachLuma(eventId, u); setUrl(r.lumaUrl ?? u); setMode("idle"); setInput(""); }
    catch (e: any) { setErr(e?.message ?? String(e)); }
    finally { setBusy(false); }
  };

  if (url) return <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900"><Link2 className="w-4 h-4" /> Luma</a>;

  if (mode === "menu") return (
    <span className="inline-flex items-center gap-1">
      <Button variant="secondary" size="sm" onClick={() => setMode("attach")}>Attach link</Button>
      <Button size="sm" onClick={() => setMode("create")}>Create on Luma</Button>
      <button onClick={() => setMode("idle")} className="text-gray-400 hover:text-gray-700"><X className="w-4 h-4" /></button>
    </span>
  );
  if (mode === "attach") return (
    <span className="inline-flex items-center gap-1">
      <input autoFocus value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") attach(); }} placeholder="luma.com/…" className="px-2 py-1 border border-border rounded text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
      <button onClick={attach} disabled={busy || !input.trim()} className="px-2 py-1 bg-gray-200 rounded text-sm hover:bg-gray-300 disabled:opacity-50">{busy ? "…" : "Attach"}</button>
      <button onClick={() => setMode("menu")} className="text-gray-400 hover:text-gray-700"><X className="w-4 h-4" /></button>
      {err && <span className="text-[15px] text-red-600">{err}</span>}
    </span>
  );
  return (
    <>
      <button onClick={() => setMode("menu")} className="inline-flex items-center gap-1 text-sm text-gray-400 hover:text-gray-700"><Link2 className="w-4 h-4" /> Attach / Create Luma</button>
      {mode === "create" && <CreateLumaModal eventId={eventId} draft={draft} descriptions={descriptions} onClose={() => setMode("idle")} onCreated={(u) => { setUrl(u); setMode("idle"); }} />}
    </>
  );
}

// Concept & Planning are chosen by you; Week-of / Live / Wrap are reached
// automatically based on the event date (not clickable).
const MANUAL_STAGES = 2; // indices 0,1 are self-determined

function MacroStepper({ eventId, initial, eventDate }: { eventId: string; initial: string | null; eventDate: string | null }) {
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

// ── One vendor decision (engagement) ───────────────────────────────────────────
// Vendor card — opened from a candidate row. Edit details, attach a link + notes,
// and see recent correspondence (auto-updates linked to this decision).
function VendorCardModal({ eventId, engagementId, candidate, onClose, onSaved }: {
  eventId: string;
  engagementId: string;
  candidate: VendorCandidate;
  onClose: () => void;
  onSaved: (f: Partial<VendorCandidate>) => void;
}) {
  const [name, setName] = useState(candidate.vendorName ?? "");
  const [quote, setQuote] = useState(candidate.quoteAmount?.toString() ?? "");
  const [link, setLink] = useState(candidate.link ?? "");
  const [note, setNote] = useState(candidate.note ?? "");
  const [corr, setCorr] = useState<EventUpdate[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [digest, setDigest] = useState<string | null>(null);
  const [digesting, setDigesting] = useState(false);

  const summarize = async () => {
    setDigesting(true);
    try {
      const s = await summarizeCorrespondence(eventId, engagementId);
      setDigest(s ?? "No summary — set ANTHROPIC_API_KEY to enable Claude digests.");
    } finally { setDigesting(false); }
  };

  useEffect(() => {
    let cancelled = false;
    listEventUpdates(eventId).then((u) => { if (!cancelled) setCorr(u.filter((x) => x.engagementId === engagementId)); }).catch(() => { if (!cancelled) setCorr([]); });
    return () => { cancelled = true; };
  }, [eventId, engagementId]);

  const dirty =
    (name.trim() || null) !== (candidate.vendorName ?? null) ||
    (quote.trim() === "" ? null : Number(quote)) !== (candidate.quoteAmount ?? null) ||
    (link.trim() || null) !== (candidate.link ?? null) ||
    (note.trim() || null) !== (candidate.note ?? null);

  const save = async () => {
    const fields = {
      vendorName: name.trim() || null,
      quoteAmount: quote.trim() === "" ? null : Number(quote),
      link: link.trim() || null,
      note: note.trim() || null,
    };
    setSaving(true);
    try { await updateCandidate(candidate.id, fields); onSaved(fields); onClose(); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl border border-border w-full max-w-md max-h-[85vh] overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-4">
          <div>
            <p className="text-[15px] text-gray-400 uppercase tracking-wide">Vendor</p>
            <h3 className="text-xl font-medium">{name || "Unnamed vendor"}</h3>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-gray-400 hover:text-gray-700"><X className="w-5 h-5" /></button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-[15px] text-gray-500 mb-1">Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className="w-full px-2 py-1.5 border border-border rounded text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
          </div>
          <div>
            <label className="block text-[15px] text-gray-500 mb-1">Quote (USD)</label>
            <input type="number" value={quote} onChange={(e) => setQuote(e.target.value)} placeholder="—" className="w-full px-2 py-1.5 border border-border rounded text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
          </div>
          <div>
            <label className="block text-[15px] text-gray-500 mb-1">Link</label>
            <div className="flex gap-2">
              <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="Site, quote, profile…" className="flex-1 px-2 py-1.5 border border-border rounded text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
              {link.trim() && <a href={link} target="_blank" rel="noreferrer" className="inline-flex items-center px-2 text-gray-500 hover:text-gray-900"><ExternalLink className="w-4 h-4" /></a>}
            </div>
            {(() => {
              const d = domainFromUrl(link);
              if (!d) return null;
              return isFreeMailDomain(d)
                ? <p className="text-[15px] text-amber-600 mt-1">@{d} is a shared mail provider — can't match a vendor by domain; emails won't auto-link.</p>
                : <p className="text-[15px] text-gray-400 mt-1">In range: emails from <span className="font-medium">@{d}</span> (any address) link to this decision.</p>;
            })()}
          </div>
          <div>
            <label className="block text-[15px] text-gray-500 mb-1">Vendor notes</label>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="Terms, contacts, context…" className="w-full px-2 py-1.5 border border-border rounded text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
          </div>
        </div>

        <div className="mt-5">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-medium">Recent correspondence</p>
            {corr && corr.length > 0 && (
              <button onClick={summarize} disabled={digesting} className="text-[15px] text-gray-600 hover:text-gray-900 inline-flex items-center gap-1 disabled:opacity-50">
                <Lightbulb className="w-3.5 h-3.5" /> {digesting ? "Summarizing…" : "Summarize"}
              </button>
            )}
          </div>
          {digest && <p className="text-sm text-gray-700 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 mb-2">{digest}</p>}
          {corr === null ? (
            <p className="text-sm text-gray-400">Loading…</p>
          ) : corr.length === 0 ? (
            <p className="text-sm text-gray-400">No linked emails or updates yet. Detected email/Linear activity for this decision shows here.</p>
          ) : (
            <div className="divide-y divide-gray-100 border border-gray-200 rounded-lg">
              {corr.map((u) => {
                const M = SOURCE_META[u.source] ?? SOURCE_META.manual;
                return (
                  <div key={u.id} className="px-3 py-2 flex items-start gap-2 text-sm">
                    <M.Icon className={`w-4 h-4 mt-0.5 shrink-0 ${M.cls}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-gray-700">{u.summary}</p>
                      <p className="text-[15px] text-gray-400">{M.label} · {relTime(u.createdAt)}{u.linkUrl && <> · <a href={u.linkUrl} target="_blank" rel="noreferrer" className="hover:text-gray-700 underline">source</a></>}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 mt-6 pt-4 border-t border-gray-100">
          <button onClick={onClose} className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900">Cancel</button>
          <button onClick={save} disabled={!dirty || saving} className="px-4 py-1.5 bg-gray-200 text-black rounded-lg text-sm hover:bg-gray-300 disabled:opacity-50">
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

// Advancing INTO these stages prompts for a comment/attachment first.
const PROMPTED_STAGES = new Set(["Selected", "Contracted"]);

function DecisionCard({ initial, eventId, location, onDelete, onChange }: { initial: EngagementWithCandidates; eventId: string; location?: string | null; onDelete: () => void; onChange?: (e: EngagementWithCandidates) => void }) {
  const [eng, setEng] = useState(initial);
  const [cardId, setCardId] = useState<string | null>(null); // candidate whose vendor card is open
  // "See suggested" — pulls from the vendor database (not yet populated), ranked by location.
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<VendorSuggestion[] | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  useEffect(() => { onChange?.(eng); /* keep the parent (chart view) in sync */ /* eslint-disable-next-line */ }, [eng]);
  const [candName, setCandName] = useState("");
  const [candQuote, setCandQuote] = useState("");
  const [candLink, setCandLink] = useState("");
  const [addingCand, setAddingCand] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<string | null>(null); // stage we're advancing into
  const [comment, setComment] = useState("");
  const [attach, setAttach] = useState("");

  const stageIdx = ENGAGEMENT_STAGES.indexOf((eng.stage ?? "") as any);
  const selected = eng.candidates.find((c) => c.isSelected) ?? null;
  const contracted = eng.stage === "Contracted";
  const next = ENGAGEMENT_STAGES[stageIdx + 1];
  const prev = ENGAGEMENT_STAGES[stageIdx - 1];

  const patchCand = (id: string, f: Partial<VendorCandidate>) =>
    setEng((e) => ({ ...e, candidates: e.candidates.map((c) => (c.id === id ? { ...c, ...f } : c)) }));

  const addCand = async () => {
    const name = candName.trim();
    const link = candLink.trim();
    if (!name || !link) return; // info (a link) is required
    const quote = candQuote.trim() === "" ? null : Number(candQuote);
    const c = await addCandidate(eng.id, name, quote, link);
    setEng((e) => ({ ...e, candidates: [...e.candidates, c] }));
    setCandName(""); setCandQuote(""); setCandLink(""); setAddingCand(false);
  };
  const removeCand = async (id: string) => {
    await deleteCandidate(id);
    setEng((e) => ({ ...e, candidates: e.candidates.filter((c) => c.id !== id) }));
  };
  const pick = async (id: string) => {
    const wasSelected = eng.candidates.find((c) => c.id === id)?.isSelected;
    if (wasSelected) {
      await clearCandidateSelection(eng.id);
      setEng((e) => ({ ...e, candidates: e.candidates.map((c) => ({ ...c, isSelected: false })) }));
    } else {
      await selectCandidate(eng.id, id);
      setEng((e) => ({ ...e, candidates: e.candidates.map((c) => ({ ...c, isSelected: c.id === id })) }));
    }
  };

  const advance = () => {
    if (!next) return;
    setNotice(null);
    if (PROMPTED_STAGES.has(next)) {
      if (!selected) { setNotice(`Select a candidate before moving to ${next}.`); return; }
      setComment(""); setAttach(""); setPrompt(next);
      return;
    }
    void setEngagementStage(eng.id, next);
    setEng((e) => ({ ...e, stage: next }));
  };
  const confirmPrompt = async () => {
    if (!prompt || !selected) return;
    const note = comment.trim() || null;
    const docUrl = attach.trim() || null;
    const lock = prompt === "Contracted";
    await setEngagementStage(eng.id, prompt, { note, docUrl, ...(lock ? { confirmedAmount: selected.quoteAmount } : {}) });
    setEng((e) => ({ ...e, stage: prompt, note, ...(lock ? { confirmedAmount: selected.quoteAmount } : {}) }));
    setPrompt(null); setComment(""); setAttach("");
  };
  const revert = async () => {
    if (!prev) return;
    const leavingContracted = eng.stage === "Contracted";
    await setEngagementStage(eng.id, prev, leavingContracted ? { confirmedAmount: null } : undefined);
    setEng((e) => ({ ...e, stage: prev, ...(leavingContracted ? { confirmedAmount: null } : {}) }));
  };

  const seeSuggested = async () => {
    const next = !suggestOpen;
    setSuggestOpen(next);
    if (next && suggestions === null) {
      setSuggesting(true);
      try { setSuggestions(await suggestVendors(eng.category, location ?? null)); }
      finally { setSuggesting(false); }
    }
  };
  // Add a suggested vendor as a candidate on this decision.
  const addSuggestion = async (s: VendorSuggestion) => {
    const c = await addCandidate(eng.id, s.name, null, s.link ?? s.note ?? s.location ?? "—");
    setEng((e) => ({ ...e, candidates: [...e.candidates, c] }));
    setSuggestions((prev) => (prev ? prev.filter((x) => x.id !== s.id) : prev));
  };

  return (
    <div className="bg-white rounded-2xl border border-border p-5">
      <div className="flex items-start justify-between mb-3">
        <div>
          <p className="text-lg font-medium">{eng.category ?? "Uncategorized"}</p>
          {contracted && (
            <p className="text-sm text-gray-600">
              Confirmed: <span className="font-medium">{money(eng.confirmedAmount)}</span>
              {selected?.vendorName ? ` · ${selected.vendorName}` : ""}
            </p>
          )}
        </div>
        <button onClick={onDelete} className="text-gray-400 hover:text-red-600" aria-label="Delete decision"><Trash2 className="w-4 h-4" /></button>
      </div>

      {/* Stage pipeline */}
      <div className="flex items-center gap-1 flex-wrap mb-3">
        {prev && (
          <button onClick={revert} aria-label="Back a stage" title="Move back a stage" className="w-5 h-5 mr-0.5 rounded-full border border-gray-300 flex items-center justify-center text-gray-500 hover:text-gray-900 hover:bg-gray-50 shrink-0">
            <ChevronLeft className="w-3 h-3" />
          </button>
        )}
        {ENGAGEMENT_STAGES.map((s, i) => (
          <span key={s} className={`px-2 py-0.5 rounded-full text-[15px] ${
            i < stageIdx ? "bg-gray-100 text-gray-500"
              : i === stageIdx ? "bg-gray-900 text-white"
              : "bg-white text-gray-400 border border-gray-200"
          }`}>{s}</span>
        ))}
        {next && (
          <button onClick={advance} className="ml-1 inline-flex items-center gap-1 text-[15px] text-gray-700 hover:text-gray-900 border border-gray-300 rounded-full px-2 py-0.5 hover:bg-gray-50">
            Advance <ChevronRight className="w-3 h-3" />
          </button>
        )}
      </div>

      {notice && <p className="text-[15px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 mb-2">{notice}</p>}
      {prompt && selected && (
        <div className="text-sm bg-gray-50 border border-border rounded-lg px-3 py-2 mb-3">
          {prompt === "Contracted"
            ? <>Lock <span className="font-medium">{selected.vendorName}</span>’s {money(selected.quoteAmount)} as the confirmed cost. Add a comment or attachment:</>
            : <>Marking <span className="font-medium">{selected.vendorName}</span> as selected. Add a comment or attachment:</>}
          <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2} placeholder="Comment (why this vendor, terms, next steps…)" className="w-full mt-2 px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
          <div className="flex items-center gap-2 mt-2">
            <input value={attach} onChange={(e) => setAttach(e.target.value)} placeholder="Attachment URL (quote, contract…)" className="flex-1 px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
            <FileDrop compact label="drop file" onUploaded={(url) => setAttach(url)} />
          </div>
          <div className="flex gap-2 mt-2">
            <button onClick={confirmPrompt} disabled={!comment.trim() && !attach.trim()} className="px-3 py-1 bg-gray-200 rounded hover:bg-gray-300 text-sm disabled:opacity-50">
              {prompt === "Contracted" ? "Confirm & lock" : "Confirm"}
            </button>
            <button onClick={() => setPrompt(null)} className="px-3 py-1 text-sm text-gray-600 hover:text-gray-900">Cancel</button>
          </div>
          <p className="text-[15px] text-gray-400 mt-1">A comment or an attachment is required.</p>
        </div>
      )}

      {/* Candidates */}
      <div className="rounded-lg border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500">
            <tr>
              <th className="text-left px-3 py-2 font-normal w-8"></th>
              <th className="text-left px-3 py-2 font-normal">Vendor</th>
              <th className="text-right px-3 py-2 font-normal">Quote</th>
              <th className="px-3 py-2 w-8"></th>
            </tr>
          </thead>
          <tbody>
            {eng.candidates.length === 0 && (
              <tr><td colSpan={4} className="px-3 py-2 text-gray-400">No candidates yet.</td></tr>
            )}
            {eng.candidates.map((c) => (
              <tr
                key={c.id}
                onClick={() => setCardId(c.id)}
                className={`border-t border-gray-100 cursor-pointer hover:bg-gray-50 ${c.isSelected ? "bg-green-50 hover:bg-green-50" : ""}`}
                title="Open vendor card"
              >
                <td className="px-3 py-2 text-center">
                  <button onClick={(e) => { e.stopPropagation(); pick(c.id); }} aria-label="Select candidate" className={`w-4 h-4 rounded-full border flex items-center justify-center ${c.isSelected ? "bg-green-600 border-green-600" : "border-gray-300 hover:border-gray-500"}`}>
                    {c.isSelected && <Check className="w-3 h-3 text-white" />}
                  </button>
                </td>
                <td className="px-3 py-2">
                  <span className="inline-flex items-center gap-1.5">
                    {c.vendorName ?? <span className="text-gray-400">Unnamed</span>}
                    {c.link && <ExternalLink className="w-3 h-3 text-gray-400" />}
                  </span>
                </td>
                <td className="px-3 py-2 text-right">{c.quoteAmount != null ? money(c.quoteAmount) : <span className="text-gray-300">—</span>}</td>
                <td className="px-3 py-2 text-center">
                  <button onClick={(e) => { e.stopPropagation(); removeCand(c.id); }} className="text-gray-300 hover:text-red-600" aria-label="Remove candidate"><Trash2 className="w-3.5 h-3.5" /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Add candidate — fields appear only after clicking; name + a link are required. */}
      {addingCand ? (
        <div className="mt-3 space-y-2 bg-gray-50 border border-gray-200 rounded-lg p-2">
          <div className="flex gap-2">
            <input autoFocus value={candName} onChange={(e) => setCandName(e.target.value)} placeholder="Vendor name" className="flex-1 px-2 py-1 border border-border rounded text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
            <input value={candQuote} onChange={(e) => setCandQuote(e.target.value)} type="number" placeholder="Quote" className="w-24 px-2 py-1 border border-border rounded text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
          </div>
          <input value={candLink} onChange={(e) => setCandLink(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addCand(); }} placeholder="Link / info (required) — site, quote, profile…" className="w-full px-2 py-1 border border-border rounded text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
          <div className="flex gap-2">
            <button onClick={addCand} disabled={!candName.trim() || !candLink.trim()} className="px-3 py-1 bg-gray-200 rounded text-sm hover:bg-gray-300 disabled:opacity-50">Add vendor</button>
            <button onClick={() => { setAddingCand(false); setCandName(""); setCandQuote(""); setCandLink(""); }} className="px-3 py-1 text-sm text-gray-600 hover:text-gray-900">Cancel</button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex items-center gap-4">
          <button onClick={() => setAddingCand(true)} className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900">
            <Plus className="w-4 h-4" /> Add vendor
          </button>
          <button onClick={seeSuggested} className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900">
            <Lightbulb className="w-4 h-4" /> {suggestOpen ? "Hide suggested" : "See suggested"}
          </button>
        </div>
      )}

      {suggestOpen && (
        <div className="mt-2 bg-gray-50 border border-gray-200 rounded-lg p-2 text-sm">
          {suggesting ? (
            <p className="text-gray-400">Finding {eng.category ?? "vendors"}{location ? ` near ${location}` : ""}…</p>
          ) : suggestions && suggestions.length > 0 ? (
            <ul className="divide-y divide-gray-200">
              {suggestions.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-2 py-1.5">
                  <span className="min-w-0">
                    <span className="font-medium">{s.name}</span>
                    {s.location && <span className="text-gray-400"> · {s.location}</span>}
                  </span>
                  <button onClick={() => addSuggestion(s)} className="shrink-0 inline-flex items-center gap-1 text-gray-600 hover:text-gray-900"><Plus className="w-3.5 h-3.5" /> Add</button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-gray-400">
              No vendor suggestions{location ? ` for ${location}` : ""} yet — our vendor database isn’t set up.
            </p>
          )}
        </div>
      )}

      {cardId && (() => {
        const c = eng.candidates.find((x) => x.id === cardId);
        return c ? (
          <VendorCardModal eventId={eventId} engagementId={eng.id} candidate={c} onClose={() => setCardId(null)} onSaved={(f) => patchCand(c.id, f)} />
        ) : null;
      })()}
    </div>
  );
}

function VendorDecisions({ eventId, location, initial }: { eventId: string; location?: string | null; initial: EngagementWithCandidates[] }) {
  const [engs, setEngs] = useState(initial);
  const [newCat, setNewCat] = useState("");
  const [view, setView] = useState<"cards" | "chart">("cards");

  const add = async () => {
    const cat = newCat.trim();
    if (!cat) return;
    const e = await addEngagement(eventId, cat);
    setEngs((p) => [...p, e]);
    setNewCat("");
  };
  const remove = async (id: string) => {
    await deleteEngagement(id);
    setEngs((p) => p.filter((e) => e.id !== id));
  };
  const updateEng = (u: EngagementWithCandidates) => setEngs((p) => p.map((e) => (e.id === u.id ? u : e)));

  const stageIdx = (s: string | null) => ENGAGEMENT_STAGES.indexOf((s ?? "") as any);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        {engs.length === 0 ? <p className="text-sm text-gray-400">No vendors yet — add one below.</p> : <span />}
        <div className="flex items-center gap-1 bg-white border border-gray-300 rounded-lg p-1">
          <button onClick={() => setView("cards")} className={`p-1.5 rounded ${view === "cards" ? "bg-gray-100" : "hover:bg-gray-50"}`} title="Cards"><LayoutGrid className="w-4 h-4" /></button>
          <button onClick={() => setView("chart")} className={`p-1.5 rounded ${view === "chart" ? "bg-gray-100" : "hover:bg-gray-50"}`} title="Chart"><List className="w-4 h-4" /></button>
        </div>
      </div>

      {view === "cards" ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {engs.map((e) => <DecisionCard key={e.id} initial={e} eventId={eventId} location={location} onDelete={() => remove(e.id)} onChange={updateEng} />)}
        </div>
      ) : engs.length > 0 && (
        <div className="bg-white rounded-2xl border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 border-b border-border">
              <tr>
                <th className="text-left px-4 py-2 font-normal">Decision</th>
                <th className="text-left px-4 py-2 font-normal">Stage</th>
                <th className="text-left px-4 py-2 font-normal">Candidates</th>
                <th className="text-left px-4 py-2 font-normal">Selected</th>
                <th className="text-right px-4 py-2 font-normal">Amount</th>
                <th className="px-4 py-2 w-8"></th>
              </tr>
            </thead>
            <tbody>
              {engs.map((e) => {
                const sel = e.candidates.find((c) => c.isSelected);
                const amount = e.stage === "Contracted" ? e.confirmedAmount : sel?.quoteAmount ?? null;
                const idx = stageIdx(e.stage);
                return (
                  <tr key={e.id} className="border-b border-gray-100">
                    <td className="px-4 py-2 font-medium">{e.category ?? "—"}</td>
                    <td className="px-4 py-2">
                      <span className={`px-2 py-0.5 rounded-full text-[15px] ${e.stage === "Contracted" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"}`}>{e.stage ?? "—"}</span>
                      {idx >= 0 && <span className="text-[15px] text-gray-400 ml-2">{idx + 1}/{ENGAGEMENT_STAGES.length}</span>}
                    </td>
                    <td className="px-4 py-2 text-gray-600">{e.candidates.length}</td>
                    <td className="px-4 py-2">{sel?.vendorName ?? <span className="text-gray-300">—</span>}</td>
                    <td className="px-4 py-2 text-right">{amount != null ? money(amount) : <span className="text-gray-300">—</span>}</td>
                    <td className="px-4 py-2 text-center"><button onClick={() => remove(e.id)} className="text-gray-300 hover:text-red-600" aria-label="Delete"><Trash2 className="w-3.5 h-3.5" /></button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="px-4 py-2 text-[15px] text-gray-400">Switch to Cards to edit a decision, advance stages, or add candidates.</p>
        </div>
      )}

      <div className="flex gap-2">
        <input value={newCat} onChange={(e) => setNewCat(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add(); }} placeholder="New decision category (e.g. Venue, Catering, A/V)" className="flex-1 px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
        <button onClick={add} disabled={!newCat.trim()} className="inline-flex items-center gap-1 px-3 py-2 bg-gray-200 rounded-lg text-sm hover:bg-gray-300 disabled:opacity-50"><Plus className="w-4 h-4" /> Add decision</button>
      </div>
    </div>
  );
}

// ── Budget tracker ──────────────────────────────────────────────────────────
const BUDGET_STATUS_META: Record<BudgetStatus, { label: string; badge: string; ring: string }> = {
  estimate:  { label: "Estimate",  badge: "bg-gray-100 text-gray-600",   ring: "ring-gray-300" },
  quoted:    { label: "Quoted",    badge: "bg-blue-100 text-blue-700",   ring: "ring-blue-400" },
  in_review: { label: "In review", badge: "bg-amber-100 text-amber-700", ring: "ring-amber-400" },
  paid:      { label: "Paid",      badge: "bg-green-100 text-green-700", ring: "ring-green-400" },
};

/** Click-into-category detail: edit label/amount, move status, attach material, and add a
 *  web address whose email updates feed the general updates + progress areas. */
function BudgetLineModal({ eventId, line, onClose, onChange }: {
  eventId: string;
  line: BudgetLineTracker;
  onClose: () => void;
  onChange: (f: Partial<BudgetLineTracker>) => void;
}) {
  const [label, setLabel] = useState(line.label ?? "");
  const [amount, setAmount] = useState(line.confirmedAmount != null ? String(line.confirmedAmount) : "");
  const [note, setNote] = useState(line.note ?? "");
  const [editingNote, setEditingNote] = useState(false);
  const [sync, setSync] = useState(line.syncUrl ?? "");
  const [savingSync, setSavingSync] = useState(false);
  const hasNote = !!(line.note && line.note.trim());
  const postNote = async () => { const n = note.trim() || null; onChange({ note: n }); setEditingNote(false); await updateBudgetLine(line.id, { note: n }); };
  const deleteNote = async () => { setNote(""); setEditingNote(false); onChange({ note: null }); await updateBudgetLine(line.id, { note: null }); };

  const saveMeta = async () => {
    const amt = amount.trim() === "" ? null : Number(amount);
    onChange({ label: label.trim() || null, confirmedAmount: amt });
    await updateBudgetLine(line.id, { label: label.trim(), amount: amt });
  };
  const setStatus = async (s: BudgetStatus) => { onChange({ status: s }); await setBudgetStatus(line.id, s); };
  const setDoc = async (url: string | null) => { onChange({ docUrl: url }); await attachLineDoc(line.id, url); };
  const saveSync = async () => {
    const url = sync.trim() || null;
    setSavingSync(true);
    try {
      onChange({ syncUrl: url });
      await setBudgetSyncUrl(line.id, url);
      // Surface in the general updates feed (and, once email sync ships, auto-updates land here).
      if (url) await recordEventUpdate(eventId, { source: "manual", summary: `Budget · ${label.trim() || "line"}: linked for email updates`, detail: null, linkUrl: url });
    } finally { setSavingSync(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl border border-border max-w-lg w-full max-h-[85vh] overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl">Budget line</h2>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-900" aria-label="Close"><X className="w-5 h-5" /></button>
        </div>

        <div className="space-y-4">
          <div className="flex gap-2">
            <input value={label} onChange={(e) => setLabel(e.target.value)} onBlur={saveMeta} placeholder="Category" className="flex-1 px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
            <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} onBlur={saveMeta} placeholder="Amount" className="w-32 px-3 py-2 text-right border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
          </div>

          <div>
            <p className="text-sm font-medium mb-1.5">Status</p>
            <div className="flex flex-wrap gap-1.5">
              {BUDGET_STATUSES.map((s) => (
                <button key={s} onClick={() => setStatus(s)} className={`px-3 py-1 rounded-full text-sm border ${line.status === s ? "bg-gray-900 text-white border-gray-900" : `border-gray-200 hover:border-gray-400 ${BUDGET_STATUS_META[s].badge}`}`}>
                  {BUDGET_STATUS_META[s].label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="text-sm font-medium mb-1.5">Update / comment</p>
            {hasNote && !editingNote ? (
              <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm">
                <p className="inline-flex items-start gap-1.5 text-gray-700"><MessageSquare className="w-3.5 h-3.5 mt-0.5 text-gray-400 shrink-0" /> {line.note}</p>
                <div className="flex gap-3 mt-1.5 text-[15px]">
                  <button onClick={() => { setNote(line.note ?? ""); setEditingNote(true); }} className="text-gray-500 hover:text-gray-900 inline-flex items-center gap-1"><Pencil className="w-3 h-3" /> Edit</button>
                  <button onClick={deleteNote} className="text-gray-500 hover:text-red-600 inline-flex items-center gap-1"><Trash2 className="w-3 h-3" /> Delete</button>
                </div>
              </div>
            ) : (
              <>
                <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="e.g. Venue sent contract, waiting on signed copy…" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-gray-300" />
                <div className="flex justify-end gap-2 mt-1.5">
                  {editingNote && <button onClick={() => { setNote(line.note ?? ""); setEditingNote(false); }} className="text-[15px] text-gray-500 hover:text-gray-900">Cancel</button>}
                  <button onClick={postNote} disabled={!note.trim()} className="px-3 py-1 bg-gray-900 text-white rounded text-[15px] hover:bg-gray-800 disabled:opacity-40">{editingNote ? "Save" : "Post update"}</button>
                </div>
              </>
            )}
          </div>

          <div>
            <p className="text-sm font-medium mb-1.5">Material</p>
            {line.docUrl ? (
              <span className="inline-flex items-center gap-3 text-sm">
                <a href={line.docUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-gray-700 hover:text-gray-900"><Paperclip className="w-4 h-4" /> View attachment</a>
                <button onClick={() => setDoc(null)} className="text-gray-400 hover:text-red-600 text-[15px]">remove</button>
              </span>
            ) : (
              <FileDrop label="Attach a quote / invoice / contract" onUploaded={(url) => setDoc(url)} />
            )}
          </div>

          <div>
            <p className="text-sm font-medium mb-1.5">Sync from email</p>
            <div className="flex gap-2">
              <input value={sync} onChange={(e) => setSync(e.target.value)} placeholder="Vendor portal / quote thread URL" className="flex-1 px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
              <button onClick={saveSync} disabled={savingSync || sync.trim() === (line.syncUrl ?? "")} className="px-3 py-2 bg-gray-200 rounded-lg text-sm hover:bg-gray-300 disabled:opacity-50">{savingSync ? "Saving…" : "Save"}</button>
            </div>
            <p className="text-[15px] text-gray-400 mt-1.5 inline-flex items-start gap-1"><Mail className="w-3.5 h-3.5 mt-0.5 shrink-0" /> Replies on this thread will auto-log to this line and flow into the event's updates & progress (once email sync ships).</p>
          </div>
        </div>

        <div className="flex justify-end mt-6 pt-4 border-t border-gray-100">
          <button onClick={onClose} className="px-4 py-2 bg-gray-200 rounded-lg text-sm hover:bg-gray-300">Done</button>
        </div>
      </div>
    </div>
  );
}

function BudgetTracker({ budget, eventId }: { budget: PlanningBudget; eventId: string }) {
  // A confirmed (assigned) scoping budget seeds the target when none is set yet.
  const assignedBudget = loadScoping(eventId).assignedBudget;
  const seedTarget = budget.targetAmount ?? assignedBudget;
  const [lines, setLines] = useState(budget.lines);
  const [target, setTarget] = useState<number | null>(seedTarget);
  const [targetInput, setTargetInput] = useState(seedTarget != null ? String(seedTarget) : "");
  const [filter, setFilter] = useState<"all" | BudgetStatus>("all");

  // Persist the assigned-budget seed so the rest of the app sees the same target.
  useEffect(() => {
    if (budget.targetAmount == null && assignedBudget != null) void setBudgetTarget(budget.id, assignedBudget);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [newLabel, setNewLabel] = useState("");
  const [newAmount, setNewAmount] = useState("");
  const [dropFile, setDropFile] = useState<File | null>(null);
  const [importNote, setImportNote] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null); // budget line whose detail card is open
  const cur = budget.currency;

  // "committed" = anything past a raw estimate; used against the target.
  const committed = lines.filter((l) => l.status !== "estimate").reduce((s, l) => s + (l.confirmedAmount ?? 0), 0);
  const sumFor = (st: BudgetStatus) => lines.filter((l) => l.status === st).reduce((s, l) => s + (l.confirmedAmount ?? 0), 0);

  const shown = lines.filter((l) => filter === "all" || l.status === filter);

  const patch = (id: string, f: Partial<BudgetLineTracker>) => setLines((p) => p.map((l) => (l.id === id ? { ...l, ...f } : l)));
  const setStatus = async (id: string, s: BudgetStatus) => {
    const prev = lines.find((l) => l.id === id)?.status;
    patch(id, { status: s });
    await setBudgetStatus(id, s);
    // Moving a line off a raw estimate into "quoted" → open its detail to log the update.
    if (prev === "estimate" && s === "quoted") setOpenId(id);
  };
  const [pendingLine, setPendingLine] = useState<{ label: string; amount: number | null } | null>(null); // awaiting "is this a vendor?" answer
  const askAddLine = () => {
    const label = newLabel.trim();
    if (!label) return;
    setPendingLine({ label, amount: newAmount.trim() === "" ? null : Number(newAmount) });
  };
  // "No" → just a budget line. "Yes" → also create a vendor decision (which itself creates the linked line).
  const confirmAddLine = async (asVendor: boolean) => {
    if (!pendingLine) return;
    const { label, amount } = pendingLine;
    setPendingLine(null); setNewLabel(""); setNewAmount("");
    if (asVendor) {
      await addEngagement(eventId, label, amount); // creates engagement + linked budget line
      setLines(await listBudgetLines(budget.id));
    } else {
      const l = await addTrackerLine(budget.id, label, amount);
      setLines((p) => [...p, l]);
    }
  };
  const removeLine = async (id: string) => {
    setLines((p) => p.filter((l) => l.id !== id)); // optimistic
    if (openId === id) setOpenId(null);
    await deleteBudgetLine(id).catch(() => {});
  };
  const saveTarget = async (v: string) => { const n = v.trim() === "" ? null : Number(v); setTarget(n); await setBudgetTarget(budget.id, n); };

  const tiles = BUDGET_STATUSES.map((st) => ({ label: BUDGET_STATUS_META[st].label, value: sumFor(st), ring: BUDGET_STATUS_META[st].ring }));
  const openLine = lines.find((l) => l.id === openId) ?? null;

  // Variance: total amount put down vs the target. Green while comfortably under, yellow
  // within 10% of target, red once 10%+ over.
  const total = lines.reduce((s, l) => s + (l.confirmedAmount ?? 0), 0);
  const varState: "none" | "under" | "near" | "over" =
    target == null ? "none" : total >= target * 1.1 ? "over" : total >= target * 0.9 ? "near" : "under";
  const varText = { none: "text-gray-300", under: "text-green-700", near: "text-yellow-700", over: "text-red-700" }[varState];
  const overTarget = target != null && total > target;

  return (
    <BudgetDropArea onFile={setDropFile} className="bg-white rounded-2xl border border-border p-6">
      {importNote && <p className="text-[15px] text-gray-500 inline-flex items-center gap-1 mb-3"><Check className="w-3.5 h-3.5 text-green-600" /> {importNote}</p>}
      {lines.length === 0 ? (
        <BudgetDropZone label="Drop a budget breakdown (CSV) here, or click to choose" onFile={setDropFile} className="w-full min-h-[5rem] mb-5" />
      ) : (
        <div className="flex justify-end mb-4">
          <BudgetDropZone label="Drop or choose a breakdown" onFile={setDropFile} className="shrink-0" />
        </div>
      )}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 mb-5">
        {tiles.map((t) => (
          <StatCard key={t.label} label={t.label} value={money(t.value, cur)} />
        ))}
        {/* vs target — variance of total put down against the set target; keeps the
            green/yellow/red ring + over/below sublabel as the variance signal. */}
        <StatCard
          label="vs target"
          value={target == null ? <span className="text-gray-300">—</span> : <>{money(total, cur)} <span className="text-sm text-muted-foreground">total</span></>}
          sub={target != null && (
            <span className={`inline-flex items-center gap-0.5 ${varText}`}>
              {overTarget ? <ArrowUp className="w-3.5 h-3.5" /> : <ArrowDown className="w-3.5 h-3.5" />}
              {money(Math.abs(target - total), cur)} {overTarget ? "over budget" : "below budget"}
            </span>
          )}
        />
      </div>

      {dropFile && (
        <BudgetImportModal
          budget={{ ...budget, lines }}
          currency={cur}
          file={dropFile}
          onClose={() => setDropFile(null)}
          onApplied={async (note) => { setDropFile(null); setImportNote(note); setLines(await listBudgetLines(budget.id)); }}
        />
      )}

      {openLine && (
        <BudgetLineModal
          eventId={eventId}
          line={openLine}
          onClose={() => setOpenId(null)}
          onChange={(f) => patch(openLine.id, f)}
        />
      )}

      <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
        <div className="flex items-center gap-1 flex-wrap">
          {(["all", ...BUDGET_STATUSES] as const).map((f) => (
            <button key={f} onClick={() => setFilter(f)} className={`px-3 py-1 rounded-full text-sm border ${filter === f ? "bg-gray-900 text-white border-gray-900" : "bg-white text-gray-600 border-gray-200 hover:border-gray-400"}`}>
              {f === "all" ? "All" : BUDGET_STATUS_META[f].label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-gray-500">Target</span>
          <input
            type="number"
            value={targetInput}
            onChange={(e) => setTargetInput(e.target.value)}
            onBlur={(e) => saveTarget(e.target.value)}
            placeholder="—"
            style={{ width: `${Math.max(9, targetInput.length + 4)}ch` }}
            className="px-2 py-1 border border-border rounded text-right focus:outline-none focus:ring-2 focus:ring-gray-300"
          />
          {target != null && (
            <span className={committed > target ? "text-red-600" : "text-gray-500"}>
              {committed > target ? `${money(committed - target, cur)} over` : `${money(target - committed, cur)} left`}
            </span>
          )}
        </div>
      </div>

      <div className="rounded-lg border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500">
            <tr>
              <th className="text-left px-3 py-2 font-normal">Line</th>
              <th className="text-right px-3 py-2 font-normal">Amount</th>
              <th className="text-left px-3 py-2 font-normal">Status</th>
              <th className="px-3 py-2 font-normal text-right">Links</th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && <tr><td colSpan={4} className="px-3 py-3 text-gray-400">No lines.</td></tr>}
            {shown.map((l) => (
              <tr key={l.id} className="border-t border-gray-100 hover:bg-gray-50 cursor-pointer" onClick={() => setOpenId(l.id)} title="Open details">
                <td className="px-3 py-2">{l.label}</td>
                <td className="px-3 py-2 text-right">{money(l.confirmedAmount, cur)}</td>
                <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                  <Select value={l.status} onValueChange={(v) => setStatus(l.id, v as BudgetStatus)} items={BUDGET_STATUSES.map((s) => ({ value: s, label: BUDGET_STATUS_META[s].label }))}>
                    <SelectTrigger size="sm" className={`border-0 ${BUDGET_STATUS_META[l.status].badge}`}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {BUDGET_STATUSES.map((s) => <SelectItem key={s} value={s}>{BUDGET_STATUS_META[s].label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </td>
                <td className="px-3 py-2 text-right whitespace-nowrap text-gray-400">
                  <span className="inline-flex items-center gap-2 justify-end group/row">
                    {l.note && l.note.trim() && <MessageSquare className="w-3.5 h-3.5 text-gray-500" />}
                    {l.docUrl && <Paperclip className="w-3.5 h-3.5" />}
                    {l.syncUrl && <Link2 className="w-3.5 h-3.5" />}
                    <button onClick={(e) => { e.stopPropagation(); removeLine(l.id); }} className="text-gray-300 hover:text-red-600" aria-label="Delete line"><Trash2 className="w-3.5 h-3.5" /></button>
                    <ChevronRight className="w-3.5 h-3.5" />
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex gap-2 mt-3">
        <input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") askAddLine(); }} placeholder="Add line (e.g. Marketing)" className="flex-1 px-2 py-1 border border-border rounded text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
        <input value={newAmount} onChange={(e) => setNewAmount(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") askAddLine(); }} type="number" placeholder="Amount" className="w-28 px-2 py-1 border border-border rounded text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
        <button onClick={askAddLine} disabled={!newLabel.trim()} className="px-3 py-1 bg-gray-200 rounded text-sm hover:bg-gray-300 disabled:opacity-50">Add line</button>
      </div>
      {pendingLine && (
        <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
          <span className="text-gray-700">Is <span className="font-medium">{pendingLine.label}</span> an external vendor cost?</span>
          <span className="flex items-center gap-2 ml-auto">
            <button onClick={() => confirmAddLine(true)} className="px-2.5 py-1 bg-gray-900 text-white rounded text-[15px] hover:bg-gray-800">Yes — add a vendor</button>
            <button onClick={() => confirmAddLine(false)} className="px-2.5 py-1 bg-white border border-gray-300 rounded text-[15px] hover:bg-gray-50">No — just a budget line</button>
            <button onClick={() => setPendingLine(null)} className="text-gray-400 hover:text-gray-700" aria-label="Cancel"><X className="w-4 h-4" /></button>
          </span>
        </div>
      )}
      {pendingLine && <p className="text-[15px] text-gray-400 mt-1">“Yes” also adds it to the Vendors tab (track quotes &amp; outreach there); “No” keeps it budget-only.</p>}

      <p className="text-[15px] text-gray-400 mt-4 flex items-start gap-1">
        <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
        Projected view (predicted cost per category from comparable past events) needs more budget history — coming later.
      </p>
    </BudgetDropArea>
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

function Deliverables({ eventId, initial, phases, jumpId, linearProjectUrl, onLinearSynced }: { eventId: string; initial: Deliverable[]; phases: EventPhase[]; jumpId?: string | null; linearProjectUrl?: string | null; onLinearSynced?: () => void }) {
  const [items, setItems] = useState(initial);
  const [adding, setAdding] = useState<string | null>(null); // phase being added to
  const [title, setTitle] = useState("");
  const [owner, setOwner] = useState("");
  const [due, setDueInput] = useState("");
  const [activePhase, setActivePhase] = useState<string | null>(null);
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
  const baseNames = railPhases.map((p) => p.name);
  const otherPhases = Array.from(new Set(items.map((d) => d.phase).filter((p): p is string => !!p && !baseNames.includes(p))));
  const phaseGroups = [...baseNames, ...otherPhases];
  const jumpToGroup = (name: string) => { setActivePhase(name); groupRefs.current[name]?.scrollIntoView({ behavior: "smooth", block: "start" }); };
  // Per-phase completion (done deliverables / total) — drives the rail's segment fills + check-offs.
  const railProgress: Record<string, number> = {};
  for (const rp of railPhases) {
    const grp = items.filter((d) => d.phase === rp.name);
    railProgress[rp.name] = grp.length ? grp.filter((d) => d.status === "Done").length / grp.length : 0;
  }
  const railOffs = railPhases.flatMap((p) => [p.start, p.end]).filter((n): n is number => n != null);
  const railUseTime = railPhases.filter((p) => p.start != null).length >= 2;
  // Measure the combined sticky header (rail + bulk bar) so a jumped-to group lands just below it.
  const stickyRef = useRef<HTMLDivElement | null>(null);
  const anchorRef = useRef<HTMLDivElement | null>(null); // timeline's original (un-stuck) position
  const [headerH, setHeaderH] = useState(96);
  useEffect(() => {
    const el = stickyRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHeaderH(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, [railPhases.length, total]);

  // Drag-to-reorder deliverables within a phase. T-offsets are predetermined, so reordering is a
  // manual arrangement only — it does NOT change any task's time.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const a = items.find((d) => d.id === active.id);
    const o = items.find((d) => d.id === over.id);
    if (!a || !o || a.phase !== o.phase) return; // within a phase only
    setItems((prev) => {
      const ids = prev.filter((d) => d.phase === a.phase).map((d) => d.id);
      const reordered = arrayMove(ids, ids.indexOf(a.id), ids.indexOf(o.id));
      const byId = new Map(prev.map((d) => [d.id, d]));
      const q = [...reordered];
      return prev.map((d) => (d.phase === a.phase ? byId.get(q.shift()!)! : d)); // refill phase slots in the new order
    });
  };

  return (
    <div className="bg-white rounded-2xl border border-border p-6">
      {/* Timeline header + progress scroll away; the rail and bulk-select bar pin together below
          as ONE sticky header with a single bottom divider (no double line). */}
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          {railPhases.length > 0 && <h3 className="text-sm font-medium text-gray-700 shrink-0">Timeline</h3>}
          {railPhases.length > 0 && railUseTime && railOffs.length > 0 && <span className="text-[15px] text-gray-400 truncate">{railLabel(Math.min(...railOffs, 0), Math.max(...railOffs, 0))} · click a phase to jump</span>}
        </div>
        <LinearSync eventId={eventId} projectUrl={linearProjectUrl} count={total} onSynced={onLinearSynced} />
      </div>
      <div className="flex items-center justify-between mb-1">
        <p className="text-sm text-gray-600">{done}/{total} done</p>
        <p className={`text-sm ${pct >= 100 ? "text-green-600" : "text-gray-600"}`}>{pct}%</p>
      </div>
      <div className="h-2 bg-gray-100 rounded-full mb-4 overflow-hidden">
        <div className={`h-full rounded-full transition-all ${pct >= 100 ? "bg-gradient-to-r from-green-400 to-green-600" : "bg-gradient-to-r from-gray-400 to-gray-900"}`} style={{ width: `${pct}%` }} />
      </div>

      {/* Anchor marking the timeline's natural position — clicking the bar jumps back here. */}
      <div ref={anchorRef} className="h-0 scroll-mt-4" />
      {/* Combined sticky header: timeline rail + bulk-select bar share one bottom divider. */}
      <div ref={stickyRef} className="sticky top-0 z-30 -mx-6 mb-4 bg-white border-b border-gray-200">
        {railPhases.length > 0 && (
          <div data-timeline-bar onClick={() => anchorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })} title="Back to the timeline's place" className="px-6 pt-2.5 pb-1 cursor-pointer">
            <PhaseRail phases={railPhases} active={activePhase} onPick={jumpToGroup} progress={railProgress} />
          </div>
        )}
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

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <div className="space-y-5">
        {phaseGroups.map((phase) => {
          const group = items.filter((d) => d.phase === phase);
          const gSelCount = group.filter((d) => selected.has(d.id)).length;
          const gAll = group.length > 0 && gSelCount === group.length;
          return (
            <div key={phase} ref={(el) => { groupRefs.current[phase] = el; }} style={{ scrollMarginTop: headerH + 8 }}>
              <div className="flex items-center justify-between gap-2 mb-2">
                <label className="inline-flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" disabled={group.length === 0} checked={gAll} ref={(el) => { if (el) el.indeterminate = gSelCount > 0 && !gAll; }} onChange={() => toggleMany(group.map((d) => d.id), !gAll)} className="rounded border-gray-300 disabled:opacity-40" aria-label={`Select all in ${phase}`} />
                  <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${colorOf.get(phase)?.dot ?? "bg-gray-300"}`} />
                  <h3 className="text-sm font-medium text-gray-700">{phase}</h3>
                </label>
                <div className="flex items-center gap-2">
                  {gSelCount > 0 && (
                    <Select value="" onValueChange={(v) => { if (v) void applyStatus(group.filter((d) => selected.has(d.id)).map((d) => d.id), v as string); }} items={[{ value: "", label: `Set ${gSelCount} to…` }, ...STATUSES.map((s) => ({ value: s, label: s }))]}>
                      <SelectTrigger size="sm" className="text-[15px]"><SelectValue /></SelectTrigger>
                      <SelectContent>{STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                    </Select>
                  )}
                  <button onClick={() => { setAdding(adding === phase ? null : phase); setTitle(""); setOwner(""); setDueInput(""); }} className="text-[15px] text-gray-500 hover:text-gray-900 inline-flex items-center gap-1"><Plus className="w-3 h-3" /> Add</button>
                </div>
              </div>
              <div className="rounded-lg border border-gray-200 divide-y divide-gray-100">
                {group.length === 0 && adding !== phase && <p className="px-3 py-2 text-sm text-gray-400">None.</p>}
                <SortableContext items={group.map((d) => d.id)} strategy={verticalListSortingStrategy}>
                {group.map((d) => {
                  const overdue = d.dueDate && d.dueDate < today() && d.status !== "Done";
                  return (
                    <SortableRow key={d.id} id={d.id}>
                      {({ setNodeRef, style, attributes, listeners, isDragging }) => (
                    <div ref={(el) => { rowRefs.current[d.id] = el; setNodeRef(el); }} style={style} className={`px-3 py-2 flex items-center gap-3 text-sm group scroll-mt-24 transition-colors ${isDragging ? "opacity-60" : ""} ${highlight === d.id ? "bg-amber-50" : selected.has(d.id) ? "bg-gray-50" : ""}`}>
                      <button type="button" {...attributes} {...listeners} className="shrink-0 cursor-grab touch-none text-gray-300 hover:text-gray-500 active:cursor-grabbing" aria-label="Drag to retime" title="Drag to retime — dropping between two tasks sets the time in between"><GripVertical className="w-4 h-4" /></button>
                      <input type="checkbox" checked={selected.has(d.id)} onChange={() => toggleSel(d.id)} className="rounded border-gray-300 shrink-0" aria-label={`Select ${d.title}`} />
                      <div className="flex-1 min-w-0">
                        <p className={`inline-flex items-center gap-1.5 ${d.status === "Done" ? "line-through text-gray-400" : ""}`}>
                          {d.title}
                          {d.linearIssueUrl && (
                            <a href={d.linearIssueUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} title="Open issue in Linear" className="inline-flex text-purple-600 hover:text-purple-800 no-underline"><Activity className="w-3.5 h-3.5" /></a>
                          )}
                        </p>
                        <span className="inline-flex items-center gap-1.5 text-[15px] text-gray-500">
                          {tOffsetLabel(d.offsetStart, d.offsetEnd) && <span className="text-gray-400 bg-gray-100 rounded px-1">{tOffsetLabel(d.offsetStart, d.offsetEnd)}</span>}
                          {overdue && <span className="text-red-600 font-medium">overdue</span>}
                          <DateEdit value={d.dueDate} onChange={(iso) => setDue(d.id, iso)} placeholder="add due date" emphasize={!!overdue} />
                        </span>
                      </div>
                      {/* People/outreach tag — placeholder for a future outreach page. */}
                      <button title="People & outreach for this task — coming soon" className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[15px] border border-gray-300 text-gray-600 hover:bg-gray-50 shrink-0">
                        <Users className="w-3 h-3" /> {d.ownerRole ?? "People"}
                      </button>
                      <Select value={d.status ?? "Todo"} onValueChange={(v) => setStatus(d.id, v as string)} items={STATUSES.map((s) => ({ value: s, label: s }))}>
                        <SelectTrigger size="sm" className="shrink-0 text-[15px]"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      {d.locked
                        ? <span title="Required — can't be removed" className="text-gray-300 shrink-0"><Lock className="w-3.5 h-3.5" /></span>
                        : <button onClick={() => remove(d.id)} className="text-gray-300 hover:text-red-600 opacity-0 group-hover:opacity-100" aria-label="Delete"><Trash2 className="w-3.5 h-3.5" /></button>}
                    </div>
                      )}
                    </SortableRow>
                  );
                })}
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
              </div>
            </div>
          );
        })}
      </div>
      </DndContext>
    </div>
  );
}

// ── Carried lessons ─────────────────────────────────────────────────────────
function CarriedLessons({ eventId }: { eventId: string }) {
  const [lessons, setLessons] = useState<CarriedLesson[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    getCarriedLessons(eventId).then((l) => { if (!cancelled) setLessons(l); });
    return () => { cancelled = true; };
  }, [eventId]);

  if (lessons === null) return <div className="bg-white rounded-2xl border border-border p-6 text-sm text-gray-400">Finding comparable past events…</div>;
  if (lessons.length === 0) return <div className="bg-white rounded-2xl border border-border p-6 text-sm text-gray-400">No comparable past events with lessons yet.</div>;

  return (
    <div className="bg-white rounded-2xl border border-border divide-y divide-gray-100">
      {lessons.map((l, i) => (
        <div key={i} className="px-6 py-4 flex gap-3">
          <Lightbulb className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm text-gray-700">{l.body}</p>
            <p className="text-[15px] text-gray-400 mt-1">from {l.sourceEventName}{l.why ? ` · ${l.why}` : ""}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Auto-updates feed (email / Linear detection) ─────────────────────────────
const SOURCE_META: Record<string, { Icon: typeof Mail; label: string; cls: string }> = {
  email: { Icon: Mail, label: "Email", cls: "text-blue-600" },
  linear: { Icon: Activity, label: "Linear", cls: "text-purple-600" },
  manual: { Icon: Pencil, label: "Manual", cls: "text-gray-500" },
};
function relTime(iso: string): string {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  const m = Math.round(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60); if (h < 24) return `${h}h ago`;
  return new Date(iso).toLocaleDateString();
}

function AutoUpdates({ eventId, engagements, onApplied }: { eventId: string; engagements: EngagementWithCandidates[]; onApplied: () => void }) {
  const [updates, setUpdates] = useState<EventUpdate[]>([]);
  const [source, setSource] = useState<"email" | "linear">("email");
  const [from, setFrom] = useState("");
  const [text, setText] = useState("");
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [proposal, setProposal] = useState<DetectedUpdate | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  const [digests, setDigests] = useState<Record<string, string>>({});
  const [digestingKey, setDigestingKey] = useState<string | null>(null);

  const engLabel = (id: string) => {
    const e = engagements.find((x) => x.id === id);
    if (!e) return "Other updates";
    const sel = e.candidates.find((c) => c.isSelected)?.vendorName;
    return e.category ? (sel ? `${e.category} · ${sel}` : e.category) : (sel ?? "Vendor");
  };
  const toggleGroup = (k: string) => setOpenGroups((p) => { const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const summarizeGroup = async (engId: string) => {
    setDigestingKey(engId);
    try {
      const s = await summarizeCorrespondence(eventId, engId);
      setDigests((p) => ({ ...p, [engId]: s ?? "No summary — set ANTHROPIC_API_KEY to enable Claude digests." }));
    } finally { setDigestingKey(null); }
  };

  const load = () => listEventUpdates(eventId).then(setUpdates).catch(() => {});
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [eventId]);

  const runSync = async () => {
    setSyncing(true); setErr(null); setSyncMsg(null);
    try {
      const r = await syncGmail(eventId);
      setSyncMsg(r.note ?? `Synced — ${r.recorded} new email${r.recorded === 1 ? "" : "s"} matched across ${r.scannedDomains} vendor domain${r.scannedDomains === 1 ? "" : "s"}.`);
      if (r.recorded > 0) onApplied();
      await load();
    } catch (e: any) { setErr(e?.message ?? String(e)); }
    finally { setSyncing(false); }
  };

  const reset = () => { setText(""); setLink(""); setFrom(""); setProposal(null); };
  const detect = async () => {
    if (!text.trim()) return;
    setBusy(true); setErr(null); setProposal(null);
    try {
      const p = await detectUpdate(eventId, text, source, source === "email" ? from || null : null);
      const targetStatus = p.kind === "complete" ? "Done" : p.kind === "status" ? (p.status || null) : null;
      if (targetStatus && p.deliverableId) {
        await setDeliverableStatus(p.deliverableId, targetStatus);
        await recordEventUpdate(eventId, { source, summary: p.summary, detail: text, linkUrl: link || null, deliverableId: p.deliverableId });
        reset(); onApplied(); await load();
      } else if (p.kind === "contract" && p.engagementId) {
        setProposal(p); // money change → confirm before applying
      } else {
        // Notes from a matched vendor domain file as correspondence on that decision.
        await recordEventUpdate(eventId, { source, summary: p.summary, detail: text, linkUrl: link || null, engagementId: p.engagementId });
        reset(); await load();
      }
    } catch (e: any) { setErr(e?.message ?? String(e)); }
    finally { setBusy(false); }
  };
  const applyContract = async () => {
    if (!proposal?.engagementId) return;
    setBusy(true);
    try {
      await setEngagementStage(proposal.engagementId, "Contracted", { docUrl: link || null, note: text || null });
      await recordEventUpdate(eventId, { source, summary: proposal.summary, detail: text, linkUrl: link || null, engagementId: proposal.engagementId });
      reset(); onApplied(); await load();
    } finally { setBusy(false); }
  };

  return (
    <div className="bg-white rounded-2xl border border-border p-5">
      {/* Composer — manual entry; "Sync inbox" pulls real Gmail from vendor domains. */}
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-1">
          {(["email", "linear"] as const).map((s) => {
            const M = SOURCE_META[s];
            return (
              <button key={s} onClick={() => setSource(s)} className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[15px] border ${source === s ? "bg-gray-900 text-white border-gray-900" : "bg-white text-gray-600 border-gray-200 hover:border-gray-400"}`}>
                <M.Icon className="w-3 h-3" /> {M.label}
              </button>
            );
          })}
        </div>
        <button onClick={runSync} disabled={syncing} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[15px] border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50">
          <Mail className="w-3 h-3" /> {syncing ? "Syncing…" : "Sync inbox"}
        </button>
      </div>
      {syncMsg && <p className="text-[15px] text-gray-500 mb-2">{syncMsg}</p>}
      {source === "email" && (
        <input value={from} onChange={(e) => setFrom(e.target.value)} placeholder="From (e.g. sales@maplecatering.com) — matched to a vendor by domain" className="w-full mb-2 px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
      )}
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} placeholder={source === "email" ? "Paste an email (e.g. “Countersigned contract attached”)…" : "Linear update (e.g. “Sign with caterer — moved to Done”)…"} className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
      <div className="flex gap-2 mt-2">
        <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="Link to the email / contract / Linear post (optional)" className="flex-1 px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
        <button onClick={detect} disabled={busy || !text.trim()} className="inline-flex items-center gap-1 px-3 py-1 bg-gray-200 rounded text-sm hover:bg-gray-300 disabled:opacity-50">
          <Send className="w-3.5 h-3.5" /> {busy ? "Detecting…" : "Detect & link"}
        </button>
      </div>
      {err && <p className="text-[15px] text-red-600 mt-2">{err}</p>}
      {proposal && (
        <div className="text-sm bg-amber-50 border border-amber-300 rounded-lg px-3 py-2 mt-2">
          Detected a signed contract for <span className="font-medium">{proposal.matchedName}</span>. Apply <span className="font-medium">→ Contracted</span> and link the source?
          <div className="flex gap-2 mt-2">
            <button onClick={applyContract} disabled={busy} className="px-3 py-1 bg-gray-200 rounded text-sm hover:bg-gray-300 disabled:opacity-50">Confirm &amp; apply</button>
            <button onClick={() => setProposal(null)} className="px-3 py-1 text-sm text-gray-600 hover:text-gray-900">Discard</button>
          </div>
        </div>
      )}

      {/* Feed — grouped by vendor decision; click a group to expand the thread. */}
      <div className="mt-4 space-y-2">
        {updates.length === 0 && <p className="text-sm text-gray-400 py-2">No auto-updates yet. Connected email/Linear changes will land here.</p>}
        {(() => {
          // Group updates (already newest-first) by their engagement; null → "Other".
          const groups = new Map<string, EventUpdate[]>();
          for (const u of updates) {
            const k = u.engagementId ?? "__none__";
            if (!groups.has(k)) groups.set(k, []);
            groups.get(k)!.push(u);
          }
          return Array.from(groups.entries()).map(([k, items]) => {
            const isOpen = openGroups.has(k);
            const label = k === "__none__" ? "Other updates" : engLabel(k);
            const brief = digests[k] ?? items[0]?.summary ?? "";
            const canSummarize = k !== "__none__";
            return (
              <div key={k} className="border border-gray-200 rounded-lg overflow-hidden">
                <button onClick={() => toggleGroup(k)} className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-50">
                  <ChevronRight className={`w-4 h-4 shrink-0 text-gray-400 transition-transform ${isOpen ? "rotate-90" : ""}`} />
                  <span className="font-medium text-sm shrink-0">{label}</span>
                  <span className="text-[15px] bg-gray-100 text-gray-600 rounded-full px-1.5 py-0.5 shrink-0">{items.length} email{items.length === 1 ? "" : "s"}</span>
                  <span className="text-[15px] text-gray-400 truncate flex-1">{brief}</span>
                </button>
                {isOpen && (
                  <div className="border-t border-gray-100">
                    {canSummarize && (
                      <div className="px-3 py-2 bg-gray-50/70 border-b border-gray-100">
                        {digests[k]
                          ? <p className="text-sm text-gray-700">{digests[k]}</p>
                          : <button onClick={() => summarizeGroup(k)} disabled={digestingKey === k} className="text-[15px] text-gray-600 hover:text-gray-900 inline-flex items-center gap-1 disabled:opacity-50"><Lightbulb className="w-3.5 h-3.5" /> {digestingKey === k ? "Summarizing…" : "Summarize interaction"}</button>}
                      </div>
                    )}
                    <div className="divide-y divide-gray-100">
                      {items.map((u) => {
                        const M = SOURCE_META[u.source] ?? SOURCE_META.manual;
                        return (
                          <div key={u.id} className="px-3 py-2.5 flex items-start gap-2.5 text-sm">
                            <M.Icon className={`w-4 h-4 mt-0.5 shrink-0 ${M.cls}`} />
                            <div className="flex-1 min-w-0">
                              <p className="text-gray-700">{u.summary}</p>
                              <p className="text-[15px] text-gray-400 mt-0.5">
                                {M.label} · {relTime(u.createdAt)}
                                {u.linkUrl && <> · <a href={u.linkUrl} target="_blank" rel="noreferrer" className="text-gray-500 hover:text-gray-800 inline-flex items-center gap-0.5">source <ExternalLink className="w-3 h-3" /></a></>}
                              </p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          });
        })()}
      </div>
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
const DAY_BEFORE_WINDOW = 1; // days before the event the "day-before" view becomes current
const NEUTRAL_COLOR = { dot: "bg-gray-400", band: "bg-gray-100", text: "text-gray-600", ring: "ring-gray-200", border: "border-gray-400", fillSoft: "group-hover:bg-gray-100" };
interface OvMarker { key: string; label: string; view: ViewMode; kind: "primary" | "secondary"; phaseName: string | null; date: string | null; color: typeof NEUTRAL_COLOR }

const localToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const addDays = (iso: string, n: number) => { const d = new Date(iso + "T00:00:00"); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const daysBetween = (a: string, b: string) => Math.round((Date.parse(a + "T00:00:00") - Date.parse(b + "T00:00:00")) / 86_400_000);
const fmtShort = (iso: string) => new Date(iso + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
const isPostPhase = (name: string, start: number | null) => (start != null && start > 0) || /wrap|post|measure|after|recap|reflect|debrief|thank|follow/i.test(name);

// Ordered timeline markers + the date-derived current marker/view ("you are here").
function deriveMarkers(plan: EventPlanning): { markers: OvMarker[]; currentKey: string } {
  const phases = enrichPhases({ phases: plan.phases, walkthrough: plan.walkthrough, deliverables: plan.deliverables }, DELIVERABLE_PHASES);
  const ev = plan.date;
  const dayOfRx = /event\s*day|day[-\s]?of|run.?of.?show|\blive\b/i;
  const markers: OvMarker[] = phases.map((p) => {
    const view: ViewMode = dayOfRx.test(p.name) || p.start === 0 ? "day-of" : isPostPhase(p.name, p.start) ? "post" : "planning";
    return { key: `phase:${p.name}`, label: p.name, view, kind: "primary", phaseName: p.name, date: ev && p.start != null ? addDays(ev, p.start) : null, color: p.color };
  });
  if (ev) {
    // Day-before node is INVENTED only when there's a distinct cluster of final-week / day-before
    // tasks (offsets inside the last week). Colour it as the phase those tasks officially belong to
    // (the timeline renders secondary nodes as that phase's lighter halo).
    const dayBeforeItems = plan.deliverables.filter((d) => d.offsetStart != null && d.offsetStart >= -7 && d.offsetStart < 0);
    if (dayBeforeItems.length > 0) {
      const leadUp = phases.filter((p) => !isPostPhase(p.name, p.start) && !dayOfRx.test(p.name));
      const cover = leadUp.find((p) => p.start != null && -DAY_BEFORE_WINDOW >= p.start && -DAY_BEFORE_WINDOW <= (p.end ?? p.start))
        ?? [...leadUp].sort((a, b) => (b.end ?? b.start ?? -1e9) - (a.end ?? a.start ?? -1e9))[0];
      const color = cover?.color ?? NEUTRAL_COLOR;
      const dayOfIdx = markers.findIndex((m) => m.view === "day-of");
      markers.splice(dayOfIdx >= 0 ? dayOfIdx : markers.length, 0, { key: "day-before", label: "Day before", view: "day-before", kind: "secondary", phaseName: cover?.name ?? null, date: addDays(ev, -DAY_BEFORE_WINDOW), color });
    }
    // Post-event node is invented only when there's post-event work and no phase already covers it.
    const postItems = plan.deliverables.filter((d) => d.offsetStart != null && d.offsetStart > 0);
    if (postItems.length > 0 && !markers.some((m) => m.view === "post")) {
      const last = markers[markers.length - 1];
      markers.push({ key: "post", label: "Post-event", view: "post", kind: "secondary", phaseName: null, date: addDays(ev, 1), color: last?.color ?? NEUTRAL_COLOR });
    }
  }
  // No date → no "you are here" (don't fabricate a position); default view falls to planning.
  let currentKey = "";
  if (ev) {
    currentKey = markers[0]?.key ?? "";
    const nowOff = daysBetween(localToday(), ev);
    let cv: ViewMode = "planning";
    if (nowOff > 0) cv = "post";
    else if (nowOff === 0) cv = "day-of";
    else if (nowOff >= -DAY_BEFORE_WINDOW) cv = "day-before";
    if (cv === "planning") {
      const inPhase = phases.find((p) => p.start != null && nowOff >= p.start && nowOff <= (p.end ?? p.start) && !isPostPhase(p.name, p.start));
      const begun = [...phases].reverse().find((p) => p.start != null && nowOff >= p.start && !isPostPhase(p.name, p.start));
      currentKey = `phase:${(inPhase ?? begun ?? phases[0])?.name}`;
    } else {
      // Resolve to the matching node; if the day-before node wasn't invented, fall to day-of.
      currentKey = markers.find((m) => m.view === cv)?.key
        ?? (cv === "day-before" ? markers.find((m) => m.view === "day-of")?.key : undefined)
        ?? markers[markers.length - 1]?.key
        ?? currentKey;
    }
  }
  return { markers, currentKey };
}

// Interactive timeline: primary phase nodes (large) + secondary view-moments (small). The
// date-derived "NOW" marker is fixed; the selected node is what's being previewed.
function OverviewTimeline({ markers, currentKey, selectedKey, onSelect }: { markers: OvMarker[]; currentKey: string; selectedKey: string; onSelect: (k: string) => void }) {
  if (markers.length === 0) return null;
  return (
    <div className="bg-white rounded-2xl border border-border p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-medium text-gray-700">Timeline <span className="text-gray-400 font-normal">· click a phase to preview</span></h3>
        {selectedKey !== currentKey && <button onClick={() => onSelect(currentKey)} className="text-xs text-gray-600 hover:text-gray-900 inline-flex items-center gap-1"><ChevronLeft className="w-3.5 h-3.5" /> Back to now</button>}
      </div>
      <div className="relative">
        <div className="absolute left-0 right-0 top-4 h-px bg-gray-200" />
        <div className="flex">
          {markers.map((m) => {
            const isSel = m.key === selectedKey, isNow = m.key === currentKey, big = m.kind === "primary";
            return (
              <button key={m.key} type="button" onClick={() => onSelect(m.key)} title={m.label} className="group relative flex-1 min-w-[56px] flex flex-col items-center px-1 text-center">
                <span className="relative flex h-8 w-full items-center justify-center">
                  <span className={`rounded-full transition-colors ${big ? "w-3.5 h-3.5 border-2 " + m.color.border : "w-2.5 h-2.5"} ${isSel ? `ring-4 ${m.color.ring}` : ""} ${isSel ? m.color.dot : m.kind === "secondary" ? `${m.color.band} ${m.color.fillSoft}` : `bg-white ${m.color.fillSoft}`}`} />
                </span>
                <span className={`mt-1 text-[11px] leading-tight ${isSel ? `${m.color.text} font-semibold` : m.kind === "secondary" ? "text-gray-400" : "text-gray-600"}`}>{m.label}</span>
                {m.date && <span className="mt-0.5 text-[10px] text-gray-400 whitespace-nowrap">{fmtShort(m.date)}</span>}
                {isNow && <span className="mt-0.5 inline-flex items-center gap-1 text-[9px] font-semibold tracking-wide text-gray-900"><span className="w-1.5 h-1.5 rounded-full bg-gray-900" /> NOW</span>}
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

// ── Post-event view: how it went → close it out → reflection → attendees ──────
// Stats, close-out and attendee tagging render immediately on wrap (real captured data);
// only the reflection section waits on the debrief. This view is past-only — no projections.
function PostEventView({ plan, temporal, onOpenDeliverable, onOpenPeople, assignedTarget, onApplied }: { plan: EventPlanning; temporal: "past" | "current" | "future"; onOpenDeliverable: (id: string) => void; onOpenPeople: () => void; assignedTarget: number | null; onApplied: () => void }) {
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
  const checkedIn = stats?.checkedIn ?? null;
  const showPct = rsvp && checkedIn != null ? Math.round((checkedIn / rsvp) * 100) : null;
  const lines = plan.budget?.lines ?? [];
  const spent = lines.filter((l) => l.status === "paid").reduce((s, l) => s + (l.confirmedAmount ?? 0), 0);
  const target = assignedTarget ?? plan.budget?.targetAmount ?? null;
  const overUnder = target != null ? spent - target : null;
  const perHead = checkedIn ? Math.round(spent / checkedIn) : null;
  const flagged = attendees.filter((a) => a.applicationStatus && a.applicationStatus !== "none").length;

  return (
    <div className="space-y-6">
      {future && <ProjectionBanner label="Post-event" />}

      {/* 1 · How it went — real captured data, no projections */}
      <section>
        <h3 className="text-lg font-medium mb-3">How it went</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
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
            <p className="text-[11px] text-gray-400">spend ÷ checked in</p>
          </div>
          <div className="bg-white rounded-2xl border border-border p-5">
            <p className="text-[13px] text-gray-500 mb-1">Flagged in Greenhouse</p>
            <p className="text-2xl font-semibold text-gray-900">{flagged || "—"}</p>
            <p className="text-[11px] text-gray-400">attendees with an application</p>
          </div>
        </div>
      </section>

      {/* 2 · Close it out — actionable post-event work + the debrief */}
      <CloseItOut plan={plan} onOpenDeliverable={onOpenDeliverable} onOpenPeople={onOpenPeople} onApplied={onApplied} />

      {/* 3 · Post-event reflection — gated on the debrief; doesn't block the rest */}
      <ReflectionSection plan={plan} onApplied={onApplied} />

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

// Reflection: two states. Waiting (debrief scheduled / none yet) → manual-notes fallback always
// available. Notes → existing extract pipeline → propose-then-confirm items, grouped by route.
interface ReflectionProposal { lessons: string[]; followUps: string[]; outcome: string }
function ReflectionSection({ plan, onApplied }: { plan: EventPlanning; onApplied: () => void }) {
  const debrief = plan.deliverables.find((d) => /debrief/i.test(d.title));
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [proposal, setProposal] = useState<ReflectionProposal | null>(null);
  const [open, setOpen] = useState(false);
  // Local guardrail list so confirmed lessons/outcomes accumulate without a stale snapshot.
  const reflectionsRef = useRef<string[]>(plan.reflections);
  const postPhase = plan.phases[plan.phases.length - 1]?.name ?? "Wrap-up";
  const due = plan.date ? addDays(plan.date, 1) : null;

  const extract = async () => {
    if (!notes.trim()) return;
    setBusy(true); setErr(null);
    try {
      const b = await extractBrief(notes);
      setProposal({
        lessons: [...(b.guardrails ?? []), ...(b.heuristics ?? [])].filter(Boolean),
        followUps: (b.deliverables ?? []).map((d) => d.title).filter(Boolean),
        outcome: (b.overview ?? "").trim(),
      });
    } catch (e: any) { setErr(e?.message ?? String(e)); }
    finally { setBusy(false); }
  };

  const drop = (kind: keyof ReflectionProposal, i: number) =>
    setProposal((p) => (!p ? p : kind === "outcome" ? { ...p, outcome: "" } : { ...p, [kind]: (p[kind] as string[]).filter((_, j) => j !== i) }));

  const addLesson = async (kind: "lessons" | "outcome", i: number, text: string) => {
    reflectionsRef.current = [...reflectionsRef.current, text];
    await setEventReflections(plan.id, reflectionsRef.current).catch(() => {});
    drop(kind, i); onApplied();
  };
  const addFollowUp = async (i: number, title: string) => {
    await addDeliverable(plan.id, { title, phase: postPhase, ownerRole: null, dueDate: due, offsetStart: 1 }).catch(() => {});
    drop("followUps", i); onApplied();
  };

  const ItemRow = ({ text, route, onConfirm, onDismiss }: { text: string; route: string; onConfirm: () => void; onDismiss: () => void }) => (
    <li className="flex items-start gap-2 rounded-lg border border-gray-200 px-3 py-2">
      <span className="flex-1 min-w-0 text-sm text-gray-800">{text}<span className="ml-2 text-[11px] text-gray-400">→ {route}</span></span>
      <button onClick={onConfirm} className="shrink-0 text-emerald-600 hover:text-emerald-800" title="Confirm"><Check className="w-4 h-4" /></button>
      <button onClick={onDismiss} className="shrink-0 text-gray-300 hover:text-red-600" title="Dismiss"><X className="w-4 h-4" /></button>
    </li>
  );

  const proposedCount = proposal ? proposal.lessons.length + proposal.followUps.length + (proposal.outcome ? 1 : 0) : 0;

  return (
    <section>
      <h3 className="text-lg font-medium mb-3">Post-event reflection</h3>
      <div className="bg-white rounded-2xl border border-border p-5 space-y-4">
        {/* waiting state */}
        {proposedCount === 0 && (
          <div className="flex items-start gap-3">
            <Lightbulb className="w-5 h-5 text-gray-300 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              {debrief
                ? <p className="text-sm text-gray-600">Debrief scheduled{debrief.dueDate ? ` for ${fmtShort(debrief.dueDate)}` : ""} · its notes will sync here. You can also paste notes now.</p>
                : <p className="text-sm text-gray-600">No debrief scheduled. Paste meeting notes (or any reflection) and EventHub will extract proposed lessons, follow-ups, and outcomes.</p>}
            </div>
          </div>
        )}

        {/* manual notes input */}
        {!open && proposedCount === 0 ? (
          <button onClick={() => setOpen(true)} className="text-sm text-gray-600 hover:text-gray-900 inline-flex items-center gap-1"><Plus className="w-4 h-4" /> Paste debrief notes</button>
        ) : proposedCount === 0 ? (
          <div className="space-y-2">
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={6} placeholder="Paste the debrief transcript or notes…" className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
            <div className="flex items-center gap-2">
              <button onClick={extract} disabled={busy || !notes.trim()} className="px-3 py-1.5 rounded-lg bg-gray-900 text-white text-sm hover:bg-black disabled:opacity-50">{busy ? "Extracting…" : "Extract"}</button>
              <button onClick={() => { setOpen(false); setNotes(""); }} className="text-sm text-gray-500 hover:text-gray-800">Cancel</button>
              {err && <span className="text-sm text-red-600">{err}</span>}
            </div>
          </div>
        ) : null}

        {/* propose-then-confirm, grouped by route */}
        {proposal && proposedCount > 0 && (
          <div className="space-y-4">
            <p className="text-[13px] text-gray-500">Proposed from the notes — confirm what's real, dismiss the rest. Nothing's applied until you confirm.</p>
            {proposal.lessons.length > 0 && (
              <div><p className="text-[13px] font-medium text-gray-700 mb-1">Lessons</p><ul className="space-y-1.5">{proposal.lessons.map((t, i) => <ItemRow key={i} text={t} route="guardrails" onConfirm={() => addLesson("lessons", i, t)} onDismiss={() => drop("lessons", i)} />)}</ul></div>
            )}
            {proposal.followUps.length > 0 && (
              <div><p className="text-[13px] font-medium text-gray-700 mb-1">Follow-ups</p><ul className="space-y-1.5">{proposal.followUps.map((t, i) => <ItemRow key={i} text={t} route="deliverable" onConfirm={() => addFollowUp(i, t)} onDismiss={() => drop("followUps", i)} />)}</ul></div>
            )}
            {proposal.outcome && (
              <div><p className="text-[13px] font-medium text-gray-700 mb-1">Outcome</p><ul className="space-y-1.5"><ItemRow text={proposal.outcome} route="event verdict" onConfirm={() => addLesson("outcome", 0, proposal.outcome)} onDismiss={() => drop("outcome", 0)} /></ul></div>
            )}
            <button onClick={() => { setProposal(null); setNotes(""); setOpen(false); }} className="text-[13px] text-gray-500 hover:text-gray-800">Done</button>
          </div>
        )}
      </div>
    </section>
  );
}

// One connected stepper: scoping → budget assigned → tracking. Scoping data fills in under
// step 1 once submitted; honest CTA/pending states before then.
function StepDot({ n, done, active }: { n: number; done?: boolean; active?: boolean }) {
  return (
    <span className={`relative z-[1] flex items-center justify-center w-6 h-6 rounded-full text-[15px] shrink-0 ${done ? "bg-green-600 text-white" : active ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-500"}`}>
      {done ? <Check className="w-3.5 h-3.5" /> : n}
    </span>
  );
}
function BudgetCard({ plan, scoping, roughTotal, onOpenScoping, onOpenBudget }: { plan: EventPlanning; scoping: ScopingData; roughTotal: number; onOpenScoping: () => void; onOpenBudget: () => void }) {
  const funding = fundingFor(plan.tags);
  const submitted = scoping.status !== "draft";
  const assigned = scoping.assignedBudget;
  const hasAssigned = assigned != null;
  const lines = plan.budget?.lines ?? [];
  const committed = lines.filter((l) => l.status !== "estimate").reduce((s, l) => s + (l.confirmedAmount ?? 0), 0);
  const target = assigned ?? plan.budget?.targetAmount ?? null;
  const pct = target ? Math.min(100, Math.round((committed / target) * 100)) : 0;
  const over = target != null && committed > target;
  const dueDate = plan.date ? (() => { const d = new Date(plan.date + "T00:00:00"); d.setDate(d.getDate() - 30); return d.toISOString().slice(0, 10); })() : null;
  const overdue = !submitted && dueDate != null && new Date().toISOString().slice(0, 10) > dueDate;
  const Row = ({ k, v }: { k: string; v: React.ReactNode }) => <div className="flex justify-between gap-2"><dt className="text-gray-500">{k}</dt><dd className="text-gray-800">{v}</dd></div>;

  return (
    <div className="bg-white rounded-2xl border border-border p-5">
      <h3 className="font-medium mb-4">Budget</h3>
      <ol className="relative space-y-5 before:absolute before:left-[11px] before:top-2 before:bottom-2 before:w-px before:bg-gray-200">
        {/* 1 · Scoping */}
        <li className="relative flex gap-3">
          <StepDot n={1} done={submitted} active={!submitted} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium">{submitted ? "Scoping submitted" : "Submit scoping"}</p>
              {!submitted && <Button size="sm" onClick={onOpenScoping}>{scoping.generated ? "Review & submit" : "Generate & submit"}</Button>}
            </div>
            {submitted ? (
              <dl className="mt-1.5 text-sm space-y-1">
                <Row k="Rough cost" v={money(roughTotal)} />
                <Row k="Funding" v={`${funding.fundingLine} · ${funding.tier}`} />
                {scoping.submittedAt && <Row k="Submitted" v={scoping.submittedAt} />}
                <button onClick={onOpenScoping} className="text-sm text-gray-600 hover:text-gray-900 inline-flex items-center gap-1 pt-0.5">View full form <ChevronRight className="w-4 h-4" /></button>
              </dl>
            ) : (
              <p className="text-[15px] text-gray-400 mt-0.5">Generate the brief & submit to request a budget{dueDate ? <> · <span className={overdue ? "text-red-600" : "text-gray-400"}>due {dueDate}</span></> : null}.</p>
            )}
          </div>
        </li>
        {/* 2 · Budget assigned */}
        <li className="relative flex gap-3">
          <StepDot n={2} done={hasAssigned} />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium inline-flex items-center gap-1.5">{hasAssigned && <Lock className="w-3.5 h-3.5 text-gray-400" />} Budget assigned</p>
            {hasAssigned ? (
              <p className="text-sm mt-0.5">{money(assigned)} <span className="text-gray-400">· set by admin</span></p>
            ) : (
              <p className="text-[15px] text-gray-400 mt-0.5">{submitted ? "Awaiting Karim's assignment." : "Pending scoping submission."}</p>
            )}
            {hasAssigned && scoping.approvalComment && <p className="text-[15px] text-gray-500 mt-1 bg-gray-50 border border-gray-200 rounded px-2 py-1 inline-flex items-start gap-1"><MessageSquare className="w-3 h-3 mt-0.5 shrink-0" /> “{scoping.approvalComment}”</p>}
          </div>
        </li>
        {/* 3 · Tracking */}
        <li className="relative flex gap-3">
          <StepDot n={3} active={hasAssigned} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium">Tracking</p>
              <button onClick={onOpenBudget} className="text-[15px] text-gray-600 border border-gray-300 rounded-md px-1.5 py-0.5 hover:bg-gray-50">Budget tab</button>
            </div>
            {target != null ? (
              <>
                <div className="mt-1.5 h-2 bg-gray-100 rounded-full overflow-hidden"><div className={`h-full rounded-full transition-all ${over ? "bg-red-500" : "bg-gradient-to-r from-gray-400 to-gray-900"}`} style={{ width: `${pct}%` }} /></div>
                <p className={`text-[15px] mt-1 ${over ? "text-red-600" : "text-gray-500"}`}>{money(committed)} of {money(target)} {over ? `· ${money(committed - target)} over` : `· ${money(target - committed)} left`}</p>
              </>
            ) : <p className="text-[15px] text-gray-400 mt-0.5">Track spend once a budget is assigned — add vendor info to keep it accurate.</p>}
          </div>
        </li>
      </ol>
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

function Overview({ plan, eventId, onApplied, onOpenBudget, onOpenDeliverable, onOpenPeople }: { plan: EventPlanning; eventId: string; onApplied: () => void; onOpenBudget: () => void; onOpenDeliverable: (id: string) => void; onOpenPeople: () => void }) {
  const facts = buildFacts(plan);
  // Phase-aware view: the timeline's date-derived "now" sets the default; clicking a node
  // previews another phase's view (Overview-internal state, not tab navigation).
  const { markers, currentKey } = deriveMarkers(plan);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const selKey = selectedKey ?? currentKey;
  const selIdx = markers.findIndex((m) => m.key === selKey);
  const curIdx = markers.findIndex((m) => m.key === currentKey);
  const selectedView: ViewMode = markers[selIdx]?.view ?? "planning";
  const temporal: "past" | "current" | "future" = selIdx === curIdx ? "current" : selIdx > curIdx ? "future" : "past";
  // Use the cached digest; only regenerate on Resync (which also pulls Gmail).
  const [summary, setSummary] = useState<string | null>(plan.overviewSummary);
  const [resyncing, setResyncing] = useState(false);
  const [resyncMsg, setResyncMsg] = useState<string | null>(null);

  // Scoping (client-side). The full form opens as a modal from the budget flow / glance card.
  const [scoping, setScoping] = useState<ScopingData>(() => loadScoping(eventId));
  const [scopingOpen, setScopingOpen] = useState(false);
  const updateScoping = (s: ScopingData) => { setScoping(s); saveScoping(eventId, s); };
  // Rough cost counts whatever's filled per line — a real amount, or the per-category target
  // when a sheet was imported into the setup's "Review budget" step (which fills targets).
  const roughTotal = (plan.budget?.lines ?? []).reduce((s, l) => s + (l.confirmedAmount ?? l.target ?? 0), 0);

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

  const contracted = plan.engagements.filter((e) => e.stage === "Contracted");
  // Status digest is stored as one fact per line → render as bullets when present.
  const summaryBullets = (summary ?? "").split("\n").map((l) => l.replace(/^[\s•\-*]+/, "").trim()).filter(Boolean);
  // Synthesized one-liner used when there's no Claude digest yet (never a blank empty state).
  const synth: string[] = [plan.macroStage ?? "Planning"];
  if (facts.daysOut != null) synth.push(facts.daysOut > 0 ? `${facts.daysOut}d to event` : facts.daysOut === 0 ? "event today" : `${-facts.daysOut}d ago`);
  if (scoping.assignedBudget != null) synth.push(`${money(scoping.assignedBudget)} budget`);
  synth.push(`${facts.deliverables.done}/${facts.deliverables.total} deliverables`);
  if (plan.staffRoles.length) synth.push(`${plan.staffRoles.length} open role${plan.staffRoles.length === 1 ? "" : "s"}`);
  const synthDigest = synth.join(" · ");

  const expectedTurnout = plan.rsvp ?? plan.headcount ?? null;
  const showRate = plan.heuristics.find((h) => /show|rsvp|turn ?out|%/.test(h.toLowerCase())) ?? null;
  const committed = facts.budget?.committed ?? 0;
  const tgt = scoping.assignedBudget ?? facts.budget?.target ?? null;

  return (
    <div className="space-y-6">
      {/* Add-to-Google-Calendar prompt — only while unsynced. Once synced, the green calendar
          icon in the header conveys it (no persistent banner). */}
      {plan.date && !plan.gcalEventId && (
        <GCalSync eventId={eventId} synced={false} variant="action" onSynced={onApplied} />
      )}

      {/* Status digest — synthesized one-liner by default; Claude bullets after Resync. */}
      <div className="bg-white rounded-2xl border border-border p-4">
        <div className="flex items-start justify-between gap-3">
          {summaryBullets.length > 0 ? (
            <ul className="flex-1 list-disc pl-5 space-y-1 text-gray-700 leading-relaxed">
              {summaryBullets.map((b, i) => <li key={i}>{b}</li>)}
            </ul>
          ) : (
            <p className="flex-1 text-sm text-gray-700">{synthDigest}</p>
          )}
          <button onClick={resync} disabled={resyncing} className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[15px] border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50">
            <RefreshCw className={`w-3 h-3 ${resyncing ? "animate-spin" : ""}`} /> {resyncing ? "Resyncing…" : "Resync"}
          </button>
        </div>
        {resyncMsg && <p className="text-[15px] text-gray-400 mt-2">{resyncMsg}</p>}
      </div>

      {/* Interactive phase timeline — full width */}
      <OverviewTimeline markers={markers} currentKey={currentKey} selectedKey={selKey} onSelect={setSelectedKey} />

      {/* Phase-aware body — the timeline's selected node decides which view shows. */}
      {selectedView === "day-before" ? (
        <DayBeforeView plan={plan} temporal={temporal} />
      ) : selectedView === "day-of" ? (
        <DayOfView plan={plan} temporal={temporal} />
      ) : selectedView === "post" ? (
        <PostEventView plan={plan} temporal={temporal} onOpenDeliverable={onOpenDeliverable} onOpenPeople={onOpenPeople} assignedTarget={tgt} onApplied={onApplied} />
      ) : (
        // PLANNING view — the build-it spine (budget, deliverables, guardrails, staffing).
        <div className="space-y-6">
          {/* Top row: budget shares its width with At-a-glance + Guardrails. */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
            {/* Left column: Budget, then the Linear update box fills the space beneath it. */}
            <div className="space-y-6 min-w-0">
              <BudgetCard plan={plan} scoping={scoping} roughTotal={roughTotal} onOpenScoping={() => setScopingOpen(true)} onOpenBudget={onOpenBudget} />
              <LinearUpdateBox eventId={eventId} linearSynced={!!plan.linearProjectId} onApplied={onApplied} variant="card" />
            </div>
            <div className="flex flex-col gap-4 min-w-0">
              {/* At a glance */}
              <div className="bg-white rounded-2xl border border-border p-5">
                <h3 className="font-medium mb-3">At a glance</h3>
                <div className="space-y-3">
                  <GlanceTile label="Deliverables" value={`${facts.deliverables.done}/${facts.deliverables.total}`} hint={facts.deliverables.overdue ? `${facts.deliverables.overdue} overdue` : "done"} />
                  <GlanceTile label="Vendors" value={`${contracted.length}/${plan.engagements.length}`} hint="contracted" />
                  <GlanceTile label="Budget" value={tgt != null ? `${money(committed)} / ${money(tgt)}` : money(committed)} hint={tgt != null ? "committed vs target" : "committed"} />
                  <GlanceTile label="Expected turnout" value={expectedTurnout != null ? String(expectedTurnout) : "—"} hint={showRate ?? "from RSVPs"} />
                </div>
              </div>
              {/* Grows to fill the right column so its bottom aligns with the Linear box on the left. */}
              <div className="flex-1 flex flex-col">
                <StringListEditor title="Guardrails" initial={plan.reflections} onSave={(v) => setEventReflections(eventId, v).catch(() => {})} variant="bullets" addLabel="Add note" placeholder="Add a guardrail" empty="No guardrails yet." />
              </div>
            </div>
          </div>

          {/* Below, full width. */}
          <OverviewDeliverables plan={plan} onOpen={onOpenDeliverable} />
          <StringListEditor title="Staffing" initial={plan.staffRoles} onSave={(v) => setEventStaffRoles(eventId, v).catch(() => {})} variant="chips" addLabel="Add role" placeholder="Add a role (e.g. photographer)" empty="No roles yet." />
          <div>
            <h3 className="text-lg font-medium mb-3">Auto-updates</h3>
            <AutoUpdates eventId={eventId} engagements={plan.engagements} onApplied={onApplied} />
          </div>
        </div>
      )}

      {scopingOpen && (
        <ScopingForm plan={plan} scoping={scoping} roughTotal={roughTotal} onChange={updateScoping} onClose={() => setScopingOpen(false)} />
      )}

      {/* Carried lessons */}
      <div>
        <h3 className="text-lg font-medium mb-3">Carried lessons</h3>
        <CarriedLessons eventId={eventId} />
      </div>
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
        <p className="text-[15px] text-gray-400">Assembly doesn't host or render dev-owned pages — they deploy from code. Git dir creation, CI preview builds, and promote run in your pipeline; these fields surface their state.</p>
      </div>
      <DeveloperManager eventId={eventId} />
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
type Tab = "overview" | "people" | "vendors" | "budget" | "deliverables" | "page";
const TABS: { key: Tab; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "deliverables", label: "Deliverables" },
  { key: "vendors", label: "Vendors" },
  { key: "people", label: "People" },
  { key: "budget", label: "Budget" },
  { key: "page", label: "Page" },
];

export function EventPlanningPage({ eventId, onBack, onOpenEvent, onReview }: Props) {
  const [plan, setPlan] = useState<EventPlanning | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [deliverableJump, setDeliverableJump] = useState<string | null>(null); // Overview → a specific deliverable
  // People is a tab here (keeps the event header/tabs); links set the status it opens on.
  const [peopleStatus, setPeopleStatus] = useState<'all' | 'registered' | 'checkedIn' | 'waitlisted' | 'speakers'>('all');
  const goPeople = (status: typeof peopleStatus) => { setPeopleStatus(status); setTab('people'); };
  const [version, setVersion] = useState(0); // bumps on each fetch → remounts tab content with fresh data
  const [reload, setReload] = useState(0);   // bumped when an auto-update applies a change

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
  const back = (
    <button onClick={() => { if (tab !== "overview") setTab("overview"); else onBack(); }} className="inline-flex items-center gap-1 mb-6 px-2 py-1 rounded-lg bg-white border border-border text-gray-700 hover:bg-gray-50 transition-colors">
      <ChevronLeft className="w-4 h-4" /> {tab !== "overview" ? "Overview" : "Previous"}
    </button>
  );

  if (error) return <div>{back}<p className="text-red-600 bg-red-50 border border-red-200 rounded-lg p-4">Couldn’t load event: {error}</p></div>;
  if (!plan) return <div>{back}<p className="text-gray-500 py-12 text-center">Loading planning view…</p></div>;

  // A template renders in pattern mode (walkthrough-forward, no live/ops affordances).
  if (plan.isTemplate) return <TemplateView plan={plan} eventId={eventId} onExit={onBack} onOpenEvent={onOpenEvent} onReview={onReview} />;

  const headcount = plan.capacity != null ? `${plan.rsvp ?? 0} / ${plan.capacity} expected` : plan.rsvp != null ? `${plan.rsvp} expected` : "—";

  return (
    <div>
      {back}

      <SourceMaterials items={plan.sourceMaterials} className="mb-6" />

      {/* Header */}
      <div className="relative bg-white rounded-2xl border border-border p-8 mb-6">
        <div className="header-row flex gap-10">
          <div className="flex-1 min-w-0">
            <div className="mb-3"><TagStack tags={plan.tags} editable onChange={(tags) => { setPlan((p) => (p ? { ...p, tags } : p)); void updateEventTags(eventId, tags); }} /></div>
            <div className="mb-4">
              <EditableTitle value={plan.title} onChange={(name) => { setPlan((p) => (p ? { ...p, title: name } : p)); void updateEvent(eventId, { name }); }} className="text-3xl" />
            </div>
            <div className="mb-4 flex items-center gap-4 flex-wrap">
              <StatusControl eventId={eventId} status={plan.status} eventDate={plan.date} onChange={(s) => setPlan((p) => (p ? { ...p, status: s } : p))} />
              <LumaAttach eventId={eventId} initialUrl={plan.lumaUrl} descriptions={plan.outreach.filter(isLumaDescription)} draft={{ name: plan.title, date: plan.date, startTime: plan.startTime, endTime: plan.endTime, location: plan.location, description: plan.description || loadScoping(eventId).strategicJustification || "" }} />
            </div>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 mb-5 text-gray-600">
              <div className="flex items-center gap-2">
                {!plan.lumaEventId ? (
                  // Not tied to Luma → date is freely editable inline. If it's on Google Calendar,
                  // re-push the change so the calendar entry can't drift, and show a green link to it.
                  <span className="inline-flex items-center gap-1.5">
                    <DateEdit
                      value={plan.date}
                      onChange={(iso) => {
                        setPlan((p) => (p ? { ...p, date: iso } : p));
                        void setEventDate(eventId, iso).then(() => {
                          if (iso && plan.gcalEventId) void syncEventToGoogleCalendar(eventId).catch(() => {});
                        });
                      }}
                      placeholder="Date TBD"
                    />
                    {plan.gcalEventId && plan.gcalHtmlLink && (
                      <a href={plan.gcalHtmlLink} target="_blank" rel="noreferrer" title="View in Google Calendar" className="inline-flex text-emerald-600 hover:text-emerald-700">
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    )}
                  </span>
                ) : (
                  // Luma owns the date → read-only; green icon links to the GCal event when synced.
                  <>
                    {plan.gcalEventId && plan.gcalHtmlLink ? (
                      <a href={plan.gcalHtmlLink} target="_blank" rel="noreferrer" title="View in Google Calendar" className="inline-flex">
                        <Calendar className="w-5 h-5 text-emerald-600 hover:text-emerald-700" />
                      </a>
                    ) : (
                      <Calendar className={`w-5 h-5 ${plan.gcalEventId ? "text-emerald-600" : ""}`} />
                    )}
                    <span>{plan.date ?? "Date TBD"}</span>
                  </>
                )}
                <input type="time" value={plan.startTime ?? ""} onChange={(e) => { const startTime = e.target.value || null; setPlan((p) => (p ? { ...p, startTime } : p)); void updateEvent(eventId, { startTime }); }} title="Start time" className="px-1.5 py-0.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
                <span className="text-gray-400">–</span>
                <input type="time" value={plan.endTime ?? ""} onChange={(e) => { const endTime = e.target.value || null; setPlan((p) => (p ? { ...p, endTime } : p)); void updateEvent(eventId, { endTime }); }} title="End time" className="px-1.5 py-0.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
              </div>
              <LocationEdit value={plan.location} onChange={(location) => { setPlan((p) => (p ? { ...p, location } : p)); void updateEvent(eventId, { location }); }} />
              <FormatPicker value={parseFormats(plan.format)} onChange={(arr) => { const format = joinFormats(arr); setPlan((p) => (p ? { ...p, format } : p)); void setEventFormat(eventId, format); }} />
              <button onClick={() => goPeople('all')} className="flex items-center gap-2 hover:text-gray-900 text-left">
                <Users className="w-5 h-5" /><span className="underline decoration-dotted underline-offset-4">{headcount}</span>
              </button>
              <button onClick={() => goPeople('speakers')} className="flex items-center gap-2 hover:text-gray-900 text-left">
                <Mic className="w-5 h-5" /><span className="underline decoration-dotted underline-offset-4">Speakers</span>
              </button>
              <OwnerPicker eventId={eventId} owners={plan.owners} onChange={(owners) => setPlan((p) => (p ? { ...p, owners, owner: owners.map((o) => o.name).join(", ") || null } : p))} />
            </div>
            <MacroStepper eventId={eventId} initial={plan.macroStage} eventDate={plan.date} />
          </div>
          <CoverImage
            eventId={eventId}
            cover={plan.coverImageUrl}
            lumaCover={plan.lumaCoverUrl}
            customCover={plan.customCoverUrl}
            onChange={(patch) => setPlan((p) => (p ? { ...p, coverImageUrl: patch.cover, ...(patch.custom !== undefined ? { customCoverUrl: patch.custom } : {}) } : p))}
          />
        </div>
        {plan.linearProjectUrl && (
          <a href={plan.linearProjectUrl} target="_blank" rel="noreferrer" title="Open this event's project in Linear" className="absolute bottom-4 right-6 inline-flex items-center gap-1 text-[15px] text-purple-600 hover:text-purple-800">
            <Activity className="w-4 h-4" /> Open in Linear <ExternalLink className="w-3.5 h-3.5" />
          </a>
        )}
      </div>

      {/* Tabs — brand Tabs (line variant = underline-on-active). Content switch stays below. */}
      <div className="border-b border-gray-200 mb-6">
        <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
          <TabsList variant="line">
            {TABS.map((tt) => (
              <TabsTrigger key={tt.key} value={tt.key}>{tt.label}</TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      <div key={`${tab}-${version}`}>
        {tab === "overview" && (plan.setupComplete
          ? <Overview plan={plan} eventId={eventId} onApplied={() => setReload((r) => r + 1)} onOpenBudget={() => setTab("budget")} onOpenDeliverable={(id) => { setDeliverableJump(id); setTab("deliverables"); }} onOpenPeople={() => setTab("people")} />
          : <EventSetup plan={plan} eventId={eventId} onApplied={() => setReload((r) => r + 1)} />)}
        {tab === "people" && <PeoplePage eventFilter={{ id: eventId, name: plan.title, tag: plan.tags[0] ?? null, status: peopleStatus }} />}
        {tab === "vendors" && <VendorDecisions eventId={eventId} location={plan.location} initial={plan.engagements} />}
        {tab === "budget" && (plan.budget
          ? <BudgetTracker budget={plan.budget} eventId={eventId} />
          : <div className="bg-white rounded-2xl border border-border p-6 text-sm text-gray-400">No budget attached to this event yet.</div>)}
        {tab === "deliverables" && (
          <div className="space-y-6">
            <Deliverables eventId={eventId} initial={plan.deliverables} phases={plan.phases} jumpId={deliverableJump} linearProjectUrl={plan.linearProjectUrl} onLinearSynced={() => setReload((r) => r + 1)} />
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

      {/* Fixed lower-right pill that expands a Linear update composer — available on every tab. */}
      <LinearUpdateBox eventId={eventId} linearSynced={!!plan.linearProjectId} onApplied={() => setReload((r) => r + 1)} variant="floating" />
    </div>
  );
}
