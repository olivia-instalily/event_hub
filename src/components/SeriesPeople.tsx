import { useState } from "react";
import { Plus, X, Plane, MapPin } from "lucide-react";
import type { TabProps } from "./SeriesDashboard";
import { peakHeadcount, travelerLocalCounts, personLabel, type CampaignPerson } from "../lib/campaign";
import { useProfile } from "../lib/profile";

const newPersonId = () => "cp-" + (globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2));

export function SeriesPeople({ campaign, save }: TabProps) {
  const { profiles } = useProfile();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");

  const patchPerson = (id: string, patch: Partial<CampaignPerson>) => save({ ...campaign, people: campaign.people.map((p) => (p.id === id ? { ...p, ...patch } : p)) });
  const removePerson = (id: string) => save({ ...campaign, people: campaign.people.filter((p) => p.id !== id) });
  const toggleWave = (p: CampaignPerson, waveId: string) => patchPerson(p.id, { waveIds: p.waveIds.includes(waveId) ? p.waveIds.filter((w) => w !== waveId) : [...p.waveIds, waveId] });
  const addProfile = (profileId: string) => { const pr = profiles.find((x) => x.id === profileId); if (!pr) return; save({ ...campaign, people: [...campaign.people, { id: newPersonId(), profileId, name: pr.name, email: pr.email ?? undefined, waveIds: [], travel: "flying" }] }); };
  const addFreeText = () => { if (!name.trim()) return; save({ ...campaign, people: [...campaign.people, { id: newPersonId(), name: name.trim(), email: email.trim() || undefined, waveIds: [], travel: "flying" }] }); setName(""); setEmail(""); setAdding(false); };

  const { traveling, local } = travelerLocalCounts(campaign);

  if (campaign.waves.length === 0) return <p className="text-gray-400">Add waves on the Plan tab first, then assign people to them here.</p>;

  return (
    <div className="space-y-5">
      <div className="flex gap-6 text-sm">
        <span><span className="font-medium">{peakHeadcount(campaign)}</span> <span className="text-gray-500">peak headcount</span></span>
        <span className="inline-flex items-center gap-1"><Plane className="w-4 h-4 text-gray-400" /> <span className="font-medium">{traveling}</span> <span className="text-gray-500">traveling</span></span>
        <span className="inline-flex items-center gap-1"><MapPin className="w-4 h-4 text-gray-400" /> <span className="font-medium">{local}</span> <span className="text-gray-500">local</span></span>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="px-3 py-2 text-left font-medium text-gray-600">Person</th>
              {campaign.waves.map((w) => <th key={w.id} className="px-3 py-2 text-center font-medium text-gray-600 whitespace-nowrap">{w.name}</th>)}
              <th className="px-3 py-2 text-center font-medium text-gray-600">Travel</th>
              <th className="px-2 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {campaign.people.length === 0 && <tr><td colSpan={campaign.waves.length + 3} className="px-3 py-6 text-center text-gray-400">Not yet staffed.</td></tr>}
            {campaign.people.map((p) => (
              <tr key={p.id}>
                <td className="px-3 py-2">{personLabel(p)}{p.email && <span className="block text-[12px] text-gray-400">{p.email}</span>}</td>
                {campaign.waves.map((w) => (
                  <td key={w.id} className="px-3 py-2 text-center">
                    <input type="checkbox" checked={p.waveIds.includes(w.id)} onChange={() => toggleWave(p, w.id)} className="rounded border-gray-300" />
                  </td>
                ))}
                <td className="px-3 py-2 text-center">
                  <button onClick={() => patchPerson(p.id, { travel: p.travel === "flying" ? "local" : "flying" })} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px] ${p.travel === "flying" ? "bg-blue-50 text-blue-700" : "bg-gray-100 text-gray-600"}`}>
                    {p.travel === "flying" ? <><Plane className="w-3 h-3" /> Flying</> : <><MapPin className="w-3 h-3" /> Local</>}
                  </button>
                </td>
                <td className="px-2 py-2 text-right"><button onClick={() => removePerson(p.id)} className="text-gray-300 hover:text-red-600"><X className="w-4 h-4" /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {adding ? (
        <div className="flex flex-wrap items-center gap-2">
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" className="px-3 py-2 border border-border rounded-lg text-sm" />
          <input value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addFreeText(); }} placeholder="name@instalily.ai (optional)" className="px-3 py-2 border border-border rounded-lg text-sm" />
          <button onClick={addFreeText} disabled={!name.trim()} className="px-3 py-2 bg-gray-900 text-white rounded-lg text-sm disabled:opacity-50">Add</button>
          <button onClick={() => setAdding(false)} className="text-gray-400 hover:text-gray-700"><X className="w-4 h-4" /></button>
          <span className="text-[13px] text-gray-400">or add a teammate:</span>
          <select defaultValue="" onChange={(e) => { if (e.target.value) { addProfile(e.target.value); } }} className="px-2 py-2 border border-border rounded-lg text-sm bg-white">
            <option value="" disabled>Pick a profile…</option>
            {profiles.map((pr) => <option key={pr.id} value={pr.id}>{pr.name}</option>)}
          </select>
        </div>
      ) : (
        <button onClick={() => setAdding(true)} className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900"><Plus className="w-4 h-4" /> Add person</button>
      )}
    </div>
  );
}
