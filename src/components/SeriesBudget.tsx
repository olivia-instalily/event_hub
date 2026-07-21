import { useEffect, useState } from "react";
import { Plus, X, AlertTriangle } from "lucide-react";
import type { TabProps } from "./SeriesDashboard";
import { formatMoney, autoEstimateLines, estimatedSubtotal, type EstimatedLine } from "../lib/campaign";
import { getSeriesCommittedTotals, type SeriesCommitted } from "../lib/db";

const newLineId = () => "el-" + (globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2));

export function SeriesBudget({ seriesId, campaign, events, save }: TabProps) {
  const cur = campaign.currency || "CAD";
  const [paid, setPaid] = useState<SeriesCommitted[] | null>(null);
  const [addingLine, setAddingLine] = useState(false);
  const [lineItem, setLineItem] = useState("");
  const [lineDetail, setLineDetail] = useState("");
  const [lineAmount, setLineAmount] = useState("");
  const [pendingText, setPendingText] = useState("");

  useEffect(() => { setPaid(null); getSeriesCommittedTotals(seriesId).then(setPaid).catch(() => setPaid([])); }, [seriesId]);

  const eventDates: Record<string, string | null> = {};
  for (const e of events) eventDates[e.id] = e.date;

  // Paid: only rows with committed spend; mismatched-currency rows flagged (not summed).
  const paidRows = (paid ?? []).filter((r) => r.committed > 0);
  const paidSameCur = paidRows.filter((r) => r.currency === cur);
  const paidMismatch = paidRows.filter((r) => r.currency !== cur);
  const paidSubtotal = paidSameCur.reduce((s, r) => s + r.committed, 0);

  const autos = autoEstimateLines(campaign, eventDates);
  const estTotal = estimatedSubtotal(campaign, eventDates);
  const combined = paidSubtotal + estTotal;
  const isEmpty = paidRows.length === 0 && campaign.estimatedLines.length === 0 && autos.length === 0;

  const setRate = (field: "travelRatePerWave" | "accommodationRatePerNight", v: string) =>
    save({ ...campaign, [field]: v === "" ? null : Number(v) });
  const patchLine = (id: string, patch: Partial<EstimatedLine>) =>
    save({ ...campaign, estimatedLines: campaign.estimatedLines.map((l) => (l.id === id ? { ...l, ...patch } : l)) });
  const removeLine = (id: string) => save({ ...campaign, estimatedLines: campaign.estimatedLines.filter((l) => l.id !== id) });
  const addLine = () => {
    if (!lineItem.trim()) return;
    save({ ...campaign, estimatedLines: [...campaign.estimatedLines, { id: newLineId(), item: lineItem.trim(), detail: lineDetail.trim(), amount: Number(lineAmount) || 0 }] });
    setLineItem(""); setLineDetail(""); setLineAmount(""); setAddingLine(false);
  };
  const addPending = () => { const t = pendingText.trim(); if (!t) return; save({ ...campaign, pendingItems: [...campaign.pendingItems, t] }); setPendingText(""); };
  const removePending = (i: number) => save({ ...campaign, pendingItems: campaign.pendingItems.filter((_, j) => j !== i) });

  return (
    <div className="max-w-2xl space-y-6">
      {/* Total estimate — top-right corner, to the right of everything else. */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-[13px] text-amber-800">
          Estimate only — this never flows into committed spend. Paid is read from each event's own budget; nothing here changes it. Currency: {cur}.
        </div>
        <div className="shrink-0 text-right rounded-xl border border-border bg-muted px-4 py-2">
          <span className="block text-[11px] font-medium uppercase tracking-wide text-gray-500">Total estimate</span>
          <span className="block text-xl font-semibold">{isEmpty ? "—" : formatMoney(combined, cur)}</span>
          {!isEmpty && <span className="block text-[11px] text-gray-500">{formatMoney(paidSubtotal, cur)} committed · {formatMoney(estTotal, cur)} estimated</span>}
        </div>
      </div>

      {/* 1. Paid / committed (read) */}
      <section className="rounded-xl border border-border divide-y divide-gray-100">
        <div className="px-4 py-2 text-[13px] font-medium text-gray-500">Paid / committed <span className="font-normal text-gray-400">· read from member events</span></div>
        {paid === null && <div className="px-4 py-3 text-sm text-gray-400">Loading…</div>}
        {paid !== null && paidRows.length === 0 && <div className="px-4 py-3 text-sm text-gray-400">No committed spend on member events yet.</div>}
        {paidSameCur.map((r) => (
          <div key={r.eventId} className="flex items-center justify-between px-4 py-2 text-sm">
            <span className="truncate">{r.name}</span>
            <span>{formatMoney(r.committed, cur)}</span>
          </div>
        ))}
        {paidMismatch.map((r) => (
          <div key={r.eventId} className="flex items-center justify-between px-4 py-2 text-sm text-amber-700">
            <span className="truncate inline-flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5 shrink-0" />{r.name}</span>
            <span title="Different currency — not added to the series total">{formatMoney(r.committed, r.currency)} <span className="text-[12px]">({r.currency})</span></span>
          </div>
        ))}
        {paidSameCur.length > 0 && <div className="flex items-center justify-between px-4 py-2 text-sm font-medium"><span>Subtotal</span><span>{formatMoney(paidSubtotal, cur)}</span></div>}
      </section>

      {/* 2. Estimated (blue): manual lines + derived auto lines */}
      <section className="rounded-xl border border-border divide-y divide-gray-100">
        <div className="px-4 py-2 text-[13px] font-medium text-gray-500">Estimated <span className="font-normal text-gray-400">· to refine</span></div>
        {campaign.estimatedLines.map((l) => (
          <div key={l.id} className="flex items-center gap-2 px-4 py-2 text-sm">
            <div className="flex-1 min-w-0">
              <input value={l.item} onChange={(e) => patchLine(l.id, { item: e.target.value })} placeholder="Item" className="block w-full font-medium text-blue-700 bg-transparent focus:outline-none" />
              <input value={l.detail} onChange={(e) => patchLine(l.id, { detail: e.target.value })} placeholder="detail (the reasoning)" className="block w-full text-[12px] text-gray-400 bg-transparent focus:outline-none" />
            </div>
            <input type="number" value={l.amount || ""} onChange={(e) => patchLine(l.id, { amount: Number(e.target.value) || 0 })} className="w-24 px-2 py-1 border border-gray-200 rounded text-right text-blue-700" />
            <button onClick={() => removeLine(l.id)} className="text-gray-300 hover:text-red-600 shrink-0"><X className="w-4 h-4" /></button>
          </div>
        ))}
        {autos.map((a) => (
          <div key={a.key} className="flex items-center justify-between px-4 py-2 text-sm">
            <div className="min-w-0">
              <span className="font-medium text-blue-700">{a.item} <span className="text-[11px] font-normal text-blue-400 border border-blue-200 rounded px-1">auto</span></span>
              <span className="block text-[12px] text-gray-400">{a.detail}</span>
            </div>
            <span className="text-blue-700">{formatMoney(a.amount, cur)}</span>
          </div>
        ))}
        {addingLine ? (
          <div className="flex items-center gap-2 px-4 py-2">
            <input autoFocus value={lineItem} onChange={(e) => setLineItem(e.target.value)} placeholder="Item" className="flex-1 min-w-0 px-2 py-1 border border-border rounded text-sm" />
            <input value={lineDetail} onChange={(e) => setLineDetail(e.target.value)} placeholder="detail" className="flex-1 min-w-0 px-2 py-1 border border-border rounded text-sm" />
            <input type="number" value={lineAmount} onChange={(e) => setLineAmount(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addLine(); }} placeholder="0" className="w-24 px-2 py-1 border border-border rounded text-right text-sm" />
            <button onClick={addLine} disabled={!lineItem.trim()} className="px-2 py-1 bg-gray-900 text-white rounded text-sm disabled:opacity-50">Add</button>
            <button onClick={() => setAddingLine(false)} className="text-gray-400 hover:text-gray-700"><X className="w-4 h-4" /></button>
          </div>
        ) : (
          <button onClick={() => setAddingLine(true)} className="flex items-center gap-1 px-4 py-2 text-[13px] text-gray-500 hover:text-gray-900"><Plus className="w-3.5 h-3.5" /> add estimated line</button>
        )}
        {(campaign.estimatedLines.length > 0 || autos.length > 0) && <div className="flex items-center justify-between px-4 py-2 text-sm font-medium"><span>Subtotal</span><span>{formatMoney(estTotal, cur)}</span></div>}
      </section>

      {/* 3. Rate helpers */}
      <section className="rounded-xl border border-border p-4 space-y-2">
        <div className="text-[13px] font-medium text-gray-500 mb-1">Rate helpers <span className="font-normal text-gray-400">· generate the auto lines above from the People tab</span></div>
        <div className="flex items-center justify-between text-sm">
          <span>Travel rate / traveler (per wave)</span>
          <input type="number" value={campaign.travelRatePerWave ?? ""} onChange={(e) => setRate("travelRatePerWave", e.target.value)} placeholder="—" className="w-28 px-2 py-1 border border-gray-300 rounded text-right" />
        </div>
        <div className="flex items-center justify-between text-sm">
          <span>Accommodation rate / night (per person)</span>
          <input type="number" value={campaign.accommodationRatePerNight ?? ""} onChange={(e) => setRate("accommodationRatePerNight", e.target.value)} placeholder="—" className="w-28 px-2 py-1 border border-gray-300 rounded text-right" />
        </div>
      </section>

      {/* 4. Not yet included (pending) */}
      <section className="rounded-xl border border-border p-4">
        <div className="text-[13px] font-medium text-gray-500 mb-2">Not yet included <span className="font-normal text-gray-400">· known but unsized — excluded from the total</span></div>
        <ul className="space-y-1 mb-2">
          {campaign.pendingItems.map((p, i) => (
            <li key={i} className="flex items-center justify-between gap-2 text-sm text-gray-700">
              <span className="truncate">• {p}</span>
              <button onClick={() => removePending(i)} className="text-gray-300 hover:text-red-600 shrink-0"><X className="w-4 h-4" /></button>
            </li>
          ))}
          {campaign.pendingItems.length === 0 && <li className="text-[13px] text-gray-400">Nothing pending.</li>}
        </ul>
        <div className="flex items-center gap-2">
          <input value={pendingText} onChange={(e) => setPendingText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addPending(); }} placeholder="e.g. videographer TBD" className="flex-1 min-w-0 px-2 py-1 border border-border rounded text-sm" />
          <button onClick={addPending} disabled={!pendingText.trim()} className="inline-flex items-center gap-1 px-2 py-1 text-[13px] text-gray-500 hover:text-gray-900 disabled:opacity-50"><Plus className="w-3.5 h-3.5" /> add pending item</button>
        </div>
      </section>

    </div>
  );
}
