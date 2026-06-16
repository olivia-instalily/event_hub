import { useState } from "react";
import { Plus, Search, Check, Users } from "lucide-react";
import { useProfile, initials } from "../lib/profile";
import { addEventOwner, removeEventOwner } from "../lib/db";

type Owner = { id: string; name: string; color: string | null };

/** Multiple event owners as stacked avatars (icon-only, fan out + name on hover). */
export function OwnerPicker({ eventId, owners, onChange }: {
  eventId: string;
  owners: Owner[];
  onChange: (owners: Owner[]) => void;
}) {
  const { profiles } = useProfile();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const has = (id: string) => owners.some((o) => o.id === id);
  const toggle = async (p: { id: string; name: string; color: string | null }) => {
    if (has(p.id)) { onChange(owners.filter((o) => o.id !== p.id)); await removeEventOwner(eventId, p.id); }
    else { onChange([...owners, { id: p.id, name: p.name, color: p.color }]); await addEventOwner(eventId, p.id); }
  };
  const q = query.trim().toLowerCase();
  const filtered = profiles.filter((p) => !q || p.name.toLowerCase().includes(q) || (p.email ?? "").toLowerCase().includes(q));

  return (
    <div className="owner-stack relative inline-flex items-center gap-1.5">
      <span className="font-medium">Owners:</span>
      {owners.length > 0 ? (
        <span className="group/own inline-flex items-center">
          {owners.map((o, i) => (
            <span key={o.id} className={`inline-flex transition-[margin] duration-200 ${i ? "-ml-2 group-hover/own:ml-0.5" : ""}`}>
              <span title={o.name} className={`w-7 h-7 rounded-full ring-2 ring-white text-white text-[10px] font-medium flex items-center justify-center ${o.color ?? "bg-gray-400"}`}>{initials(o.name)}</span>
            </span>
          ))}
        </span>
      ) : <span className="text-gray-400 text-sm">Unassigned</span>}
      <button onClick={() => setOpen((v) => !v)} className="w-6 h-6 rounded-full border border-dashed border-gray-300 text-gray-400 hover:bg-gray-50 flex items-center justify-center" aria-label="Add owner"><Plus className="w-3.5 h-3.5" /></button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => { setOpen(false); setQuery(""); }} />
          <div className="absolute top-full left-0 z-40 mt-1 w-44 bg-white border border-black rounded-lg shadow-lg overflow-hidden">
            <div className="p-1 border-b border-gray-100 relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search profiles…" className="w-full pl-7 pr-2 py-1 text-sm border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-gray-300" />
            </div>
            <div className="max-h-56 overflow-y-auto p-1">
              {profiles.length === 0 && <p className="px-2 py-2 text-sm text-gray-400 inline-flex items-center gap-1"><Users className="w-4 h-4" /> No profiles — create one in the header.</p>}
              {filtered.map((p) => (
                <button key={p.id} onClick={() => toggle(p)} className="flex items-center gap-2 w-full text-left px-2 py-1 rounded hover:bg-gray-50 text-sm">
                  <span className={`w-5 h-5 rounded-full text-white text-[10px] font-medium flex items-center justify-center ${p.color ?? "bg-gray-400"}`}>{initials(p.name)}</span>
                  <span className="flex-1 truncate">{p.name}</span>
                  {has(p.id) && <Check className="w-4 h-4 text-gray-700" />}
                </button>
              ))}
              {filtered.length === 0 && profiles.length > 0 && <p className="px-2 py-2 text-xs text-gray-400">No match.</p>}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
