import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X, Check, Send, Lock, Sparkles, RefreshCw, AlertCircle, Copy } from "lucide-react";
import { parseFormats } from "./FormatPicker";
import { fundingFor, leadTimeCheck, buildScopingSummary, type ScopingForm as ScopingData } from "../lib/scoping";
import { buildEventDeepLink } from "../lib/deepLink";
import { postApprovalRequest, submitBudgetApproval, migrateScopingApprovalIfNeeded, getBudgetApproval, assignBudget, reopenBudgetApproval, listSlackChannels, type BudgetApproval, type EventPlanning } from "../lib/db";
import { Button } from "@instalily/ui/button";
import { useProfile, initials, PROFILE_COLORS } from "../lib/profile";

const money = (n: number | null | undefined) =>
  n == null ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

// Who returned the budget (from the Slack approval). The stored value is a Slack username (e.g.
// "olivia"), which we reconcile to the real EventHub profile so the circle shows the profile's
// initials/color and the hover shows the profile's full name. Falls back to the raw Slack name if
// there's no match. Nothing renders until a decision has come back.
function DeciderTag({ who }: { who: string | null }) {
  const { profiles } = useProfile();
  if (!who) return null;
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const w = norm(who);
  // Candidate handles for a profile: full name, email local-part, and each name token.
  const cands = (p: { name: string; email: string | null }) =>
    [p.name, (p.email ?? "").split("@")[0] ?? "", ...p.name.split(/\s+/)].map(norm).filter(Boolean);
  const prof =
    profiles.find((p) => cands(p).includes(w)) ??
    profiles.find((p) => cands(p).some((c) => c.length >= 3 && (c.startsWith(w) || w.startsWith(c))));

  const name = prof?.name ?? who;
  const raw = (prof?.color ?? "").trim();
  const hex = raw.startsWith("#");
  let h = 0; for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  const cls = hex ? "" : (raw || PROFILE_COLORS[Math.abs(h) % PROFILE_COLORS.length]);
  return (
    <span title={`Set by ${name}`} className="font-normal text-gray-400 inline-flex items-center gap-1">· set by
      <span style={hex ? { backgroundColor: raw } : undefined} className={`w-5 h-5 rounded-full text-white text-[11px] font-medium inline-flex items-center justify-center ${cls}`}>{initials(name)}</span>
    </span>
  );
}

// Default Slack budget channel the scoping summary posts to (overridable per-send).
const DEFAULT_SLACK_CHANNEL = "C0ASQSS0CQP";

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
  const [slackChannel, setSlackChannel] = useState(() => { try { return localStorage.getItem("slack_budget_channel") || DEFAULT_SLACK_CHANNEL; } catch { return DEFAULT_SLACK_CHANNEL; } });
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [resubmitConfirm, setResubmitConfirm] = useState(false);
  const [submitBusy, setSubmitBusy] = useState(false);
  const [submitErr, setSubmitErr] = useState<string | null>(null);
  const [approval, setApproval] = useState<BudgetApproval | null>(null);
  // Channels the bot can post to, for the by-name picker (falls back to a text field if none load).
  const [channels, setChannels] = useState<{ id: string; name: string }[]>([]);
  // Keep a local copy of the posted summary so we can display it after submit.
  const [postedSummary, setPostedSummary] = useState<string | null>(null);

  // Generate on first open — compose facts + draft, don't persist a blank.
  useEffect(() => {
    if (!scoping.generated) onChange(composeScoping(scoping, plan));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load approval from the DB (with migrate-on-read for existing localStorage records).
  useEffect(() => { void migrateScopingApprovalIfNeeded(plan.id).then(setApproval); }, [plan.id]);
  // Load the postable Slack channels once, for the by-name picker.
  useEffect(() => { void listSlackChannels().then(setChannels); }, []);

  // Show a Slack channel as a readable #name; fall back to the raw id if it's not in the list.
  const channelLabel = (idOrName: string | null | undefined): string => {
    if (!idOrName) return "Slack";
    const hit = channels.find((c) => c.id === idOrName || c.name === idOrName);
    if (hit) return `#${hit.name}`;
    return idOrName.startsWith("#") ? idOrName : idOrName; // unresolved id/name — show as-is
  };

  const funding = fundingFor(plan.tags);
  const lead = leadTimeCheck(plan.date);
  const headNum = Number(scoping.headcount) || null;
  const perPerson = headNum && roughTotal ? roughTotal / headNum : null;
  const locked = approval?.status === "assigned";
  const submitted = approval != null;

  const set = (f: Partial<ScopingData>) => onChange({ ...scoping, ...f });
  const regenerate = () => { const v = variant + 1; setVariant(v); set({ strategicJustification: draftJustification(plan, funding, v) }); };

  const required = scoping.type.trim() && scoping.audience.trim() && scoping.headcount.trim() && scoping.strategicJustification.trim();

  // Submit = post the summary to Slack for approval; only mark submitted once it actually sends.
  const doSubmit = async () => {
    setSubmitBusy(true); setSubmitErr(null);
    // Deep link back to THIS event's budget form. window.location.origin is the app's real
    // origin — the IAP-fronted host in prod, localhost in dev — so the link is never a dead
    // localhost when it matters. Only the event id travels in the URL (no token); IAP gates it.
    const link = typeof window !== "undefined" ? buildEventDeepLink(window.location.origin, plan.id) : undefined;
    const summary = buildScopingSummary({ title: plan.title, date: plan.date, tags: plan.tags, scoping, roughTotal, link });
    try {
      const { channel, ts } = await postApprovalRequest({ channel: slackChannel.trim(), eventId: plan.id, summary, link: link ?? "", requestedAmount: roughTotal });
      try { localStorage.setItem("slack_budget_channel", slackChannel.trim()); } catch { /* ignore */ }
      await submitBudgetApproval(plan.id, { requestedAmount: roughTotal, slackChannel: channel, slackMessageTs: ts });
      setPostedSummary(summary);
      setApproval(await getBudgetApproval(plan.id));
      setConfirmOpen(false);
    } catch (e: any) { setSubmitErr(e?.message ?? String(e)); }
    finally { setSubmitBusy(false); }
  };
  const reopen = () => { void reopenBudgetApproval(plan.id).then(() => setApproval(null)); };
  const resend = async () => {
    const link = typeof window !== "undefined" ? buildEventDeepLink(window.location.origin, plan.id) : undefined;
    const summary = buildScopingSummary({ title: plan.title, date: plan.date, tags: plan.tags, scoping, roughTotal, link });
    const { channel, ts } = await postApprovalRequest({ channel: (approval?.slackChannel ?? slackChannel).trim(), eventId: plan.id, summary, link: link ?? "", requestedAmount: roughTotal });
    await submitBudgetApproval(plan.id, { requestedAmount: roughTotal, slackChannel: channel, slackMessageTs: ts });
    setApproval(await getBudgetApproval(plan.id));
  };
  // Return the budget → locks as the target via the DB.
  const assign = () => {
    const n = Number(assignInput);
    if (!Number.isFinite(n) || assignInput.trim() === "") return;
    void assignBudget(plan.id, n).then(() => getBudgetApproval(plan.id)).then(setApproval);
  };
  const copySummary = () => { const text = postedSummary; if (text) { void navigator.clipboard?.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); } };

  const field = "w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-300";

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="relative bg-white rounded-2xl border border-border max-w-2xl w-full max-h-[88vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="p-6 pb-3 shrink-0">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-xl">Scoping form</h2>
            <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-900" aria-label="Close"><X className="w-5 h-5" /></button>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[15px] ${(approval?.status ?? "draft") === "assigned" ? "bg-green-100 text-green-700" : (approval?.status ?? "draft") === "submitted" ? "bg-amber-100 text-amber-700" : "bg-gray-100 text-gray-600"}`}>
              {(approval?.status ?? "draft") === "assigned" ? <Lock className="w-3.5 h-3.5" /> : null}
              {(approval?.status ?? "draft") === "draft" ? "Draft" : (approval?.status ?? "draft") === "submitted" ? "Submitted · awaiting budget" : "Budget assigned"}
            </span>
            {/* Resubmit lives at the top (not the crowded footer) — only once a decision came back. */}
            {((approval?.status ?? "draft") === "assigned" || (approval?.status ?? "draft") === "declined") && (
              <Button size="sm" variant="outline" onClick={() => setResubmitConfirm(true)}>Resubmit <Send className="w-4 h-4" /></Button>
            )}
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
            {!submitted && <button onClick={regenerate} className="text-[15px] text-gray-500 hover:text-gray-900 inline-flex items-center gap-1"><RefreshCw className="w-3.5 h-3.5" /> Regenerate</button>}
          </div>
          <textarea rows={4} value={scoping.strategicJustification} disabled={submitted} onChange={(e) => set({ strategicJustification: e.target.value })} className={`${field} resize-none ${submitted ? "bg-gray-50 text-gray-600" : "border-gray-300"}`} />
        </div>

        {/* Posted summary */}
        {submitted && postedSummary && (
          <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-3">
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-sm font-medium inline-flex items-center gap-1.5"><Check className="w-3.5 h-3.5 text-green-600" /> Posted to {channelLabel(approval?.slackChannel)} for approval</p>
              <button onClick={copySummary} className="text-[15px] text-gray-500 hover:text-gray-900 inline-flex items-center gap-1">{copied ? <><Check className="w-3.5 h-3.5" /> Copied</> : <><Copy className="w-3.5 h-3.5" /> Copy</>}</button>
            </div>
            <pre className="text-[15px] text-gray-700 whitespace-pre-wrap font-sans">{postedSummary}</pre>
          </div>
        )}

        {/* Returned budget + comment — locks as the target once set */}
        {submitted && (
          <div id="scoping-budget-return" className="mt-4 rounded-lg border border-gray-300 p-3">
            <p className="text-sm font-medium mb-1 inline-flex items-center gap-1.5"><Lock className="w-3.5 h-3.5 text-gray-400" /> Returned budget <DeciderTag who={approval?.deciderRef ?? null} /></p>
            {locked ? (
              <>
                <p className="text-lg">{money(plan.eventBudgetTarget)} <span className="text-[15px] text-gray-400">— locked target, owner can't edit</span></p>
              </>
            ) : (
              <div className="space-y-2 mt-1">
                <div className="flex items-center gap-2">
                  <span className="text-gray-400">$</span>
                  <input type="number" value={assignInput} onChange={(e) => setAssignInput(e.target.value)} placeholder="Returned total" className="w-40 px-2 py-1 border border-border rounded text-right text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
                  <Button size="sm" onClick={assign} disabled={assignInput.trim() === ""}>Assign &amp; lock</Button>
                </div>
                <p className="text-[15px] text-gray-400">The returned amount becomes the locked budget target.</p>
              </div>
            )}
          </div>
        )}

        </div>{/* end scroll body */}

        {/* Footer actions (fixed; edits autosave, so Save & exit just closes) */}
        <div className="p-6 pt-4 border-t border-gray-100 shrink-0 flex items-center justify-between gap-3">
          <div className="flex flex-col min-w-0">
            {(approval?.status ?? "draft") === "draft" ? (
              <span className="text-[15px] text-gray-400 truncate">{required ? "Ready to submit." : "Fill type, audience, headcount & justification to submit."}</span>
            ) : (
              <>
                <span className="text-sm text-gray-700 truncate">Submitted to <span className="font-medium">{channelLabel(approval?.slackChannel)}</span></span>
                <span className="text-[13px] text-gray-400">
                  {(approval?.status ?? "") === "submitted" ? "Awaiting approval"
                    : (approval?.status ?? "") === "assigned" ? "Budget assigned & locked"
                    : "Declined — resubmit above"}
                </span>
              </>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {(approval?.status ?? "draft") === "draft" && <Button onClick={() => setConfirmOpen(true)} disabled={!required}>Submit for approval <Send className="w-4 h-4" /></Button>}
            {(approval?.status ?? "draft") === "submitted" && <button onClick={reopen} className="text-sm text-gray-600 hover:text-gray-900">Edit</button>}
            {(approval?.status ?? "draft") === "submitted" && <button onClick={() => void resend()} className="text-sm text-gray-600 hover:text-gray-900">Re-send to Slack</button>}
            <Button variant="outline" onClick={onClose}>Save &amp; exit</Button>
          </div>
        </div>

        {/* Submit confirmation — posts to Slack for approval */}
        {confirmOpen && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/30 rounded-2xl p-4" onClick={() => !submitBusy && setConfirmOpen(false)}>
            <div className="bg-white rounded-2xl border border-border max-w-sm w-full p-5" onClick={(e) => e.stopPropagation()}>
              <p className="font-medium mb-1">Submit for approval?</p>
              <p className="text-sm text-gray-600">This posts the scoping summary to <span className="font-medium">{channelLabel(slackChannel)}</span> for approval.</p>
              <label className="block mt-3">
                <span className="text-[15px] text-gray-500 mb-1 block">Channel</span>
                {channels.length > 0 ? (
                  <select value={slackChannel} onChange={(e) => setSlackChannel(e.target.value)} className="w-full px-2 py-1 border border-gray-300 rounded text-sm bg-white focus:outline-none focus:ring-2 focus:ring-gray-300">
                    {/* Keep the current value selectable even if it's not in the fetched list. */}
                    {!channels.some((c) => c.id === slackChannel) && <option value={slackChannel}>{channelLabel(slackChannel)}</option>}
                    {channels.map((c) => <option key={c.id} value={c.id}>#{c.name}</option>)}
                  </select>
                ) : (
                  <input value={slackChannel} onChange={(e) => setSlackChannel(e.target.value)} placeholder="Channel ID or name" className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
                )}
              </label>
              {submitErr && <p className="text-red-600 text-[15px] mt-2">{submitErr}</p>}
              <div className="flex justify-end gap-2 mt-4">
                <button onClick={() => setConfirmOpen(false)} disabled={submitBusy} className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900">Cancel</button>
                <Button size="sm" onClick={doSubmit} disabled={submitBusy || !slackChannel.trim()}>{submitBusy ? "Sending…" : <>Send for approval <Send className="w-4 h-4" /></>}</Button>
              </div>
            </div>
          </div>
        )}
        {/* Resubmit confirmation — only shown once a response has already come back */}
        {resubmitConfirm && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/30 rounded-2xl p-4" onClick={() => setResubmitConfirm(false)}>
            <div className="bg-white rounded-2xl border border-border max-w-sm w-full p-5" onClick={(e) => e.stopPropagation()}>
              <p className="font-medium mb-1">Resubmit for approval?</p>
              <p className="text-sm text-gray-600">This already got a response ({(approval?.status ?? "") === "assigned" ? "budget assigned" : "declined"}). Resubmitting posts a fresh request to <span className="font-medium">{channelLabel(approval?.slackChannel ?? slackChannel)}</span> for a new decision.</p>
              <div className="flex justify-end gap-2 mt-4">
                <button onClick={() => setResubmitConfirm(false)} className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900">Cancel</button>
                <Button size="sm" onClick={() => { setResubmitConfirm(false); void resend(); }}>Resubmit <Send className="w-4 h-4" /></Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
