import { useEffect, useState } from "react";
import {
  Calendar, Users, Plus, Trash2, Check, Paperclip,
  AlertCircle, Lightbulb, ChevronRight, ChevronLeft, ExternalLink,
  Mail, Activity, Send, Pencil, X, Clock, RefreshCw, Link2, Code2, Globe, LayoutGrid, List, Mic, Lock,
} from "lucide-react";
import {
  getEventPlanning, getCarriedLessons, updateEventTags, updateEvent, setEventFormat, attachLuma,
  setMacroStage, addEngagement, deleteEngagement, setEngagementStage,
  addCandidate, updateCandidate, deleteCandidate, selectCandidate, clearCandidateSelection, suggestVendors, listBudgetLines,
  addTrackerLine, setBudgetStatus, setBudgetSyncUrl, attachLineDoc, setBudgetTarget, updateBudgetLine,
  addDeliverable, setDeliverableStatus, setDeliverableDueDate, deleteDeliverable,
  getPlanningSummary, saveOverviewSummary,
  listEventUpdates, recordEventUpdate, detectUpdate, syncGmail, summarizeCorrespondence,
  ejectPage, regeneratePageDraft, setPageFields, promoteToLive, listDevelopers, addDeveloper, removeDeveloper,
  type EventUpdate, type DetectedUpdate, type PageState, type Developer,
  MACRO_STAGES, ENGAGEMENT_STAGES,
  type EventPlanning, type EngagementWithCandidates, type VendorCandidate,
  type PlanningBudget, type BudgetLineTracker, type Deliverable, type CarriedLesson,
  type PlanningFacts, type VendorSuggestion, type BudgetStatus, BUDGET_STATUSES,
} from "../lib/db";
import { TagStack } from "./TagStack";
import { FormatPicker, parseFormats, joinFormats } from "./FormatPicker";
import { LocationEdit } from "./LocationEdit";
import { EditableTitle } from "./EditableTitle";
import { StatusControl } from "./StatusControl";
import { FileDrop } from "./FileDrop";
import { EventPageBuilder } from "./EventPageBuilder";
import { CoverImage } from "./CoverImage";
import { OwnerPicker } from "./OwnerPicker";
import { DateEdit } from "./DateEdit";
import { BudgetDropZone, BudgetDropArea, BudgetImportModal } from "./BudgetImport";
import { EventSetup } from "./EventSetup";
import { ScopingForm } from "./ScopingForm";
import { loadScoping, saveScoping, fundingFor, leadTimeCheck, STATUS_LABEL, type ScopingForm as ScopingData } from "../lib/scoping";
import { domainFromUrl, isFreeMailDomain } from "../lib/url";

interface Props {
  eventId: string;
  onBack: () => void;
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
function LumaAttach({ eventId, initialUrl }: { eventId: string; initialUrl: string | null }) {
  const [url, setUrl] = useState(initialUrl);
  const [editing, setEditing] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const attach = async () => {
    const u = input.trim(); if (!u) return;
    setBusy(true); setErr(null);
    try { const r = await attachLuma(eventId, u); setUrl(r.lumaUrl ?? u); setEditing(false); setInput(""); }
    catch (e: any) { setErr(e?.message ?? String(e)); }
    finally { setBusy(false); }
  };

  if (url) return <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900"><Link2 className="w-4 h-4" /> Luma</a>;
  if (!editing) return <button onClick={() => setEditing(true)} className="inline-flex items-center gap-1 text-sm text-gray-400 hover:text-gray-700"><Link2 className="w-4 h-4" /> Attach Luma</button>;
  return (
    <span className="inline-flex items-center gap-1">
      <input autoFocus value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") attach(); }} placeholder="luma.com/…" className="px-2 py-1 border border-black rounded text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
      <button onClick={attach} disabled={busy || !input.trim()} className="px-2 py-1 bg-gray-200 rounded text-sm hover:bg-gray-300 disabled:opacity-50">{busy ? "…" : "Attach"}</button>
      <button onClick={() => setEditing(false)} className="text-gray-400 hover:text-gray-700"><X className="w-4 h-4" /></button>
      {err && <span className="text-xs text-red-600">{err}</span>}
    </span>
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
      <div className="bg-white rounded-2xl border border-black w-full max-w-md max-h-[85vh] overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-4">
          <div>
            <p className="text-xs text-gray-400 uppercase tracking-wide">Vendor</p>
            <h3 className="text-xl font-medium">{name || "Unnamed vendor"}</h3>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-gray-400 hover:text-gray-700"><X className="w-5 h-5" /></button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className="w-full px-2 py-1.5 border border-black rounded text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Quote (USD)</label>
            <input type="number" value={quote} onChange={(e) => setQuote(e.target.value)} placeholder="—" className="w-full px-2 py-1.5 border border-black rounded text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Link</label>
            <div className="flex gap-2">
              <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="Site, quote, profile…" className="flex-1 px-2 py-1.5 border border-black rounded text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
              {link.trim() && <a href={link} target="_blank" rel="noreferrer" className="inline-flex items-center px-2 text-gray-500 hover:text-gray-900"><ExternalLink className="w-4 h-4" /></a>}
            </div>
            {(() => {
              const d = domainFromUrl(link);
              if (!d) return null;
              return isFreeMailDomain(d)
                ? <p className="text-[11px] text-amber-600 mt-1">@{d} is a shared mail provider — can't match a vendor by domain; emails won't auto-link.</p>
                : <p className="text-[11px] text-gray-400 mt-1">In range: emails from <span className="font-medium">@{d}</span> (any address) link to this decision.</p>;
            })()}
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Vendor notes</label>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="Terms, contacts, context…" className="w-full px-2 py-1.5 border border-black rounded text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
          </div>
        </div>

        <div className="mt-5">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-medium">Recent correspondence</p>
            {corr && corr.length > 0 && (
              <button onClick={summarize} disabled={digesting} className="text-xs text-gray-600 hover:text-gray-900 inline-flex items-center gap-1 disabled:opacity-50">
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
                      <p className="text-xs text-gray-400">{M.label} · {relTime(u.createdAt)}{u.linkUrl && <> · <a href={u.linkUrl} target="_blank" rel="noreferrer" className="hover:text-gray-700 underline">source</a></>}</p>
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
    <div className="bg-white rounded-2xl border border-black p-5">
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
          <span key={s} className={`px-2 py-0.5 rounded-full text-xs ${
            i < stageIdx ? "bg-gray-100 text-gray-500"
              : i === stageIdx ? "bg-gray-900 text-white"
              : "bg-white text-gray-400 border border-gray-200"
          }`}>{s}</span>
        ))}
        {next && (
          <button onClick={advance} className="ml-1 inline-flex items-center gap-1 text-xs text-gray-700 hover:text-gray-900 border border-gray-300 rounded-full px-2 py-0.5 hover:bg-gray-50">
            Advance <ChevronRight className="w-3 h-3" />
          </button>
        )}
      </div>

      {notice && <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 mb-2">{notice}</p>}
      {prompt && selected && (
        <div className="text-sm bg-gray-50 border border-black rounded-lg px-3 py-2 mb-3">
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
          <p className="text-[11px] text-gray-400 mt-1">A comment or an attachment is required.</p>
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
            <input autoFocus value={candName} onChange={(e) => setCandName(e.target.value)} placeholder="Vendor name" className="flex-1 px-2 py-1 border border-black rounded text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
            <input value={candQuote} onChange={(e) => setCandQuote(e.target.value)} type="number" placeholder="Quote" className="w-24 px-2 py-1 border border-black rounded text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
          </div>
          <input value={candLink} onChange={(e) => setCandLink(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addCand(); }} placeholder="Link / info (required) — site, quote, profile…" className="w-full px-2 py-1 border border-black rounded text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
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
        <div className="bg-white rounded-2xl border border-black overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 border-b border-black">
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
                      <span className={`px-2 py-0.5 rounded-full text-xs ${e.stage === "Contracted" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"}`}>{e.stage ?? "—"}</span>
                      {idx >= 0 && <span className="text-xs text-gray-400 ml-2">{idx + 1}/{ENGAGEMENT_STAGES.length}</span>}
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
          <p className="px-4 py-2 text-xs text-gray-400">Switch to Cards to edit a decision, advance stages, or add candidates.</p>
        </div>
      )}

      <div className="flex gap-2">
        <input value={newCat} onChange={(e) => setNewCat(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add(); }} placeholder="New decision category (e.g. Venue, Catering, A/V)" className="flex-1 px-3 py-2 border border-black rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
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
  const [sync, setSync] = useState(line.syncUrl ?? "");
  const [savingSync, setSavingSync] = useState(false);

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
      <div className="bg-white rounded-2xl border border-black max-w-lg w-full max-h-[85vh] overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl">Budget line</h2>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-900" aria-label="Close"><X className="w-5 h-5" /></button>
        </div>

        <div className="space-y-4">
          <div className="flex gap-2">
            <input value={label} onChange={(e) => setLabel(e.target.value)} onBlur={saveMeta} placeholder="Category" className="flex-1 px-3 py-2 border border-black rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
            <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} onBlur={saveMeta} placeholder="Amount" className="w-32 px-3 py-2 text-right border border-black rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
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
            <p className="text-sm font-medium mb-1.5">Material</p>
            {line.docUrl ? (
              <span className="inline-flex items-center gap-3 text-sm">
                <a href={line.docUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-gray-700 hover:text-gray-900"><Paperclip className="w-4 h-4" /> View attachment</a>
                <button onClick={() => setDoc(null)} className="text-gray-400 hover:text-red-600 text-xs">remove</button>
              </span>
            ) : (
              <FileDrop label="Attach a quote / invoice / contract" onUploaded={(url) => setDoc(url)} />
            )}
          </div>

          <div>
            <p className="text-sm font-medium mb-1.5">Sync from email</p>
            <div className="flex gap-2">
              <input value={sync} onChange={(e) => setSync(e.target.value)} placeholder="Vendor portal / quote thread URL" className="flex-1 px-3 py-2 border border-black rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
              <button onClick={saveSync} disabled={savingSync || sync.trim() === (line.syncUrl ?? "")} className="px-3 py-2 bg-gray-200 rounded-lg text-sm hover:bg-gray-300 disabled:opacity-50">{savingSync ? "Saving…" : "Save"}</button>
            </div>
            <p className="text-xs text-gray-400 mt-1.5 inline-flex items-start gap-1"><Mail className="w-3.5 h-3.5 mt-0.5 shrink-0" /> Replies on this thread will auto-log to this line and flow into the event's updates & progress (once email sync ships).</p>
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
  const [lines, setLines] = useState(budget.lines);
  const [target, setTarget] = useState<number | null>(budget.targetAmount);
  const [targetInput, setTargetInput] = useState(budget.targetAmount != null ? String(budget.targetAmount) : "");
  const [filter, setFilter] = useState<"all" | BudgetStatus>("all");
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
  const setStatus = async (id: string, s: BudgetStatus) => { patch(id, { status: s }); await setBudgetStatus(id, s); };
  const addLine = async () => {
    const label = newLabel.trim();
    if (!label) return;
    const amt = newAmount.trim() === "" ? null : Number(newAmount);
    const l = await addTrackerLine(budget.id, label, amt);
    setLines((p) => [...p, l]); setNewLabel(""); setNewAmount("");
  };
  const saveTarget = async (v: string) => { const n = v.trim() === "" ? null : Number(v); setTarget(n); await setBudgetTarget(budget.id, n); };

  const tiles = BUDGET_STATUSES.map((st) => ({ label: BUDGET_STATUS_META[st].label, value: sumFor(st), ring: BUDGET_STATUS_META[st].ring }));
  const openLine = lines.find((l) => l.id === openId) ?? null;

  return (
    <BudgetDropArea onFile={setDropFile} className="bg-white rounded-2xl border border-black p-6">
      {importNote && <p className="text-xs text-gray-500 inline-flex items-center gap-1 mb-3"><Check className="w-3.5 h-3.5 text-green-600" /> {importNote}</p>}
      {lines.length === 0 ? (
        <BudgetDropZone label="Drop a budget breakdown (CSV) here, or click to choose" onFile={setDropFile} className="w-full min-h-[5rem] mb-5" />
      ) : (
        <div className="flex justify-end mb-4">
          <BudgetDropZone label="Drop or choose a breakdown" onFile={setDropFile} className="shrink-0" />
        </div>
      )}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-5">
        {tiles.map((t) => (
          <div key={t.label} className={`rounded-2xl ring-2 ring-inset ${t.ring} p-4`}>
            <p className="text-gray-500 text-sm mb-1">{t.label}</p>
            <p className="text-2xl">{money(t.value, cur)}</p>
          </div>
        ))}
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
            style={{ width: `${Math.max(3, targetInput.length + 2.5)}ch` }}
            className="px-2 py-1 border border-black rounded text-right focus:outline-none focus:ring-2 focus:ring-gray-300"
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
                  <select
                    value={l.status}
                    onChange={(e) => setStatus(l.id, e.target.value as BudgetStatus)}
                    className={`px-2 py-0.5 rounded-full text-xs border-0 cursor-pointer focus:outline-none focus:ring-2 focus:ring-gray-300 ${BUDGET_STATUS_META[l.status].badge}`}
                  >
                    {BUDGET_STATUSES.map((s) => <option key={s} value={s}>{BUDGET_STATUS_META[s].label}</option>)}
                  </select>
                </td>
                <td className="px-3 py-2 text-right whitespace-nowrap text-gray-400">
                  <span className="inline-flex items-center gap-2 justify-end">
                    {l.docUrl && <Paperclip className="w-3.5 h-3.5" />}
                    {l.syncUrl && <Link2 className="w-3.5 h-3.5" />}
                    <ChevronRight className="w-3.5 h-3.5" />
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex gap-2 mt-3">
        <input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addLine(); }} placeholder="Add line (e.g. Marketing)" className="flex-1 px-2 py-1 border border-black rounded text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
        <input value={newAmount} onChange={(e) => setNewAmount(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addLine(); }} type="number" placeholder="Amount" className="w-28 px-2 py-1 border border-black rounded text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
        <button onClick={addLine} disabled={!newLabel.trim()} className="px-3 py-1 bg-gray-200 rounded text-sm hover:bg-gray-300 disabled:opacity-50">Add line</button>
      </div>

      <p className="text-xs text-gray-400 mt-4 flex items-start gap-1">
        <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
        Projected view (predicted cost per category from comparable past events) needs more budget history — coming later.
      </p>
    </BudgetDropArea>
  );
}

// ── Deliverables ────────────────────────────────────────────────────────────
function Deliverables({ eventId, initial }: { eventId: string; initial: Deliverable[] }) {
  const [items, setItems] = useState(initial);
  const [adding, setAdding] = useState<string | null>(null); // phase being added to
  const [title, setTitle] = useState("");
  const [owner, setOwner] = useState("");
  const [due, setDueInput] = useState("");

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

  const otherPhases = Array.from(new Set(items.map((d) => d.phase).filter((p): p is string => !!p && !DELIVERABLE_PHASES.includes(p))));
  const phases = [...DELIVERABLE_PHASES, ...otherPhases];

  return (
    <div className="bg-white rounded-2xl border border-black p-6">
      <div className="flex items-center justify-between mb-1">
        <p className="text-sm text-gray-600">{done}/{total} done</p>
        <p className="text-sm text-gray-600">{pct}%</p>
      </div>
      <div className="h-2 bg-gray-100 rounded-full mb-5 overflow-hidden">
        <div className="h-full bg-gray-900 rounded-full transition-all" style={{ width: `${pct}%` }} />
      </div>

      <div className="space-y-5">
        {phases.map((phase) => {
          const group = items.filter((d) => d.phase === phase);
          return (
            <div key={phase}>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-medium text-gray-700">{phase}</h3>
                <button onClick={() => { setAdding(adding === phase ? null : phase); setTitle(""); setOwner(""); setDueInput(""); }} className="text-xs text-gray-500 hover:text-gray-900 inline-flex items-center gap-1"><Plus className="w-3 h-3" /> Add</button>
              </div>
              <div className="rounded-lg border border-gray-200 divide-y divide-gray-100">
                {group.length === 0 && adding !== phase && <p className="px-3 py-2 text-sm text-gray-400">None.</p>}
                {group.map((d) => {
                  const overdue = d.dueDate && d.dueDate < today() && d.status !== "Done";
                  return (
                    <div key={d.id} className="px-3 py-2 flex items-center gap-3 text-sm group">
                      <div className="flex-1 min-w-0">
                        <p className={d.status === "Done" ? "line-through text-gray-400" : ""}>{d.title}</p>
                        <span className="inline-flex items-center gap-1 text-xs text-gray-500">
                          {overdue && <span className="text-red-600 font-medium">overdue</span>}
                          <DateEdit value={d.dueDate} onChange={(iso) => setDue(d.id, iso)} placeholder="add due date" emphasize={!!overdue} />
                        </span>
                      </div>
                      {/* People/outreach tag — placeholder for a future outreach page. */}
                      <button title="People & outreach for this task — coming soon" className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border border-gray-300 text-gray-600 hover:bg-gray-50 shrink-0">
                        <Users className="w-3 h-3" /> {d.ownerRole ?? "People"}
                      </button>
                      <select value={d.status ?? "Todo"} onChange={(e) => setStatus(d.id, e.target.value)} className="text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-gray-300">
                        {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                      <button onClick={() => remove(d.id)} className="text-gray-300 hover:text-red-600 opacity-0 group-hover:opacity-100" aria-label="Delete"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  );
                })}
                {adding === phase && (
                  <div className="px-3 py-2 flex flex-wrap gap-2 items-center bg-gray-50">
                    <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add(phase); }} placeholder="Task" className="flex-1 min-w-[8rem] px-2 py-1 border border-black rounded text-sm focus:outline-none" />
                    <input value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="Owner role" className="w-28 px-2 py-1 border border-black rounded text-sm focus:outline-none" />
                    <span className="px-1 border border-black rounded"><DateEdit value={due || null} onChange={(iso) => setDueInput(iso ?? "")} placeholder="due date" /></span>
                    <button onClick={() => add(phase)} disabled={!title.trim()} className="px-3 py-1 bg-gray-200 rounded text-sm hover:bg-gray-300 disabled:opacity-50">Add</button>
                    <button onClick={() => setAdding(null)} className="text-sm text-gray-500 hover:text-gray-900">Cancel</button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
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

  if (lessons === null) return <div className="bg-white rounded-2xl border border-black p-6 text-sm text-gray-400">Finding comparable past events…</div>;
  if (lessons.length === 0) return <div className="bg-white rounded-2xl border border-black p-6 text-sm text-gray-400">No comparable past events with lessons yet.</div>;

  return (
    <div className="bg-white rounded-2xl border border-black divide-y divide-gray-100">
      {lessons.map((l, i) => (
        <div key={i} className="px-6 py-4 flex gap-3">
          <Lightbulb className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm text-gray-700">{l.body}</p>
            <p className="text-xs text-gray-400 mt-1">from {l.sourceEventName}{l.why ? ` · ${l.why}` : ""}</p>
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
      if (p.kind === "complete" && p.deliverableId) {
        await setDeliverableStatus(p.deliverableId, "Done");
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
    <div className="bg-white rounded-2xl border border-black p-5">
      {/* Composer — manual entry; "Sync inbox" pulls real Gmail from vendor domains. */}
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-1">
          {(["email", "linear"] as const).map((s) => {
            const M = SOURCE_META[s];
            return (
              <button key={s} onClick={() => setSource(s)} className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs border ${source === s ? "bg-gray-900 text-white border-gray-900" : "bg-white text-gray-600 border-gray-200 hover:border-gray-400"}`}>
                <M.Icon className="w-3 h-3" /> {M.label}
              </button>
            );
          })}
        </div>
        <button onClick={runSync} disabled={syncing} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50">
          <Mail className="w-3 h-3" /> {syncing ? "Syncing…" : "Sync inbox"}
        </button>
      </div>
      {syncMsg && <p className="text-xs text-gray-500 mb-2">{syncMsg}</p>}
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
      {err && <p className="text-xs text-red-600 mt-2">{err}</p>}
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
                  <span className="text-[11px] bg-gray-100 text-gray-600 rounded-full px-1.5 py-0.5 shrink-0">{items.length} email{items.length === 1 ? "" : "s"}</span>
                  <span className="text-xs text-gray-400 truncate flex-1">{brief}</span>
                </button>
                {isOpen && (
                  <div className="border-t border-gray-100">
                    {canSummarize && (
                      <div className="px-3 py-2 bg-gray-50/70 border-b border-gray-100">
                        {digests[k]
                          ? <p className="text-sm text-gray-700">{digests[k]}</p>
                          : <button onClick={() => summarizeGroup(k)} disabled={digestingKey === k} className="text-xs text-gray-600 hover:text-gray-900 inline-flex items-center gap-1 disabled:opacity-50"><Lightbulb className="w-3.5 h-3.5" /> {digestingKey === k ? "Summarizing…" : "Summarize interaction"}</button>}
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
                              <p className="text-xs text-gray-400 mt-0.5">
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
function ProgressBar({ label, value, max, hint }: { label: string; value: number; max: number; hint: string }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className="bg-white rounded-2xl border border-black p-4">
      <div className="flex items-center justify-between mb-1"><p className="text-sm text-gray-600">{label}</p><p className="text-sm text-gray-500">{pct}%</p></div>
      <div className="h-2 bg-gray-100 rounded-full overflow-hidden mb-2"><div className="h-full bg-gray-900 rounded-full transition-all" style={{ width: `${pct}%` }} /></div>
      <p className="text-xs text-gray-500">{hint}</p>
    </div>
  );
}

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

/** Compact at-a-glance scoping summary for the Overview — status + a few key facts, with a
 *  deep-link into the full form (which lives in the Budget flow). If not yet generated, this
 *  is a prompt to start. */
function ScopingGlance({ plan, scoping, roughTotal, onOpen }: { plan: EventPlanning; scoping: ScopingData; roughTotal: number; onOpen: () => void }) {
  const funding = fundingFor(plan.tags);
  const lead = leadTimeCheck(plan.date);
  const statusCls = scoping.status === "assigned" ? "bg-green-100 text-green-700" : scoping.status === "submitted" ? "bg-amber-100 text-amber-700" : "bg-gray-100 text-gray-600";

  if (!scoping.generated) {
    return (
      <div className="bg-white rounded-2xl border border-black p-5 flex items-center justify-between gap-3">
        <div>
          <h3 className="font-medium">Scoping form</h3>
          <p className="text-sm text-gray-400 mt-0.5">Not started — generate the brief to request a budget.</p>
        </div>
        <button onClick={onOpen} className="px-3 py-1.5 bg-gray-900 text-white rounded-lg text-sm hover:bg-gray-800 shrink-0">Start scoping</button>
      </div>
    );
  }
  return (
    <div className="bg-white rounded-2xl border border-black p-5">
      <div className="flex items-start justify-between gap-3 mb-3">
        <h3 className="font-medium">Scoping</h3>
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs ${statusCls}`}>{scoping.status === "assigned" && <Lock className="w-3 h-3" />}{STATUS_LABEL[scoping.status]}</span>
      </div>
      <dl className="space-y-1.5 text-sm">
        <div className="flex justify-between gap-2"><dt className="text-gray-500">Date</dt><dd>{plan.date ?? "—"} {lead.days != null && (lead.ok ? <span className="text-green-600">· {lead.days}d ✓</span> : <span className="text-red-600">· {lead.days}d ⚠</span>)}</dd></div>
        <div className="flex justify-between gap-2"><dt className="text-gray-500">Funding</dt><dd>{funding.fundingLine} · {funding.tier}</dd></div>
        <div className="flex justify-between gap-2"><dt className="text-gray-500">Rough cost</dt><dd>{money(roughTotal)}</dd></div>
        {scoping.assignedBudget != null && (
          <div className="flex justify-between gap-2"><dt className="text-gray-500">Assigned</dt><dd className="inline-flex items-center gap-1"><Lock className="w-3 h-3 text-gray-400" />{money(scoping.assignedBudget)}</dd></div>
        )}
      </dl>
      <button onClick={onOpen} className="mt-3 text-sm text-gray-600 hover:text-gray-900 inline-flex items-center gap-1">View full form <ChevronRight className="w-4 h-4" /></button>
    </div>
  );
}

/** Budget flow: (1) submit scoping form — opened from here, (2) receive budget (Karim's
 *  assigned target), (3) track budget — guidance to track spend + add vendor info. */
function BudgetFlow({ scoping, onOpenScoping }: { scoping: ScopingData; onOpenScoping: () => void }) {
  const step1 = scoping.status !== "draft";
  const step2 = scoping.assignedBudget != null;
  return (
    <div className="bg-white rounded-2xl border border-black p-5">
      <h3 className="font-medium mb-3">Budget flow</h3>
      <ol className="space-y-3">
        <li className="flex items-center gap-3">
          <span className={`flex items-center justify-center w-6 h-6 rounded-full text-xs shrink-0 ${step1 ? "bg-green-600 text-white" : "bg-gray-100 text-gray-500"}`}>{step1 ? <Check className="w-3.5 h-3.5" /> : 1}</span>
          <span className="flex-1 text-sm"><span className={step1 ? "text-gray-500 line-through" : ""}>Submit scoping form</span> <span className="text-gray-400">· {step1 ? "submitted" : "generate & submit the brief"}</span></span>
          <button onClick={onOpenScoping} className="px-3 py-1 bg-gray-200 rounded-lg text-xs hover:bg-gray-300 shrink-0">{scoping.generated ? "Open" : "Start"} scoping form</button>
        </li>
        <li className="flex items-center gap-3">
          <span className={`flex items-center justify-center w-6 h-6 rounded-full text-xs shrink-0 ${step2 ? "bg-green-600 text-white" : "bg-gray-100 text-gray-500"}`}>{step2 ? <Check className="w-3.5 h-3.5" /> : 2}</span>
          <span className="flex-1 text-sm"><span className={step2 ? "text-gray-500 line-through" : ""}>Receive budget</span> <span className="text-gray-400">· {step2 ? `assigned ${money(scoping.assignedBudget)}` : step1 ? "awaiting Karim's assignment" : "pending scoping submission"}</span></span>
        </li>
        <li className="flex items-start gap-3">
          <span className="flex items-center justify-center w-6 h-6 rounded-full text-xs shrink-0 bg-gray-100 text-gray-500">3</span>
          <span className="flex-1 text-sm"><span>Track budget</span> <span className="text-gray-400">· track spend against the assigned budget on the Budget tab — add vendor info on the Vendor tab to keep tracking accurate.</span></span>
        </li>
      </ol>
    </div>
  );
}

function Overview({ plan, eventId, onApplied }: { plan: EventPlanning; eventId: string; onApplied: () => void }) {
  const facts = buildFacts(plan);
  // Use the cached digest; only regenerate on Resync (which also pulls Gmail).
  const [summary, setSummary] = useState<string | null>(plan.overviewSummary);
  const [resyncing, setResyncing] = useState(false);
  const [resyncMsg, setResyncMsg] = useState<string | null>(null);

  // Scoping (client-side). The full form opens as a modal from the budget flow / glance card.
  const [scoping, setScoping] = useState<ScopingData>(() => loadScoping(eventId));
  const [scopingOpen, setScopingOpen] = useState(false);
  const updateScoping = (s: ScopingData) => { setScoping(s); saveScoping(eventId, s); };
  const roughTotal = (plan.budget?.lines ?? []).reduce((s, l) => s + (l.confirmedAmount ?? 0), 0);

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

  const t = today();
  const contracted = plan.engagements.filter((e) => e.stage === "Contracted");
  // Genuinely pending = in motion. Freshly-seeded categories (still at "Sourced" with no
  // candidates) aren't actually pending yet, so they stay out of this box.
  const pendingEngagements = plan.engagements.filter((e) => e.stage !== "Contracted" && (e.candidates.length > 0 || e.stage !== "Sourced"));
  const paidLines = (plan.budget?.lines ?? []).filter((l) => l.status === "paid");
  const pendingLines = (plan.budget?.lines ?? []).filter((l) => l.status === "quoted" || l.status === "in_review");
  // Status digest is stored as one fact per line → render as bullets.
  const summaryBullets = (summary ?? "").split("\n").map((l) => l.replace(/^[\s•\-*]+/, "").trim()).filter(Boolean);
  const upcoming = plan.deliverables
    .filter((d) => d.status !== "Done")
    .sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"));

  return (
    <div className="space-y-6">
      {/* Digest — cached; regenerated only on Resync (which also syncs Gmail). */}
      <div className="bg-white rounded-2xl border border-black p-5">
        <div className="flex items-start justify-between gap-3">
          {summaryBullets.length > 0 ? (
            <ul className="flex-1 list-disc pl-5 space-y-1 text-gray-700 leading-relaxed">
              {summaryBullets.map((b, i) => <li key={i}>{b}</li>)}
            </ul>
          ) : (
            <p className="text-gray-400 flex-1">No status digest yet — hit Resync to pull email and generate one.</p>
          )}
          <button onClick={resync} disabled={resyncing} className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50">
            <RefreshCw className={`w-3 h-3 ${resyncing ? "animate-spin" : ""}`} /> {resyncing ? "Resyncing…" : "Resync"}
          </button>
        </div>
        {resyncMsg && <p className="text-xs text-gray-400 mt-2">{resyncMsg}</p>}
      </div>

      {/* Scoping at-a-glance + budget flow (scoping form opens from here) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <ScopingGlance plan={plan} scoping={scoping} roughTotal={roughTotal} onOpen={() => setScopingOpen(true)} />
        <BudgetFlow scoping={scoping} onOpenScoping={() => setScopingOpen(true)} />
      </div>
      {scopingOpen && (
        <ScopingForm plan={plan} scoping={scoping} roughTotal={roughTotal} onChange={updateScoping} onClose={() => setScopingOpen(false)} />
      )}

      {/* Progress bars */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <ProgressBar label="Deliverables" value={facts.deliverables.done} max={facts.deliverables.total}
          hint={`${facts.deliverables.done}/${facts.deliverables.total} done${facts.deliverables.overdue ? ` · ${facts.deliverables.overdue} overdue` : ""}`} />
        <ProgressBar label="Vendors" value={contracted.length} max={plan.engagements.length}
          hint={`${contracted.length}/${plan.engagements.length} contracted`} />
        <ProgressBar label="Budget vs target" value={facts.budget?.committed ?? 0} max={facts.budget?.target ?? 0}
          hint={facts.budget?.target != null ? `${money(facts.budget.committed)} of ${money(facts.budget.target)}` : `${money(facts.budget?.committed ?? 0)} committed`} />
      </div>

      {/* Coming up / Pending / Confirmed */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl border border-black p-5">
          <h3 className="font-medium mb-3">Coming up</h3>
          <ul className="space-y-2 text-sm">
            {upcoming.length === 0 && <li className="text-gray-400">All caught up.</li>}
            {upcoming.slice(0, 6).map((d) => {
              const overdue = d.dueDate && d.dueDate < t;
              return (
                <li key={d.id} className="flex justify-between gap-2">
                  <span>{d.title}</span>
                  <span className={`shrink-0 ${overdue ? "text-red-600 font-medium" : "text-gray-400"}`}>{overdue ? "overdue" : d.dueDate ?? "—"}</span>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="bg-white rounded-2xl border border-black p-5">
          <h3 className="font-medium mb-3 text-amber-700">Pending</h3>
          <ul className="space-y-2 text-sm">
            {pendingEngagements.length === 0 && pendingLines.length === 0 && <li className="text-gray-400">Nothing pending.</li>}
            {pendingEngagements.map((e) => (
              <li key={e.id} className="flex justify-between gap-2"><span>{e.category}</span><span className="text-gray-400 shrink-0">{e.stage}</span></li>
            ))}
            {pendingLines.map((l) => (
              <li key={l.id} className="flex justify-between gap-2 text-gray-500"><span>Unpaid: {l.label}</span><span className="shrink-0">{money(l.confirmedAmount)}</span></li>
            ))}
          </ul>
        </div>

        <div className="bg-white rounded-2xl border border-black p-5">
          <h3 className="font-medium mb-3 text-green-700">Confirmed</h3>
          <ul className="space-y-2 text-sm">
            {contracted.length === 0 && paidLines.length === 0 && <li className="text-gray-400">Nothing locked yet.</li>}
            {contracted.map((e) => (
              <li key={e.id} className="flex justify-between gap-2">
                <span>{e.category}{e.candidates.find((c) => c.isSelected)?.vendorName ? ` · ${e.candidates.find((c) => c.isSelected)!.vendorName}` : ""}</span>
                <span className="text-gray-500 shrink-0">{money(e.confirmedAmount)}</span>
              </li>
            ))}
            {paidLines.map((l) => (
              <li key={l.id} className="flex justify-between gap-2 text-gray-500"><span>Paid: {l.label}</span><span className="shrink-0">{money(l.confirmedAmount)}</span></li>
            ))}
          </ul>
        </div>
      </div>

      {/* Auto-updates (email / Linear) */}
      <div>
        <h3 className="text-lg font-medium mb-3">Auto-updates</h3>
        <AutoUpdates eventId={eventId} engagements={plan.engagements} onApplied={onApplied} />
      </div>

      {/* Carried lessons */}
      <div>
        <h3 className="text-lg font-medium mb-3">Carried lessons</h3>
        <CarriedLessons eventId={eventId} />
      </div>
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
    <div className="bg-white rounded-2xl border border-black p-5">
      <h3 className="font-medium mb-1">Developer access</h3>
      <p className="text-xs text-gray-400 mb-3">Per-event. Unlocks eject / pull / push / promote for this page only. (Enforced once auth lands.)</p>
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
        <input value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add(); }} placeholder="developer@email.com" className="flex-1 px-2 py-1 border border-black rounded text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
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
        <div className="bg-white rounded-2xl border border-black p-5">
          <div className="flex items-center gap-2 mb-2">
            <span className="px-2.5 py-1 rounded-full text-xs bg-blue-100 text-blue-700">Generated</span>
            <span className="text-sm text-gray-500">Data-bound — renders from event data.</span>
          </div>
          <p className="text-sm text-gray-600 mb-4">Take this page to code for bespoke work (custom hero, animation, novel layout). Auto-fill stops and data binding freezes — regeneration will only produce a draft to diff.</p>
          <button onClick={() => setConfirming(true)} className="inline-flex items-center gap-1 px-4 py-2 bg-gray-900 text-white rounded-lg text-sm hover:bg-gray-800"><Code2 className="w-4 h-4" /> Take to code (Eject)</button>
          {confirming && (
            <div className="mt-3 text-sm bg-amber-50 border border-amber-300 rounded-lg p-3">
              <p className="font-medium">Eject this page to code?</p>
              <p className="text-gray-700 mt-1">Data binding freezes for this page; regeneration will no longer auto-fill — only draft a diff. The seed includes <span className="font-medium">public fields only</span> (name, date, location, tags, description, format, audience, cover, Luma). Budget, vendors, and candidates are never written into ejected source.</p>
              <div className="flex gap-2 mt-2">
                <button onClick={eject} disabled={busy} className="px-3 py-1 bg-gray-900 text-white rounded text-sm disabled:opacity-50">{busy ? "Ejecting…" : "Eject"}</button>
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
      <div className="bg-white rounded-2xl border border-black p-5 space-y-4">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="px-2.5 py-1 rounded-full text-xs bg-purple-100 text-purple-700">Dev-owned</span>
          <span className="text-sm text-gray-500">Deployed from code · binding frozen{page.ejectedAt ? ` · ejected ${page.ejectedAt.slice(0, 10)}` : ""}</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
          <div><p className="text-gray-500 text-xs mb-1">Repo path</p><p className="font-mono">{page.repoRef ?? "—"}</p></div>
          <div>
            <p className="text-gray-500 text-xs mb-1">Deploy status</p>
            <select defaultValue={page.lastDeployStatus ?? "none"} onChange={(e) => { setPage((p) => ({ ...p, lastDeployStatus: e.target.value })); save({ lastDeployStatus: e.target.value }); }} className="px-2 py-1 border border-gray-300 rounded text-sm">
              {DEPLOY_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <p className="text-gray-500 text-xs mb-1">Preview URL</p>
            <div className="flex items-center gap-2">
              <input defaultValue={page.previewUrl ?? ""} onBlur={(e) => { setPage((p) => ({ ...p, previewUrl: e.target.value || null })); save({ previewUrl: e.target.value || null }); }} placeholder="https://preview…" className="flex-1 px-2 py-1 border border-gray-300 rounded text-sm" />
              {page.previewUrl && <a href={page.previewUrl} target="_blank" rel="noreferrer" className="text-gray-500 hover:text-gray-900"><ExternalLink className="w-4 h-4" /></a>}
            </div>
          </div>
          <div>
            <p className="text-gray-500 text-xs mb-1">Live URL</p>
            <div className="flex items-center gap-2">
              <input defaultValue={page.liveUrl ?? ""} onBlur={(e) => { setPage((p) => ({ ...p, liveUrl: e.target.value || null })); save({ liveUrl: e.target.value || null }); }} placeholder="https://live…" className="flex-1 px-2 py-1 border border-gray-300 rounded text-sm" />
              {page.liveUrl && <a href={page.liveUrl} target="_blank" rel="noreferrer" className="text-gray-500 hover:text-gray-900"><ExternalLink className="w-4 h-4" /></a>}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 pt-3 border-t border-gray-100">
          <button onClick={regen} className="inline-flex items-center gap-1 px-3 py-1.5 border border-gray-300 rounded-lg text-sm hover:bg-gray-50"><RefreshCw className="w-3.5 h-3.5" /> Regenerate draft to diff</button>
          <button onClick={promote} disabled={!page.previewUrl || !isAdmin} title="Admin sign-off: promote preview → live" className="inline-flex items-center gap-1 px-3 py-1.5 bg-gray-900 text-white rounded-lg text-sm hover:bg-gray-800 disabled:opacity-50"><Globe className="w-3.5 h-3.5" /> Promote to live (Admin)</button>
        </div>
        {diff && (
          <div className="text-sm border border-gray-200 rounded-lg p-3">
            <p className="font-medium mb-2">Data drift since eject {diff.length === 0 && <span className="text-gray-400 font-normal">— none</span>}</p>
            {diff.map((d) => (
              <div key={d.field} className="py-1 border-t border-gray-100 first:border-0">
                <p className="text-xs text-gray-500">{d.field}</p>
                <p className="text-xs"><span className="text-red-600 line-through">{d.was}</span> → <span className="text-green-700">{d.now}</span></p>
              </div>
            ))}
            <p className="text-[11px] text-gray-400 mt-2">Reference only — never auto-applied. Update the code to match.</p>
          </div>
        )}
        <p className="text-[11px] text-gray-400">Assembly doesn't host or render dev-owned pages — they deploy from code. Git dir creation, CI preview builds, and promote run in your pipeline; these fields surface their state.</p>
      </div>
      <DeveloperManager eventId={eventId} />
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
type Tab = "overview" | "vendors" | "budget" | "deliverables" | "page";
const TABS: { key: Tab; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "deliverables", label: "Deliverables" },
  { key: "vendors", label: "Vendor" },
  { key: "budget", label: "Budget" },
  { key: "page", label: "Page" },
];

export function EventPlanningPage({ eventId, onBack, onViewPeople }: Props) {
  const [plan, setPlan] = useState<EventPlanning | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
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

  const back = (
    <button onClick={onBack} className="inline-flex items-center gap-1 mb-6 px-3 py-1.5 bg-white border border-black rounded-lg text-black hover:bg-gray-50 transition-colors">
      <ChevronLeft className="w-4 h-4" /> Previous
    </button>
  );

  if (error) return <div>{back}<p className="text-red-600 bg-red-50 border border-red-200 rounded-lg p-4">Couldn’t load event: {error}</p></div>;
  if (!plan) return <div>{back}<p className="text-gray-500 py-12 text-center">Loading planning view…</p></div>;

  const headcount = plan.capacity != null ? `${plan.rsvp ?? 0} / ${plan.capacity} expected` : plan.rsvp != null ? `${plan.rsvp} expected` : "—";

  return (
    <div>
      {back}

      {/* Header */}
      <div className="bg-white rounded-2xl border border-black p-8 mb-6">
        <div className="header-row flex gap-10">
          <div className="flex-1 min-w-0">
            <div className="mb-3"><TagStack tags={plan.tags} editable onChange={(tags) => { setPlan((p) => (p ? { ...p, tags } : p)); void updateEventTags(eventId, tags); }} /></div>
            <div className="mb-4">
              <EditableTitle value={plan.title} onChange={(name) => { setPlan((p) => (p ? { ...p, title: name } : p)); void updateEvent(eventId, { name }); }} className="text-3xl" />
            </div>
            <div className="mb-4 flex items-center gap-4 flex-wrap">
              <StatusControl eventId={eventId} status={plan.status} eventDate={plan.date} onChange={(s) => setPlan((p) => (p ? { ...p, status: s } : p))} />
              <LumaAttach eventId={eventId} initialUrl={plan.lumaUrl} />
            </div>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 mb-5 text-gray-600">
              <div className="flex items-center gap-2"><Calendar className="w-5 h-5" /><span>{plan.date ?? "Date TBD"}</span></div>
              <LocationEdit value={plan.location} onChange={(location) => { setPlan((p) => (p ? { ...p, location } : p)); void updateEvent(eventId, { location }); }} />
              <FormatPicker value={parseFormats(plan.format)} onChange={(arr) => { const format = joinFormats(arr); setPlan((p) => (p ? { ...p, format } : p)); void setEventFormat(eventId, format); }} />
              <button onClick={() => onViewPeople({ id: plan.id, name: plan.title, tag: plan.tags[0] ?? null, status: 'all' })} className="flex items-center gap-2 hover:text-gray-900 text-left">
                <Users className="w-5 h-5" /><span className="underline decoration-dotted underline-offset-4">{headcount}</span>
              </button>
              <button onClick={() => onViewPeople({ id: plan.id, name: plan.title, tag: plan.tags[0] ?? null, status: 'speakers' })} className="flex items-center gap-2 hover:text-gray-900 text-left">
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
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-gray-200 mb-6">
        {TABS.map((tt) => (
          <button
            key={tt.key}
            onClick={() => setTab(tt.key)}
            className={`px-4 py-2 text-sm -mb-px border-b-2 transition-colors ${
              tab === tt.key ? "border-gray-900 text-gray-900 font-medium" : "border-transparent text-gray-500 hover:text-gray-800"
            }`}
          >
            {tt.label}
          </button>
        ))}
        {/* People isn't an inline tab — it navigates to the same place as the headcount button. */}
        <button
          onClick={() => onViewPeople({ id: plan.id, name: plan.title, tag: plan.tags[0] ?? null, status: 'all' })}
          className="px-4 py-2 text-sm -mb-px border-b-2 border-transparent text-gray-500 hover:text-gray-800 transition-colors"
        >
          People
        </button>
      </div>

      <div key={`${tab}-${version}`}>
        {tab === "overview" && (plan.setupComplete
          ? <Overview plan={plan} eventId={eventId} onApplied={() => setReload((r) => r + 1)} />
          : <EventSetup plan={plan} eventId={eventId} onApplied={() => setReload((r) => r + 1)} />)}
        {tab === "vendors" && <VendorDecisions eventId={eventId} location={plan.location} initial={plan.engagements} />}
        {tab === "budget" && (plan.budget
          ? <BudgetTracker budget={plan.budget} eventId={eventId} />
          : <div className="bg-white rounded-2xl border border-black p-6 text-sm text-gray-400">No budget attached to this event yet.</div>)}
        {tab === "deliverables" && <Deliverables eventId={eventId} initial={plan.deliverables} />}
        {tab === "page" && (
          <div className="space-y-6">
            <EventPageBuilder plan={plan} />
            <details className="bg-white rounded-2xl border border-black">
              <summary className="px-5 py-3 cursor-pointer text-sm text-gray-600 hover:text-gray-900">Advanced — take to code (eject)</summary>
              <div className="px-5 pb-5"><PageOwnership eventId={eventId} initial={plan.page} /></div>
            </details>
          </div>
        )}
      </div>
    </div>
  );
}
