import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X, Check, Send, Lock, Sparkles, RefreshCw, AlertCircle, Copy } from "lucide-react";
import { parseFormats } from "./FormatPicker";
import { fundingFor, leadTimeCheck, buildScopingSummary, type ScopingForm as ScopingData } from "../lib/scoping";
import type { EventPlanning } from "../lib/db";

const money = (n: number | null | undefined) =>
  n == null ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

// ── Justification drafting (local; only generated prose in V0) ─────────────────
const JUSTIFICATION_TEMPLATES = [
  (p: EventPlanning, fmt: string, who: string, line: string) =>
    `${p.title} is a ${fmt}${p.location ? ` in ${p.location}` : ""} for ${who}. It advances our ${line} goals by deepening key relationships and reinforcing InstaLILY's presence. The proposed scope and spend are sized to the expected audience and the outcomes we're targeting.`,
  (p: EventPlanning, fmt: string, who: string, line: string) =>
    `We're proposing ${p.title}, a ${fmt} for ${who}. The investment supports ${line}: it creates a high-signal touchpoint with the people who matter most and gives the team a concrete moment to rally around. Costs map directly to the format and headcount below.`,
  (p: EventPlanning, fmt: string, who: string, line: string) =>
    `${p.title} brings ${who} together around a ${fmt}. Strategically it serves ${line} — strengthening pipeline and brand affinity in a setting we control. The requested budget reflects a lean plan scaled to the guest count.`,
];

function draftJustification(plan: EventPlanning, funding: ReturnType<typeof fundingFor>, variant: number): string {
  const fmt = parseFormats(plan.format).join(" / ") || "gathering";
  const who = funding.category === "Internal" ? "our team" : funding.category === "Sponsorship" ? "partners and sponsors" : "clients and community";
  const tmpl = JUSTIFICATION_TEMPLATES[variant % JUSTIFICATION_TEMPLATES.length];
  return tmpl(plan, fmt, who, funding.fundingLine.toLowerCase());
}

/** Compose factual fields + a drafted justification from the event — never a blank record. */
export function composeScoping(base: ScopingData, plan: EventPlanning): ScopingData {
  const funding = fundingFor(plan.tags);
  return {
    ...base,
    type: base.type || parseFormats(plan.format).join(", "),
    audience: base.audience || (funding.category === "Internal" ? "Internal team" : funding.category === "Sponsorship" ? "Partners & sponsors" : "Clients & community"),
    headcount: base.headcount || (plan.headcount != null ? String(plan.headcount) : plan.capacity != null ? String(plan.capacity) : plan.rsvp != null ? String(plan.rsvp) : ""),
    venue: base.venue || (plan.location ?? ""),
    components: base.components.length ? base.components : Array.from(new Set(plan.deliverables.map((d) => d.phase || d.title).filter(Boolean))),
    strategicJustification: base.strategicJustification || draftJustification(plan, funding, 0),
    generated: true,
  };
}

/** Full scoping form — rendered only inside the Budget flow (as a modal). Generates on open,
 *  edits/regenerates the justification, submits for approval, and (admin) assigns the budget. */
export function ScopingForm({ plan, scoping, roughTotal, onChange, onClose }: {
  plan: EventPlanning;
  scoping: ScopingData;
  roughTotal: number;
  onChange: (s: ScopingData) => void;
  onClose: () => void;
}) {
  const [variant, setVariant] = useState(0);
  const [assignInput, setAssignInput] = useState("");
  const [copied, setCopied] = useState(false);

  // Generate on first open — compose facts + draft, don't persist a blank.
  useEffect(() => {
    if (!scoping.generated) onChange(composeScoping(scoping, plan));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const funding = fundingFor(plan.tags);
  const lead = leadTimeCheck(plan.date);
  const headNum = Number(scoping.headcount) || null;
  const perPerson = headNum && roughTotal ? roughTotal / headNum : null;
  const locked = scoping.status === "assigned";
  const submitted = scoping.status !== "draft";

  const set = (f: Partial<ScopingData>) => onChange({ ...scoping, ...f });
  const regenerate = () => { const v = variant + 1; setVariant(v); set({ strategicJustification: draftJustification(plan, funding, v) }); };

  const required = scoping.type.trim() && scoping.audience.trim() && scoping.headcount.trim() && scoping.strategicJustification.trim();

  const submit = () => set({ status: "submitted", submittedSummary: buildScopingSummary({ title: plan.title, date: plan.date, tags: plan.tags, scoping, roughTotal }) });
  const reopen = () => set({ status: "draft" });
  const assign = () => { const n = Number(assignInput); if (!Number.isFinite(n) || assignInput.trim() === "") return; set({ status: "assigned", assignedBudget: n }); };
  const copySummary = () => { if (scoping.submittedSummary) { void navigator.clipboard?.writeText(scoping.submittedSummary); setCopied(true); setTimeout(() => setCopied(false), 1500); } };

  const field = "w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-300";

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl border border-black max-w-2xl w-full max-h-[88vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="p-6 pb-3 shrink-0">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-xl">Scoping form</h2>
            <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-900" aria-label="Close"><X className="w-5 h-5" /></button>
          </div>
          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs ${scoping.status === "assigned" ? "bg-green-100 text-green-700" : scoping.status === "submitted" ? "bg-amber-100 text-amber-700" : "bg-gray-100 text-gray-600"}`}>
              {scoping.status === "assigned" ? <Lock className="w-3.5 h-3.5" /> : null}
              {scoping.status === "draft" ? "Draft" : scoping.status === "submitted" ? "Submitted · awaiting budget" : "Budget assigned"}
            </span>
          </div>
        </div>
        <div className="px-6 py-3 overflow-y-auto flex-1 min-h-0">

        {/* Lead-time check — only flag while still a draft; once submitted it's moot. */}
        {plan.date && lead.ok && (
          <p className="text-sm text-green-700 inline-flex items-center gap-1.5 mb-4"><Check className="w-4 h-4" /> {lead.days} days out — meets the 30-day lead time.</p>
        )}
        {plan.date && !lead.ok && !submitted && (
          <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4 inline-flex items-center gap-2"><AlertCircle className="w-4 h-4 shrink-0" /> {lead.days != null ? `Only ${lead.days} days out` : "No date set"} — under the 30-day lead time. Flag this with approvers.</p>
        )}

        {/* Factual (auto-filled, editable) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2 grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-gray-600 mb-1">Event date</p>
              <p className="text-sm px-3 py-2 bg-gray-50 rounded-lg border border-gray-200">{plan.date ?? "—"}</p>
            </div>
            <div>
              <p className="text-sm text-gray-600 mb-1">Funding line · tier</p>
              <p className="text-sm px-3 py-2 bg-gray-50 rounded-lg border border-gray-200">{funding.fundingLine} · {funding.tier}</p>
            </div>
          </div>
          <label className="block">
            <span className="text-sm text-gray-600 mb-1 block">Type</span>
            <input value={scoping.type} disabled={submitted} onChange={(e) => set({ type: e.target.value })} className={`${field} ${submitted ? "bg-gray-50 text-gray-600" : "border-gray-300"}`} />
          </label>
          <label className="block">
            <span className="text-sm text-gray-600 mb-1 block">Audience</span>
            <input value={scoping.audience} disabled={submitted} onChange={(e) => set({ audience: e.target.value })} className={`${field} ${submitted ? "bg-gray-50 text-gray-600" : "border-gray-300"}`} />
          </label>
          <label className="block">
            <span className="text-sm text-gray-600 mb-1 block">Headcount</span>
            <input type="number" value={scoping.headcount} disabled={submitted} onChange={(e) => set({ headcount: e.target.value })} className={`${field} ${submitted ? "bg-gray-50 text-gray-600" : "border-gray-300"}`} />
          </label>
          <label className="block">
            <span className="text-sm text-gray-600 mb-1 block">Venue</span>
            <input value={scoping.venue} disabled={submitted} onChange={(e) => set({ venue: e.target.value })} className={`${field} ${submitted ? "bg-gray-50 text-gray-600" : "border-gray-300"}`} />
          </label>
          <label className="block sm:col-span-2">
            <span className="text-sm text-gray-600 mb-1 block">Components</span>
            <input value={scoping.components.join(", ")} disabled={submitted} onChange={(e) => set({ components: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} placeholder="Venue, Catering, A/V…" className={`${field} ${submitted ? "bg-gray-50 text-gray-600" : "border-gray-300"}`} />
          </label>
          <label className="block sm:col-span-2">
            <span className="text-sm text-gray-600 mb-1 block">Exec sponsor <span className="text-gray-400">(optional)</span></span>
            <input value={scoping.execSponsor} disabled={submitted} onChange={(e) => set({ execSponsor: e.target.value })} className={`${field} ${submitted ? "bg-gray-50 text-gray-600" : "border-gray-300"}`} />
          </label>
        </div>

        {/* Rough cost (not the assigned budget) */}
        <div className="mt-4 rounded-lg border border-gray-200 p-3 flex items-center justify-between">
          <div>
            <p className="text-sm text-gray-600">Rough cost <span className="text-gray-400">— summed from budget lines, not the assigned budget</span></p>
            <p className="text-lg">{money(roughTotal)} {perPerson != null && <span className="text-sm text-gray-500">· {money(perPerson)}/person</span>}</p>
          </div>
        </div>

        {/* Strategic justification (only AI-drafted prose) */}
        <div className="mt-4">
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm text-gray-600 inline-flex items-center gap-1.5"><Sparkles className="w-3.5 h-3.5 text-gray-400" /> Strategic justification <span className="text-gray-400">(drafted)</span></span>
            {!submitted && <button onClick={regenerate} className="text-xs text-gray-500 hover:text-gray-900 inline-flex items-center gap-1"><RefreshCw className="w-3.5 h-3.5" /> Regenerate</button>}
          </div>
          <textarea rows={4} value={scoping.strategicJustification} disabled={submitted} onChange={(e) => set({ strategicJustification: e.target.value })} className={`${field} resize-none ${submitted ? "bg-gray-50 text-gray-600" : "border-gray-300"}`} />
        </div>

        {/* Submitted summary (manual — Slack send is v1) */}
        {submitted && scoping.submittedSummary && (
          <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-3">
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-sm font-medium">Summary for the budget channel</p>
              <button onClick={copySummary} className="text-xs text-gray-500 hover:text-gray-900 inline-flex items-center gap-1">{copied ? <><Check className="w-3.5 h-3.5" /> Copied</> : <><Copy className="w-3.5 h-3.5" /> Copy</>}</button>
            </div>
            <pre className="text-xs text-gray-700 whitespace-pre-wrap font-sans">{scoping.submittedSummary}</pre>
            <p className="text-[11px] text-gray-400 mt-2">Manual for now — paste into the budget channel. (Auto-send ships in v1.)</p>
          </div>
        )}

        {/* Assigned budget — Karim/admin only; locks once set */}
        {submitted && (
          <div className="mt-4 rounded-lg border border-gray-300 p-3">
            <p className="text-sm font-medium mb-1 inline-flex items-center gap-1.5"><Lock className="w-3.5 h-3.5 text-gray-400" /> Assigned budget <span className="text-gray-400 font-normal">· Karim / admin only</span></p>
            {locked ? (
              <p className="text-lg">{money(scoping.assignedBudget)} <span className="text-xs text-gray-400">— locked target, owner can't edit</span></p>
            ) : (
              <div className="flex items-center gap-2 mt-1">
                <span className="text-gray-400">$</span>
                <input type="number" value={assignInput} onChange={(e) => setAssignInput(e.target.value)} placeholder="Returned total" className="w-40 px-2 py-1 border border-black rounded text-right text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
                <button onClick={assign} disabled={assignInput.trim() === ""} className="px-3 py-1.5 bg-gray-900 text-white rounded-lg text-sm hover:bg-gray-800 disabled:opacity-50">Assign & lock</button>
              </div>
            )}
          </div>
        )}

        </div>{/* end scroll body */}

        {/* Footer actions (fixed; edits autosave, so Save & exit just closes) */}
        <div className="p-6 pt-4 border-t border-gray-100 shrink-0 flex items-center justify-between gap-3">
          <span className="text-xs text-gray-400 min-w-0 truncate">
            {scoping.status === "draft" ? (required ? "Ready to submit." : "Fill type, audience, headcount & justification to submit.")
              : scoping.status === "submitted" ? "Submitted — awaiting budget assignment."
              : "Budget assigned & locked."}
          </span>
          <div className="flex items-center gap-2 shrink-0">
            {scoping.status === "draft" && <button onClick={submit} disabled={!required} className="inline-flex items-center gap-1.5 px-4 py-2 bg-gray-900 text-white rounded-lg text-sm hover:bg-gray-800 disabled:opacity-40">Submit for approval <Send className="w-4 h-4" /></button>}
            {scoping.status === "submitted" && <button onClick={reopen} className="text-sm text-gray-600 hover:text-gray-900">Reopen draft</button>}
            <button onClick={onClose} className="px-4 py-2 bg-gray-200 text-black rounded-lg text-sm hover:bg-gray-300">Save &amp; exit</button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
