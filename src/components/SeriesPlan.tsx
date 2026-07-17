import { useState } from "react";
import { Plus, X, Star, ExternalLink } from "lucide-react";
import type { TabProps } from "./SeriesDashboard";
import { type Wave } from "../lib/campaign";

const newWaveId = () => "w-" + (globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2));

export function SeriesPlan({ campaign, events, save, onOpenEvent }: TabProps) {
  const [adding, setAdding] = useState(false);
  const [wName, setWName] = useState("");

  const eventsById = Object.fromEntries(events.map((e) => [e.id, e]));
  const assignedIds = new Set(campaign.waves.flatMap((w) => w.eventIds));
  const pending = events.filter((e) => !assignedIds.has(e.id));

  const addWave = () => { if (!wName.trim()) return; save({ ...campaign, waves: [...campaign.waves, { id: newWaveId(), name: wName.trim(), start: null, end: null, eventIds: [] }] }); setWName(""); setAdding(false); };
  const patchWave = (id: string, patch: Partial<Wave>) => save({ ...campaign, waves: campaign.waves.map((w) => (w.id === id ? { ...w, ...patch } : w)) });
  const removeWave = (id: string) => save({ ...campaign, waves: campaign.waves.filter((w) => w.id !== id) });
  const assignEvent = (eventId: string, waveId: string) => save({ ...campaign, waves: campaign.waves.map((w) => ({ ...w, eventIds: w.id === waveId ? [...new Set([...w.eventIds, eventId])] : w.eventIds.filter((id) => id !== eventId) })) });
  const unassign = (eventId: string) => save({ ...campaign, waves: campaign.waves.map((w) => ({ ...w, eventIds: w.eventIds.filter((id) => id !== eventId) })) });
  const toggleAnchor = (eventId: string) => save({ ...campaign, anchorEventIds: campaign.anchorEventIds.includes(eventId) ? campaign.anchorEventIds.filter((id) => id !== eventId) : [...campaign.anchorEventIds, eventId] });

  const EventRow = ({ id, waveId }: { id: string; waveId?: string }) => {
    const e = eventsById[id]; if (!e) return null;
    const anchor = campaign.anchorEventIds.includes(id);
    return (
      <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${anchor ? "border-amber-300 bg-amber-50" : "border-gray-200"}`}>
        {anchor && <Star className="w-3.5 h-3.5 text-amber-500 shrink-0" />}
        <button onClick={() => onOpenEvent?.(id)} className="flex-1 min-w-0 text-left text-sm hover:underline inline-flex items-center gap-1"><span className="truncate">{e.name}</span><ExternalLink className="w-3 h-3 text-gray-400 shrink-0" /></button>
        <span className="text-[12px] text-gray-400 shrink-0">{e.date ?? "—"}</span>
        <button onClick={() => toggleAnchor(id)} title={anchor ? "Unmark anchor" : "Mark as anchor"} className={`shrink-0 ${anchor ? "text-amber-500" : "text-gray-300 hover:text-amber-500"}`}><Star className="w-4 h-4" /></button>
        {waveId && <button onClick={() => unassign(id)} title="Remove from wave" className="shrink-0 text-gray-300 hover:text-red-600"><X className="w-4 h-4" /></button>}
        {!waveId && campaign.waves.length > 0 && (
          <select onChange={(e2) => e2.target.value && assignEvent(id, e2.target.value)} defaultValue="" className="shrink-0 text-[12px] border border-gray-200 rounded px-1 py-0.5 bg-white">
            <option value="" disabled>Add to wave…</option>
            {campaign.waves.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {campaign.waves.map((w) => (
        <section key={w.id} className="rounded-xl border border-border p-4">
          <div className="flex items-center gap-2 mb-3">
            <input value={w.name} onChange={(e) => patchWave(w.id, { name: e.target.value })} className="font-medium border-b border-transparent hover:border-gray-200 focus:border-gray-400 focus:outline-none" />
            <input type="date" value={w.start ?? ""} onChange={(e) => patchWave(w.id, { start: e.target.value || null })} className="text-[13px] border border-gray-200 rounded px-1.5 py-0.5" />
            <span className="text-gray-400">–</span>
            <input type="date" value={w.end ?? ""} onChange={(e) => patchWave(w.id, { end: e.target.value || null })} className="text-[13px] border border-gray-200 rounded px-1.5 py-0.5" />
            <button onClick={() => removeWave(w.id)} className="ml-auto text-gray-300 hover:text-red-600" aria-label="Remove wave"><X className="w-4 h-4" /></button>
          </div>
          <div className="space-y-1.5">
            {w.eventIds.length === 0 ? <p className="text-[13px] text-gray-400">No events in this wave yet.</p> : w.eventIds.map((id) => <EventRow key={id} id={id} waveId={w.id} />)}
          </div>
        </section>
      ))}

      {adding ? (
        <div className="flex items-center gap-2">
          <input autoFocus value={wName} onChange={(e) => setWName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addWave(); }} placeholder="Wave name (e.g. Wave 1)" className="px-3 py-2 border border-border rounded-lg text-sm" />
          <button onClick={addWave} disabled={!wName.trim()} className="px-3 py-2 bg-gray-900 text-white rounded-lg text-sm disabled:opacity-50">Add</button>
          <button onClick={() => setAdding(false)} className="text-gray-400 hover:text-gray-700"><X className="w-4 h-4" /></button>
        </div>
      ) : (
        <button onClick={() => setAdding(true)} className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900"><Plus className="w-4 h-4" /> Add wave</button>
      )}

      <section>
        <h3 className="text-[15px] font-medium text-gray-700 mb-2">Pending events <span className="text-gray-400 font-normal">· not yet in a wave</span></h3>
        {pending.length === 0 ? <p className="text-[13px] text-gray-400">All member events are assigned.{events.length === 0 ? " Add events to this series from an event's page (set its series)." : ""}</p> : (
          <div className="space-y-1.5">{pending.map((e) => <EventRow key={e.id} id={e.id} />)}</div>
        )}
      </section>
    </div>
  );
}
