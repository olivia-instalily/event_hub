import { useEffect, useState } from "react";
import { Plus, Layers } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@instalily/ui/select";
import { listSeries, createSeries, type SeriesListItem } from "../lib/db";
import type { Drive } from "../lib/campaign";

const DRIVES: Drive[] = ["recruiting", "culture", "client"];
const driveLabel = (d: Drive) => d.charAt(0).toUpperCase() + d.slice(1);

export function SeriesListPage({ onOpen }: { onOpen: (seriesId: string) => void }) {
  const [items, setItems] = useState<SeriesListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [drive, setDrive] = useState<Drive>("recruiting");
  const [error, setError] = useState<string | null>(null);

  const load = () => { setLoading(true); listSeries().then(setItems).catch(() => {}).finally(() => setLoading(false)); };
  useEffect(() => { load(); }, []);

  const create = async () => {
    if (!name.trim()) return;
    setError(null);
    try {
      const id = await createSeries(name, drive);
      setName(""); setCreating(false);
      onOpen(id);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl inline-flex items-center gap-2"><Layers className="w-6 h-6 text-gray-700" /> Series</h1>
        <button onClick={() => setCreating((v) => !v)} className="inline-flex items-center gap-2 px-4 py-2 bg-muted text-foreground rounded-lg hover:brightness-95 hover:shadow-sm transition"><Plus className="w-4 h-4" /> New series</button>
      </div>

      {creating && (
        <div className="mb-6 rounded-xl border border-border p-4 flex flex-wrap items-center gap-2">
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") create(); }} placeholder="Campaign name (e.g. Toronto campus activation)" className="flex-1 min-w-[16rem] px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
          <Select value={drive} onValueChange={(v) => setDrive(v as Drive)} items={DRIVES.map((d) => ({ value: d, label: driveLabel(d) }))}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              {DRIVES.map((d) => <SelectItem key={d} value={d}>{driveLabel(d)}</SelectItem>)}
            </SelectContent>
          </Select>
          <button onClick={create} disabled={!name.trim()} className="px-3 py-2 bg-gray-900 text-white rounded-lg text-sm disabled:opacity-50">Create</button>
          {error && <p className="text-sm text-red-600 mt-2 w-full">{error}</p>}
        </div>
      )}

      {loading ? <p className="text-gray-400 py-12 text-center">Loading…</p>
        : items.length === 0 ? <p className="text-gray-400 py-12 text-center border border-dashed border-gray-300 rounded-2xl">No series yet — create one for a multi-event campaign.</p>
        : (
          <div className="rounded-xl border border-border divide-y divide-gray-100">
            {items.map((s) => (
              <button key={s.id} onClick={() => onOpen(s.id)} className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-gray-50">
                <span className="font-medium">{s.name}</span>
                <span className="text-[13px] text-gray-500">{s.drive} · {s.memberCount} event{s.memberCount === 1 ? "" : "s"}</span>
              </button>
            ))}
          </div>
        )}
    </div>
  );
}
