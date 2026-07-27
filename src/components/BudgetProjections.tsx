import { useEffect, useState } from "react";
import { AlertCircle, Check } from "lucide-react";
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
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getBudgetProjections(eventId, categories).then((p) => { if (!cancelled) setProjections(p); }).catch(() => { if (!cancelled) setProjections([]); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  if (!plan.budget || projections === null) return null;

  // Only draw the area when there are real projections from other events.
  const rows = projections.filter((p) => p.pastEvents > 0 && p.projected != null);
  if (rows.length === 0) return null;

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
      <h3 className="font-semibold text-gray-900 mb-0.5">Budget projections</h3>
      <p className="text-sm text-gray-500 mb-4">Estimated from comparable past events — tweak any figure, then set the total as your budget estimate.</p>

      <div className="rounded-lg border border-gray-200 divide-y divide-gray-100">
        {rows.map((p) => {
          const k = categoryKey(p.category);
          return (
            <div
              key={p.category}
              onClick={() => setHighlight(k)}
              className={`flex items-center gap-3 px-3 py-2 cursor-pointer transition-shadow ${highlight === k ? "ring-2 ring-amber-200 rounded-md" : ""}`}
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-800 truncate">{p.category}</p>
                <p className="text-[13px] text-gray-400 inline-flex items-center gap-1.5">
                  {money(p.low, currency)}–{money(p.high, currency)} · {p.pastEvents} event{p.pastEvents === 1 ? "" : "s"}
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
