import { useEffect, useState } from "react";
import { Check, AlertCircle } from "lucide-react";
import {
  getBudgetProjections, setEventBudgetTarget, setBudgetTarget,
  setBudgetLineTarget, addBudgetCategoryTarget,
  type EventPlanning, type BudgetProjection,
} from "../lib/db";
import { BudgetDropZone, BudgetDropArea, BudgetImportModal } from "./BudgetImport";
import { canonicalCategory, categoryKey } from "../lib/budgetCategories";

const money = (n: number | null | undefined, currency = "USD") =>
  n == null ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(n);
const numOrNull = (s: string) => (s.trim() === "" ? null : Number(s));

export function BudgetProjections({ plan, eventId, onApplied }: { plan: EventPlanning; eventId: string; onApplied: () => void }) {
  if (!plan.budget) return null;

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
    <div className="bg-white rounded-2xl border border-border p-5">
      <h3 className="font-semibold text-gray-900 mb-0.5">Budget projections</h3>
      <p className="text-sm text-gray-500 mb-4">Estimates from comparable past events — set per-category targets or drop a breakdown to fill them in.</p>

      <BudgetDropArea onFile={setDropFile} className="rounded-lg">
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

        {dropFile && plan.budget && (
          <BudgetImportModal
            budget={plan.budget}
            currency={currency}
            file={dropFile}
            onClose={() => setDropFile(null)}
            onConfirm={fillFromImport}
            onApplied={(note) => { setDropFile(null); setImportNote(note); onApplied(); }}
          />
        )}
      </BudgetDropArea>
    </div>
  );
}
