import { useEffect, useState } from "react";
import { AlertCircle, Check, Sparkles, ChevronDown, ExternalLink } from "lucide-react";
import {
  getBudgetProjections, setEventBudgetTarget, setBudgetTarget,
  type EventPlanning, type BudgetProjection,
} from "../lib/db";
import { categoryKey } from "../lib/budgetCategories";

const money = (n: number | null | undefined, currency = "USD") =>
  n == null ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(n);

/**
 * Projections from comparable past events. Only renders when there's real past-event data to draw
 * from. Each row shows the category, its sources (range + event count), and an editable projected
 * figure; the running total can be set as the event's budget estimate (the overall target).
 */
export function BudgetProjections({ plan, eventId, onApplied }: { plan: EventPlanning; eventId: string; onApplied: () => void }) {
  const currency = plan.budget?.currency ?? "USD";

  // Categories to project = budget line labels ∪ vendor decision categories.
  const categories = Array.from(new Set([
    ...(plan.budget?.lines ?? []).map((l) => l.label ?? "").filter(Boolean),
    ...plan.engagements.map((e) => e.category ?? "").filter(Boolean),
  ]));

  const [projections, setProjections] = useState<BudgetProjection[] | null>(null);
  const [amounts, setAmounts] = useState<Record<string, string>>({}); // categoryKey → edited figure (string)
  const [highlight, setHighlight] = useState<string | null>(null);    // categoryKey of the clicked row
  const [openKey, setOpenKey] = useState<string | null>(null);        // categoryKey whose sources are expanded
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getBudgetProjections(eventId, categories).then((p) => { if (!cancelled) setProjections(p); }).catch(() => { if (!cancelled) setProjections([]); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  if (!plan.budget) return null;
  // Hidden state marker so the "Review budget" flag can tell whether there are comparables to draw
  // from — and fall back to highlighting the target field when there aren't.
  if (projections === null) return <span id="budget-projections-state" data-state="loading" hidden />;

  // Only draw the area when there are real projections from other events.
  const rows = projections.filter((p) => p.pastEvents > 0 && p.projected != null);
  if (rows.length === 0) return <span id="budget-projections-state" data-state="empty" hidden />;

  const valueFor = (p: BudgetProjection) => amounts[categoryKey(p.category)] ?? String(p.projected ?? "");
  const total = rows.reduce((s, p) => s + (Number(valueFor(p)) || 0), 0);

  const setAmount = (category: string, raw: string) => {
    setSaved(false);
    setAmounts((a) => ({ ...a, [categoryKey(category)]: raw }));
  };

  const setAsEstimate = async () => {
    await setEventBudgetTarget(eventId, total);
    if (plan.budget) await setBudgetTarget(plan.budget.id, total); // mirror to the Budget tab's target
    setSaved(true);
    onApplied();
  };

  return (
    <div className="bg-white rounded-2xl border border-border p-5">
      <span id="budget-projections-state" data-state="ready" hidden />
      <h3 className="flex items-center gap-1.5 font-semibold text-gray-900 mb-0.5"><Sparkles className="w-4 h-4 text-yellow-500" /> Budget projections</h3>
      <p className="text-sm text-gray-500 mb-4">Estimated from comparable past events — tweak any figure, then set the total as your budget estimate.</p>

      <div className="rounded-lg border border-gray-200 divide-y divide-gray-100">
        {rows.map((p) => {
          const k = categoryKey(p.category);
          const open = openKey === k;
          return (
            <div key={p.category} className={highlight === k ? "ring-2 ring-amber-200 rounded-md" : ""}>
              <div onClick={() => setHighlight(k)} className="flex items-center gap-3 px-3 py-2 cursor-pointer">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-800 truncate">{p.category}</p>
                  <p className="text-[13px] text-gray-400 inline-flex items-center gap-1.5">
                    {money(p.low, currency)}–{money(p.high, currency)} ·{" "}
                    {p.sources.length > 0 ? (
                      <button
                        onClick={(e) => { e.stopPropagation(); setOpenKey(open ? null : k); }}
                        className="inline-flex items-center gap-0.5 text-gray-500 hover:text-gray-800 decoration-dotted underline"
                        title="Show the events this draws from"
                      >
                        {p.pastEvents} event{p.pastEvents === 1 ? "" : "s"}
                        <ChevronDown className={`w-3 h-3 transition-transform ${open ? "rotate-180" : ""}`} />
                      </button>
                    ) : <>{p.pastEvents} event{p.pastEvents === 1 ? "" : "s"}</>}
                    {p.lowConfidence && (
                      <span title="Low confidence — based on one event or less" className="inline-flex items-center gap-0.5 text-amber-600">
                        <AlertCircle className="w-3.5 h-3.5" /> low
                      </span>
                    )}
                  </p>
                </div>
                <input
                  type="number"
                  value={valueFor(p)}
                  onChange={(e) => setAmount(p.category, e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  className="w-28 px-2 py-1 border border-gray-300 rounded text-right text-sm focus:outline-none focus:ring-2 focus:ring-gray-300"
                />
              </div>
              {open && p.sources.length > 0 && (
                <div className="px-3 pb-2 space-y-0.5">
                  {p.sources.map((s) => (
                    <a
                      key={s.eventId}
                      href={`/?event=${encodeURIComponent(s.eventId)}&view=budget`}
                      className="flex items-center justify-between gap-3 text-[13px] text-gray-600 rounded px-2 py-1 hover:bg-violet-50 hover:text-violet-700"
                      title={`Open ${s.eventName}'s budget`}
                    >
                      <span className="inline-flex items-center gap-1 min-w-0"><ExternalLink className="w-3 h-3 shrink-0" /> <span className="truncate">{s.eventName}</span></span>
                      <span className="text-gray-400 shrink-0">{money(s.amount, currency)}</span>
                    </a>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-between gap-3 mt-4">
        <div className="text-sm">
          <span className="text-gray-500">Total estimate</span>
          <span className="ml-2 font-medium text-gray-900">{money(total, currency)}</span>
        </div>
        <button
          onClick={setAsEstimate}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-900 text-white text-sm hover:bg-black"
        >
          {saved ? <><Check className="w-4 h-4" /> Set as estimate</> : "Set as budget estimate"}
        </button>
      </div>
    </div>
  );
}
