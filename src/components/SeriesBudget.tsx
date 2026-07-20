import type { TabProps } from "./SeriesDashboard";
import { memberBudgetTotal, travelEstimate } from "../lib/campaign";

const money = (n: number) => "$" + n.toLocaleString();

export function SeriesBudget({ campaign, events, save }: TabProps) {
  const withBudget = events.filter((e) => e.eventBudgetTarget != null);
  const memberTotal = memberBudgetTotal(events);
  const travel = travelEstimate(campaign);

  return (
    <div className="max-w-xl space-y-6">
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-[13px] text-amber-800">
        Estimate only — this never flows into committed spend. Committed budget stays on each event's own budget.
      </div>

      <section className="rounded-xl border border-border divide-y divide-gray-100">
        <div className="px-4 py-2 text-[13px] font-medium text-gray-500">Member event budgets (assigned)</div>
        {events.length === 0 && <div className="px-4 py-3 text-sm text-gray-400">No member events yet.</div>}
        {events.map((e) => (
          <div key={e.id} className="flex items-center justify-between px-4 py-2 text-sm">
            <span className="truncate">{e.name}</span>
            <span className={e.eventBudgetTarget == null ? "text-gray-400" : ""}>{e.eventBudgetTarget == null ? "—" : money(e.eventBudgetTarget)}</span>
          </div>
        ))}
        {withBudget.length > 0 && <div className="flex items-center justify-between px-4 py-2 text-sm font-medium"><span>Subtotal</span><span>{money(memberTotal)}</span></div>}
      </section>

      <section className="rounded-xl border border-border p-4 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm">Per-wave travel rate (per traveler)</span>
          <input type="number" value={campaign.travelRatePerWave ?? ""} onChange={(e) => save({ ...campaign, travelRatePerWave: e.target.value === "" ? null : Number(e.target.value) })} placeholder="—" className="w-28 px-2 py-1 border border-gray-300 rounded text-right text-sm" />
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-500">Travel estimate <span className="text-gray-400">· flyers per wave × rate (locals $0)</span></span>
          <span>{campaign.travelRatePerWave == null ? "—" : money(travel)}</span>
        </div>
      </section>

      <div className="flex items-center justify-between rounded-xl bg-gray-900 text-white px-4 py-3">
        <span className="font-medium">Combined estimate</span>
        <span className="text-lg font-medium">{money(memberTotal + travel)}</span>
      </div>
    </div>
  );
}
