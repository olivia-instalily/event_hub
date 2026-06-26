import { useEffect, useState, type ReactNode } from "react";
import {
  Calendar, Users, Link2, Check, ChevronDown, AlertCircle,
  DollarSign, ClipboardList, ArrowRight, Plus,
} from "lucide-react";
import {
  setEventDate, setHeadcount, setEventBudgetTarget, setBudgetTarget, saveSetupState,
  setBudgetLineTarget, addBudgetCategoryTarget,
  getBudgetProjections, attachLuma, setDeliverableDueDate, addDeliverable,
  type EventPlanning, type BudgetProjection, type Deliverable,
} from "../lib/db";
import { dueOffsetForTitle } from "../lib/schedule";
import { Button } from "@instalily/ui/button";
import { OwnerPicker } from "./OwnerPicker";
import { GCalSync } from "./GCalSync";
import { DateEdit } from "./DateEdit";
import { BudgetDropZone, BudgetDropArea, BudgetImportModal } from "./BudgetImport";
import { canonicalCategory, categoryKey } from "../lib/budgetCategories";

// Standard deliverables we can guess for any event — surfaced as tentative suggestions in the
// timeline step (each addable via ＋). Titles align with the schedule's workstream offsets.
const TENTATIVE_DELIVERABLES: { title: string; phase: string }[] = [
  { title: "Book venue & confirm space", phase: "Venue" },
  { title: "Launch registration page", phase: "Marketing" },
  { title: "Finalize catering & menu", phase: "Catering" },
  { title: "Confirm speakers & moderators", phase: "Program" },
  { title: "Lock A/V & production", phase: "Production" },
  { title: "Send invites & track RSVPs", phase: "Guests" },
  { title: "Run-of-show & day-of staffing", phase: "Logistics" },
];

const money = (n: number | null | undefined, currency = "USD") =>
  n == null ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(n);
const numOrNull = (s: string) => (s.trim() === "" ? null : Number(s));

type StepKey = "essentials" | "budget" | "timeline";
const STEPS: { key: StepKey; title: string; blurb: string; Icon: typeof Calendar }[] = [
  { key: "essentials", title: "Confirm essentials", blurb: "Date, headcount, owner, Luma", Icon: Calendar },
  { key: "budget", title: "Review budget", blurb: "Projected costs from past events", Icon: DollarSign },
  { key: "timeline", title: "Check timeline", blurb: "Deliverables, now dated", Icon: ClipboardList },
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
          <p className="text-sm text-gray-600 mb-2">{done.size}/{STEPS.length} done</p>
          <button onClick={skip} className="inline-flex items-center gap-1.5 px-4 py-2 bg-gray-200 text-black rounded-lg text-sm hover:bg-gray-300 transition-colors">
            Jump to dashboard <ArrowRight className="w-4 h-4" />
          </button>
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
                  {step.key === "timeline" && (
                    <TimelineStep plan={plan} eventId={eventId} hasDate={!!date} onNeedsDate={() => setOpen("essentials")} onDone={() => completeStep("timeline")} />
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
function StepFooter({ onDone, label = "Confirm & continue", disabled, hint }: { onDone: () => void; label?: string; disabled?: boolean; hint?: ReactNode }) {
  return (
    <div className="flex items-center justify-end gap-3 mt-5 pt-4 border-t border-gray-100">
      {hint && <span className="text-[15px] text-amber-600 mr-auto">{hint}</span>}
      <Button onClick={onDone} disabled={disabled}>
        {label} <Check className="w-4 h-4" />
      </Button>
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
          <span className="text-[15px] text-gray-400 mt-1 block">Sets your deliverables’ due dates.</span>
          {date && (
            <div className="mt-2">
              <GCalSync eventId={eventId} synced={!!plan.gcalEventId} htmlLink={plan.gcalHtmlLink} variant="inline" />
            </div>
          )}
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
      {lumaErr && <p className="text-[15px] text-red-600 mt-1">{lumaErr}</p>}

      <StepFooter onDone={onDone} disabled={!date} hint={!date ? (
        <>Set a date to continue, or <button type="button" onClick={onDone} className="underline decoration-dotted underline-offset-2 hover:text-amber-700">skip for now</button>.</>
      ) : undefined} />
    </div>
  );
}

// ── Step 2: budget review ──────────────────────────────────────────────────
function BudgetStep({ plan, eventId, onDone }: { plan: EventPlanning; eventId: string; onDone: () => void }) {
  const [dropFile, setDropFile] = useState<File | null>(null);
  const [importNote, setImportNote] = useState<string | null>(null);
  const currency = plan.budget?.currency ?? "USD";
  // Categories to project = budget line labels ∪ vendor decision categories.
  const categories = Array.from(new Set([
    ...(plan.budget?.lines ?? []).map((l) => l.label ?? "").filter(Boolean),
    ...plan.engagements.map((e) => e.category ?? "").filter(Boolean),
  ]));

  const [projections, setProjections] = useState<BudgetProjection[] | null>(null);
  // categoryKey → { lineId?, value, label } for the editable per-category amount.
  const [targets, setTargets] = useState<Record<string, { lineId: string | null; value: string; label: string }>>(() => {
    const init: Record<string, { lineId: string | null; value: string; label: string }> = {};
    for (const l of plan.budget?.lines ?? []) {
      if (l.label) init[categoryKey(l.label)] = { lineId: l.id, value: l.target != null ? String(l.target) : (l.confirmedAmount != null ? String(l.confirmedAmount) : ""), label: l.label };
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
    const k = categoryKey(category);
    const cur = targets[k] ?? { lineId: null, value: "", label: category };
    setTargets((t) => ({ ...t, [k]: { ...cur, value: raw, label: cur.label || category } }));
    const val = numOrNull(raw);
    if (!plan.budget) return;
    if (cur.lineId) { await setBudgetLineTarget(cur.lineId, val); }
    else if (val != null) {
      const line = await addBudgetCategoryTarget(plan.budget.id, category, val);
      setTargets((t) => ({ ...t, [k]: { lineId: line.id, value: raw, label: category } }));
    }
  };

  // Drop-import: fuzzy-match each parsed line to an existing category and fill its (editable)
  // field — matching categories drop into their existing field, the rest become new rows.
  const fillFromImport = async (importLines: { label: string; amount: number | null }[]): Promise<string> => {
    let n = 0;
    for (const il of importLines) {
      if (il.amount == null || !il.label.trim()) continue;
      const k = categoryKey(il.label);
      const proj = projections?.find((p) => categoryKey(p.category) === k);
      const label = proj ? proj.category : (targets[k]?.label ?? canonicalCategory(il.label));
      await saveTarget(label, String(il.amount));
      n++;
    }
    return `Filled ${n} categor${n === 1 ? "y" : "ies"} from the breakdown.`;
  };
  const saveOverall = async (raw: string) => {
    setOverall(raw);
    const val = numOrNull(raw);
    await setEventBudgetTarget(eventId, val);
    if (plan.budget) await setBudgetTarget(plan.budget.id, val); // mirror to the Budget tab's target
  };

  // Unified rows: projected categories + any extra categories filled in (e.g. dropped from a
  // breakdown) that aren't among the projections. Both render with the same row markup.
  const projKeys = new Set((projections ?? []).map((p) => categoryKey(p.category)));
  const extraRows = Object.entries(targets)
    .filter(([k, v]) => !projKeys.has(k) && (v.value !== "" || v.lineId))
    .map(([, v]) => v.label);
  const rows: { category: string; proj: BudgetProjection | null }[] = [
    ...(projections ?? []).map((p) => ({ category: p.category, proj: p as BudgetProjection | null })),
    ...extraRows.map((c) => ({ category: c, proj: null as BudgetProjection | null })),
  ];

  return (
    <BudgetDropArea onFile={setDropFile} className="mt-3 rounded-lg">
      <div className="flex items-start justify-between gap-3 mb-3">
        <p className="text-sm text-gray-500">Projected from comparable past events. Drop a breakdown to fill these in — matching categories drop into their field; everything stays editable.</p>
        {plan.budget && <BudgetDropZone label="or drop a breakdown" onFile={setDropFile} className="shrink-0" />}
      </div>
      {importNote && <p className="text-[15px] text-gray-500 mb-3 inline-flex items-center gap-1"><Check className="w-3.5 h-3.5 text-green-600" /> {importNote}</p>}

      {projections === null ? (
        <p className="text-sm text-gray-400">Looking at past events…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-gray-400">No categories yet — drop a breakdown to add some.</p>
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
              {rows.map(({ category, proj }) => {
                const t = targets[categoryKey(category)]?.value ?? "";
                return (
                  <tr key={category} className="border-t border-gray-100">
                    <td className="px-3 py-2">{category}</td>
                    <td className="px-3 py-2 text-right">{proj?.projected != null ? money(proj.projected, currency) : <span className="text-gray-300">—</span>}</td>
                    <td className="px-3 py-2">
                      {!proj || proj.pastEvents === 0 ? (
                        <span className="text-gray-400">—</span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-gray-500">
                          {money(proj.low, currency)}–{money(proj.high, currency)} · {proj.pastEvents} event{proj.pastEvents === 1 ? "" : "s"}
                          {proj.lowConfidence && (
                            <span title="Low confidence — based on one event or less" className="inline-flex items-center gap-0.5 text-amber-600">
                              <AlertCircle className="w-3.5 h-3.5" /> low
                            </span>
                          )}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <input type="number" value={t} onChange={(e) => saveTarget(category, e.target.value)} placeholder="—" className="w-24 px-2 py-1 border border-gray-300 rounded text-right text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
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

      {dropFile && plan.budget && (
        <BudgetImportModal
          budget={plan.budget}
          currency={currency}
          file={dropFile}
          onClose={() => setDropFile(null)}
          onConfirm={fillFromImport}
          onApplied={(note) => { setDropFile(null); setImportNote(note); }}
        />
      )}
    </BudgetDropArea>
  );
}

// ── Step 3: timeline ────────────────────────────────────────────────────────
function TimelineStep({ plan, eventId, hasDate, onNeedsDate, onDone }: { plan: EventPlanning; eventId: string; hasDate: boolean; onNeedsDate: () => void; onDone: () => void }) {
  const [items, setItems] = useState<Deliverable[]>(plan.deliverables);
  const [dues, setDues] = useState<Record<string, string | null>>(
    Object.fromEntries(plan.deliverables.map((d) => [d.id, d.dueDate])),
  );
  const sorted = [...items].sort((a, b) => ((dues[a.id] ?? "9999").localeCompare(dues[b.id] ?? "9999")));
  const setDue = async (id: string, iso: string | null) => {
    setDues((p) => ({ ...p, [id]: iso }));
    await setDeliverableDueDate(id, iso);
  };

  // Guessed due date for a title: event date shifted by the standard offset.
  const guessDue = (title: string): string | null => {
    if (!plan.date) return null;
    const today = new Date().toISOString().slice(0, 10);
    const offset = dueOffsetForTitle(title, plan.date, today);
    const d = new Date(plan.date + "T00:00:00"); d.setDate(d.getDate() + offset);
    return d.toISOString().slice(0, 10);
  };

  // Tentative deliverables not yet added — each addable via ＋, which makes it a real, dated row.
  const present = new Set(items.map((d) => d.title.toLowerCase().trim()));
  const suggestions = TENTATIVE_DELIVERABLES.filter((s) => !present.has(s.title.toLowerCase()));
  const addSuggestion = async (s: { title: string; phase: string }) => {
    const due = guessDue(s.title);
    const d = await addDeliverable(eventId, { title: s.title, phase: s.phase, ownerRole: null, dueDate: due });
    setItems((p) => [...p, d]);
    setDues((p) => ({ ...p, [d.id]: due }));
  };

  return (
    <div className="mt-3">
      {!hasDate && (
        <button onClick={onNeedsDate} className="w-full text-left mb-3 text-sm bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-3 py-2 inline-flex items-center gap-2 hover:bg-amber-100">
          <AlertCircle className="w-4 h-4 shrink-0" /> Set the event date in step 1 to auto-schedule these — or set any date manually below. <span className="underline">Go to essentials</span>
        </button>
      )}

      {sorted.length > 0 && (
        <div className="rounded-lg border border-gray-200 divide-y divide-gray-100">
          {sorted.map((d) => (
            <div key={d.id} className="px-3 py-2 flex items-center justify-between gap-3 text-sm">
              <div className="min-w-0">
                <p className="truncate">{d.title}</p>
                {d.phase && <p className="text-[15px] text-gray-400">{d.phase}</p>}
              </div>
              <DateEdit value={dues[d.id]} onChange={(iso) => setDue(d.id, iso)} placeholder="needs date" />
            </div>
          ))}
        </div>
      )}

      {suggestions.length > 0 && (
        <div className="mt-3">
          <p className="text-[15px] font-medium text-gray-500 mb-1.5">{sorted.length === 0 ? "Suggested deliverables — add the ones you need" : "Add more"}</p>
          <div className="rounded-lg border border-dashed border-gray-200 divide-y divide-gray-100">
            {suggestions.map((s) => (
              <div key={s.title} className="px-3 py-2 flex items-center justify-between gap-3 text-sm">
                <div className="min-w-0">
                  <p className="truncate text-gray-500">{s.title}</p>
                  <p className="text-[15px] text-gray-400">{s.phase}{plan.date ? ` · ~${guessDue(s.title)}` : ""}</p>
                </div>
                <button onClick={() => addSuggestion(s)} className="inline-flex items-center gap-1 px-2 py-1 text-[15px] bg-gray-200 rounded hover:bg-gray-300 shrink-0"><Plus className="w-3.5 h-3.5" /> Add</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {sorted.length === 0 && suggestions.length === 0 && <p className="text-sm text-gray-400">No deliverables.</p>}
      <StepFooter onDone={onDone} label="Looks good" />
    </div>
  );
}

