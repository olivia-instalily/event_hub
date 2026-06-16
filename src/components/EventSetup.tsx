import { useEffect, useState } from "react";
import {
  Calendar, Users, Link2, Check, ChevronDown, Lightbulb, AlertCircle,
  Mail, DollarSign, ClipboardList, Handshake, ArrowRight,
} from "lucide-react";
import {
  setEventDate, setHeadcount, setEventBudgetTarget, setBudgetTarget, saveSetupState,
  setBudgetLineTarget, addBudgetCategoryTarget, startOutreach, setWatchInbox,
  getBudgetProjections, getCarriedLessons, attachLuma, setDeliverableDueDate,
  type EventPlanning, type BudgetProjection, type CarriedLesson, type EngagementWithCandidates,
} from "../lib/db";
import { OwnerPicker } from "./OwnerPicker";
import { DateEdit } from "./DateEdit";

const money = (n: number | null | undefined, currency = "USD") =>
  n == null ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(n);
const numOrNull = (s: string) => (s.trim() === "" ? null : Number(s));

type StepKey = "essentials" | "budget" | "vendors" | "timeline" | "lessons";
const STEPS: { key: StepKey; title: string; blurb: string; Icon: typeof Calendar }[] = [
  { key: "essentials", title: "Confirm essentials", blurb: "Date, headcount, owner, Luma", Icon: Calendar },
  { key: "budget", title: "Review budget", blurb: "Projected costs from past events", Icon: DollarSign },
  { key: "vendors", title: "Vendor outreach", blurb: "Kick off the categories you need", Icon: Handshake },
  { key: "timeline", title: "Check timeline", blurb: "Deliverables, now dated", Icon: ClipboardList },
  { key: "lessons", title: "Carried lessons", blurb: "What comparable events taught us", Icon: Lightbulb },
];

/** Post-creation guided setup. Grounds the template draft (date/owner/budget/vendors/
 *  timeline), then hands off to the operational dashboard via setup_complete. */
export function EventSetup({ plan, eventId, onApplied }: { plan: EventPlanning; eventId: string; onApplied: () => void }) {
  const [done, setDone] = useState<Set<StepKey>>(new Set(plan.setupProgress as StepKey[]));
  const firstOpen = STEPS.find((s) => !done.has(s.key))?.key ?? null;
  const [open, setOpen] = useState<StepKey | null>(firstOpen);
  const [date, setDate] = useState(plan.date ?? "");

  const allDone = STEPS.every((s) => done.has(s.key));

  const persist = (next: Set<StepKey>, complete: boolean) =>
    void saveSetupState(eventId, [...next], complete);

  const completeStep = (key: StepKey) => {
    const next = new Set(done); next.add(key);
    setDone(next);
    persist(next, false);
    setOpen(STEPS.find((s) => !next.has(s.key))?.key ?? null);
  };

  const skip = async () => { await saveSetupState(eventId, [...done], true); onApplied(); };
  const finish = async () => { await saveSetupState(eventId, STEPS.map((s) => s.key), true); onApplied(); };

  return (
    <div className="space-y-4">
      {/* Intro + progress + skip */}
      <div className="bg-white rounded-2xl border border-gray-200 p-5 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-medium">Let’s set up {plan.title}</h2>
          <p className="text-sm text-gray-500 mt-1">A few quick steps to ground the draft. You can change anything later from the tabs above.</p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-sm text-gray-600">{done.size}/{STEPS.length} done</p>
          <button onClick={skip} className="text-xs text-gray-400 hover:text-gray-700 underline underline-offset-2 mt-1">Skip for now</button>
        </div>
      </div>

      {/* Accordion */}
      <div className="space-y-3">
        {STEPS.map((step, i) => {
          const isDone = done.has(step.key);
          const isOpen = open === step.key;
          return (
            <div key={step.key} className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
              <button
                onClick={() => setOpen(isOpen ? null : step.key)}
                className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-gray-50 transition-colors"
              >
                <span className={`flex items-center justify-center w-7 h-7 rounded-full text-sm shrink-0 ${isDone ? "bg-green-600 text-white" : isOpen ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-500"}`}>
                  {isDone ? <Check className="w-4 h-4" /> : i + 1}
                </span>
                <step.Icon className="w-4 h-4 text-gray-400 shrink-0" />
                <span className="flex-1 min-w-0">
                  <span className="font-medium">{step.title}</span>
                  <span className="text-gray-400 text-sm ml-2">{step.blurb}</span>
                </span>
                <ChevronDown className={`w-5 h-5 text-gray-400 shrink-0 transition-transform ${isOpen ? "rotate-180" : ""}`} />
              </button>
              {isOpen && (
                <div className="px-5 pb-5 pt-1 border-t border-gray-100">
                  {step.key === "essentials" && (
                    <EssentialsStep plan={plan} eventId={eventId} date={date} setDate={setDate} onDone={() => completeStep("essentials")} />
                  )}
                  {step.key === "budget" && (
                    <BudgetStep plan={plan} eventId={eventId} onDone={() => completeStep("budget")} />
                  )}
                  {step.key === "vendors" && (
                    <VendorsStep initial={plan.engagements} onDone={() => completeStep("vendors")} />
                  )}
                  {step.key === "timeline" && (
                    <TimelineStep plan={plan} hasDate={!!date} onNeedsDate={() => setOpen("essentials")} onDone={() => completeStep("timeline")} />
                  )}
                  {step.key === "lessons" && (
                    <LessonsStep eventId={eventId} onDone={() => completeStep("lessons")} />
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Handoff */}
      {allDone && (
        <div className="bg-gray-900 text-white rounded-2xl p-6 flex items-center justify-between gap-4">
          <div>
            <p className="text-lg font-medium">Setup complete</p>
            <p className="text-sm text-gray-300 mt-1">Everything’s grounded. Switch to the live planning dashboard.</p>
          </div>
          <button onClick={finish} className="inline-flex items-center gap-2 px-4 py-2 bg-white text-gray-900 rounded-lg text-sm font-medium hover:bg-gray-100 shrink-0">
            Go to dashboard <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}

// ── Step footer ───────────────────────────────────────────────────────────────
function StepFooter({ onDone, label = "Confirm & continue", disabled, hint }: { onDone: () => void; label?: string; disabled?: boolean; hint?: string }) {
  return (
    <div className="flex items-center justify-end gap-3 mt-5 pt-4 border-t border-gray-100">
      {hint && <span className="text-xs text-amber-600 mr-auto">{hint}</span>}
      <button onClick={onDone} disabled={disabled} className="inline-flex items-center gap-1.5 px-4 py-2 bg-gray-900 text-white rounded-lg text-sm hover:bg-gray-800 disabled:opacity-40">
        {label} <Check className="w-4 h-4" />
      </button>
    </div>
  );
}

// ── Step 1: essentials ──────────────────────────────────────────────────────
function EssentialsStep({ plan, eventId, date, setDate, onDone }: {
  plan: EventPlanning; eventId: string; date: string; setDate: (v: string) => void; onDone: () => void;
}) {
  const [headcount, setHc] = useState(plan.headcount != null ? String(plan.headcount) : "");
  const [owners, setOwners] = useState(plan.owners);
  const [lumaUrl, setLumaUrl] = useState(plan.lumaUrl);
  const [lumaInput, setLumaInput] = useState("");
  const [lumaBusy, setLumaBusy] = useState(false);
  const [lumaErr, setLumaErr] = useState<string | null>(null);

  const saveDate = (v: string) => { setDate(v); void setEventDate(eventId, v || null); };
  const saveHc = (v: string) => { setHc(v); void setHeadcount(eventId, numOrNull(v)); };
  const attach = async () => {
    const u = lumaInput.trim(); if (!u) return;
    setLumaBusy(true); setLumaErr(null);
    try { const r = await attachLuma(eventId, u); setLumaUrl(r.lumaUrl ?? u); setLumaInput(""); }
    catch (e: any) { setLumaErr(e?.message ?? String(e)); }
    finally { setLumaBusy(false); }
  };

  return (
    <div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-3">
        <label className="block">
          <span className="text-sm text-gray-600 flex items-center gap-1.5 mb-1"><Calendar className="w-4 h-4" /> Event date</span>
          <input type="date" value={date} onChange={(e) => saveDate(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
          <span className="text-xs text-gray-400 mt-1 block">Sets your deliverables’ due dates.</span>
        </label>
        <label className="block">
          <span className="text-sm text-gray-600 flex items-center gap-1.5 mb-1"><Users className="w-4 h-4" /> Expected headcount</span>
          <input type="number" value={headcount} onChange={(e) => saveHc(e.target.value)} placeholder="e.g. 120" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
        </label>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-3">
        <OwnerPicker eventId={eventId} owners={owners} onChange={setOwners} />
        <div className="flex items-center gap-2">
          {lumaUrl ? (
            <a href={lumaUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900"><Link2 className="w-4 h-4" /> Luma attached</a>
          ) : (
            <>
              <Link2 className="w-4 h-4 text-gray-400" />
              <input value={lumaInput} onChange={(e) => setLumaInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") attach(); }} placeholder="luma.com/… (optional)" className="px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
              <button onClick={attach} disabled={lumaBusy || !lumaInput.trim()} className="px-2.5 py-1.5 bg-gray-200 rounded text-sm hover:bg-gray-300 disabled:opacity-50">{lumaBusy ? "…" : "Attach"}</button>
            </>
          )}
        </div>
      </div>
      {lumaErr && <p className="text-xs text-red-600 mt-1">{lumaErr}</p>}

      <StepFooter onDone={onDone} disabled={!date} hint={!date ? "Set a date to continue (or Skip for now)." : undefined} />
    </div>
  );
}

// ── Step 2: budget review ──────────────────────────────────────────────────
function BudgetStep({ plan, eventId, onDone }: { plan: EventPlanning; eventId: string; onDone: () => void }) {
  const currency = plan.budget?.currency ?? "USD";
  const norm = (s: string) => s.trim().toLowerCase();
  // Categories to project = budget line labels ∪ vendor decision categories.
  const categories = Array.from(new Set([
    ...(plan.budget?.lines ?? []).map((l) => l.label ?? "").filter(Boolean),
    ...plan.engagements.map((e) => e.category ?? "").filter(Boolean),
  ]));

  const [projections, setProjections] = useState<BudgetProjection[] | null>(null);
  // category(norm) → { lineId?, value } for the optional target.
  const [targets, setTargets] = useState<Record<string, { lineId: string | null; value: string }>>(() => {
    const init: Record<string, { lineId: string | null; value: string }> = {};
    for (const l of plan.budget?.lines ?? []) {
      if (l.label) init[norm(l.label)] = { lineId: l.id, value: l.target != null ? String(l.target) : "" };
    }
    return init;
  });
  const [overall, setOverall] = useState(plan.eventBudgetTarget != null ? String(plan.eventBudgetTarget) : "");

  useEffect(() => {
    let cancelled = false;
    getBudgetProjections(eventId, categories).then((p) => { if (!cancelled) setProjections(p); }).catch(() => { if (!cancelled) setProjections([]); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  const saveTarget = async (category: string, raw: string) => {
    const k = norm(category);
    const cur = targets[k] ?? { lineId: null, value: "" };
    setTargets((t) => ({ ...t, [k]: { ...cur, value: raw } }));
    const val = numOrNull(raw);
    if (!plan.budget) return;
    if (cur.lineId) { await setBudgetLineTarget(cur.lineId, val); }
    else if (val != null) {
      const line = await addBudgetCategoryTarget(plan.budget.id, category, val);
      setTargets((t) => ({ ...t, [k]: { lineId: line.id, value: raw } }));
    }
  };
  const saveOverall = async (raw: string) => {
    setOverall(raw);
    const val = numOrNull(raw);
    await setEventBudgetTarget(eventId, val);
    if (plan.budget) await setBudgetTarget(plan.budget.id, val); // mirror to the Budget tab's target
  };

  return (
    <div className="mt-3">
      <p className="text-sm text-gray-500 mb-3">Projected from comparable past events. Targets are optional — the projection stands if you leave them blank.</p>

      {projections === null ? (
        <p className="text-sm text-gray-400">Looking at past events…</p>
      ) : projections.length === 0 ? (
        <p className="text-sm text-gray-400">No categories to project yet.</p>
      ) : (
        <div className="rounded-lg border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500">
              <tr>
                <th className="text-left px-3 py-2 font-normal">Category</th>
                <th className="text-right px-3 py-2 font-normal">Projected</th>
                <th className="text-left px-3 py-2 font-normal">Based on</th>
                <th className="text-right px-3 py-2 font-normal">Your target</th>
              </tr>
            </thead>
            <tbody>
              {projections.map((p) => {
                const t = targets[norm(p.category)]?.value ?? "";
                return (
                  <tr key={p.category} className="border-t border-gray-100">
                    <td className="px-3 py-2">{p.category}</td>
                    <td className="px-3 py-2 text-right">{p.projected != null ? money(p.projected, currency) : <span className="text-gray-300">no history</span>}</td>
                    <td className="px-3 py-2">
                      {p.pastEvents === 0 ? (
                        <span className="text-gray-400">no comparable events</span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-gray-500">
                          {money(p.low, currency)}–{money(p.high, currency)} · {p.pastEvents} event{p.pastEvents === 1 ? "" : "s"}
                          {p.lowConfidence && (
                            <span title="Low confidence — based on one event or less" className="inline-flex items-center gap-0.5 text-amber-600">
                              <AlertCircle className="w-3.5 h-3.5" /> low
                            </span>
                          )}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <input type="number" value={t} onChange={(e) => saveTarget(p.category, e.target.value)} placeholder="—" className="w-24 px-2 py-1 border border-gray-300 rounded text-right text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex items-center gap-2 mt-4 text-sm">
        <span className="text-gray-600">Overarching event budget</span>
        <span className="text-gray-400">(optional)</span>
        <input type="number" value={overall} onChange={(e) => saveOverall(e.target.value)} placeholder="—" className="w-32 px-2 py-1 border border-gray-300 rounded text-right text-sm focus:outline-none focus:ring-2 focus:ring-gray-300 ml-auto" />
      </div>

      <StepFooter onDone={onDone} />
    </div>
  );
}

// ── Step 3: vendor outreach ─────────────────────────────────────────────────
function VendorsStep({ initial, onDone }: { initial: EngagementWithCandidates[]; onDone: () => void }) {
  const [engs, setEngs] = useState(initial);
  const patch = (id: string, f: Partial<EngagementWithCandidates>) => setEngs((p) => p.map((e) => (e.id === id ? { ...e, ...f } : e)));

  const begin = async (id: string) => { patch(id, { outreachStarted: true }); await startOutreach(id, false); };
  const toggleWatch = async (id: string, v: boolean) => { patch(id, { watchInbox: v }); await setWatchInbox(id, v); };

  return (
    <div className="mt-3">
      {engs.length === 0 ? (
        <p className="text-sm text-gray-400">No vendor categories scaffolded. Add them on the Vendor decisions tab.</p>
      ) : (
        <div className="space-y-2">
          {engs.map((e) => (
            <div key={e.id} className="rounded-lg border border-gray-200 p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{e.category ?? "Uncategorized"}</span>
                  {e.outreachStarted && <span className="px-2 py-0.5 rounded-full text-xs bg-orange-100 text-orange-700">Sourcing</span>}
                </div>
                {e.outreachStarted ? (
                  <span className="text-xs text-green-700 inline-flex items-center gap-1"><Check className="w-3.5 h-3.5" /> Outreach started</span>
                ) : (
                  <button onClick={() => begin(e.id)} className="px-3 py-1 bg-gray-900 text-white rounded-lg text-xs hover:bg-gray-800">Start outreach</button>
                )}
              </div>
              {e.outreachStarted && (
                <label className="mt-3 flex items-start gap-2 text-sm text-gray-600 cursor-pointer">
                  <input type="checkbox" checked={e.watchInbox} onChange={(ev) => toggleWatch(e.id, ev.target.checked)} className="mt-0.5" />
                  <span className="inline-flex items-center gap-1.5">
                    <Mail className="w-4 h-4 text-gray-400" />
                    Watch my inbox for replies from this vendor — auto-log + flag quotes/updates.
                    <span className="text-gray-400">(turns on once email sync ships)</span>
                  </span>
                </label>
              )}
            </div>
          ))}
        </div>
      )}
      <StepFooter onDone={onDone} />
    </div>
  );
}

// ── Step 4: timeline ────────────────────────────────────────────────────────
function TimelineStep({ plan, hasDate, onNeedsDate, onDone }: { plan: EventPlanning; hasDate: boolean; onNeedsDate: () => void; onDone: () => void }) {
  const [dues, setDues] = useState<Record<string, string | null>>(
    Object.fromEntries(plan.deliverables.map((d) => [d.id, d.dueDate])),
  );
  const items = [...plan.deliverables].sort((a, b) => ((dues[a.id] ?? "9999").localeCompare(dues[b.id] ?? "9999")));
  const setDue = async (id: string, iso: string | null) => {
    setDues((p) => ({ ...p, [id]: iso }));
    await setDeliverableDueDate(id, iso);
  };
  return (
    <div className="mt-3">
      {!hasDate && (
        <button onClick={onNeedsDate} className="w-full text-left mb-3 text-sm bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-3 py-2 inline-flex items-center gap-2 hover:bg-amber-100">
          <AlertCircle className="w-4 h-4 shrink-0" /> Set the event date in step 1 to auto-schedule these — or set any date manually below. <span className="underline">Go to essentials</span>
        </button>
      )}
      {items.length === 0 ? (
        <p className="text-sm text-gray-400">No deliverables scaffolded.</p>
      ) : (
        <div className="rounded-lg border border-gray-200 divide-y divide-gray-100">
          {items.map((d) => (
            <div key={d.id} className="px-3 py-2 flex items-center justify-between gap-3 text-sm">
              <div className="min-w-0">
                <p className="truncate">{d.title}</p>
                {d.phase && <p className="text-xs text-gray-400">{d.phase}</p>}
              </div>
              <DateEdit value={dues[d.id]} onChange={(iso) => setDue(d.id, iso)} placeholder="needs date" />
            </div>
          ))}
        </div>
      )}
      <StepFooter onDone={onDone} label="Looks good" />
    </div>
  );
}

// ── Step 5: carried lessons ─────────────────────────────────────────────────
function LessonsStep({ eventId, onDone }: { eventId: string; onDone: () => void }) {
  const [lessons, setLessons] = useState<CarriedLesson[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    getCarriedLessons(eventId).then((l) => { if (!cancelled) setLessons(l); }).catch(() => { if (!cancelled) setLessons([]); });
    return () => { cancelled = true; };
  }, [eventId]);

  return (
    <div className="mt-3">
      {lessons === null ? (
        <p className="text-sm text-gray-400">Finding comparable past events…</p>
      ) : lessons.length === 0 ? (
        <p className="text-sm text-gray-400">No comparable past events with lessons yet.</p>
      ) : (
        <div className="rounded-lg border border-gray-200 divide-y divide-gray-100">
          {lessons.map((l, i) => (
            <div key={i} className="px-4 py-3 flex gap-3">
              <Lightbulb className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm text-gray-700">{l.body}</p>
                <p className="text-xs text-gray-400 mt-1">from {l.sourceEventName}{l.why ? ` · ${l.why}` : ""}</p>
              </div>
            </div>
          ))}
        </div>
      )}
      <StepFooter onDone={onDone} label="Got it" />
    </div>
  );
}
