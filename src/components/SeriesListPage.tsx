import { useEffect, useState } from "react";
import { Plus, Layers, Calendar } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@instalily/ui/select";
import { listSeries, createSeries, type SeriesListItem, type SeriesCardEvent } from "../lib/db";
import type { Drive } from "../lib/campaign";

const DRIVES: Drive[] = ["recruiting", "culture", "client"];
const driveLabel = (d: Drive) => d.charAt(0).toUpperCase() + d.slice(1);
const fmtDay = (d: string) => new Date(d + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" });

const CARD_W = 176; // w-44
const MAX_FAN = 7;  // cards shown before "+N"

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
    try { const id = await createSeries(name, drive); setName(""); setCreating(false); onOpen(id); }
    catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
  };

  const withEvents = items.filter((s) => s.events.length > 0);
  const empty = items.filter((s) => s.events.length === 0);

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl inline-flex items-center gap-2"><Layers className="w-6 h-6 text-gray-700" /> Series</h1>
        <button onClick={() => setCreating((v) => !v)} className="inline-flex items-center gap-2 px-4 py-2 bg-muted text-foreground rounded-lg hover:brightness-95 hover:shadow-sm transition"><Plus className="w-4 h-4" /> New series</button>
      </div>

      {creating && (
        <div className="mb-6 rounded-xl border border-border p-4 flex flex-wrap items-center gap-2">
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") create(); }} placeholder="Campaign name (e.g. Toronto campus activation)" className="flex-1 min-w-[16rem] px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
          <Select value={drive} onValueChange={(v) => setDrive(v as Drive)} items={DRIVES.map((d) => ({ value: d, label: driveLabel(d) }))}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>{DRIVES.map((d) => <SelectItem key={d} value={d}>{driveLabel(d)}</SelectItem>)}</SelectContent>
          </Select>
          <button onClick={create} disabled={!name.trim()} className="px-3 py-2 bg-gray-900 text-white rounded-lg text-sm disabled:opacity-50">Create</button>
          {error && <p className="text-sm text-red-600 mt-2 w-full">{error}</p>}
        </div>
      )}

      {loading ? <p className="text-gray-400 py-12 text-center">Loading…</p>
        : items.length === 0 ? <p className="text-gray-400 py-12 text-center border border-dashed border-gray-300 rounded-2xl">No series yet — create one for a multi-event campaign.</p>
        : (
          <div className="space-y-4">
            {/* Series with events — each its own row, a fanned deck of its event cards (spreads on hover). */}
            {withEvents.map((s) => <SeriesRow key={s.id} s={s} onOpen={onOpen} />)}

            {/* Series without events yet — compact grid. */}
            {empty.length > 0 && (
              <div>
                {withEvents.length > 0 && <p className="text-[13px] text-gray-400 mt-6 mb-2">No events yet</p>}
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  {empty.map((s) => (
                    <button key={s.id} onClick={() => onOpen(s.id)} className="rounded-2xl border border-dashed border-gray-300 p-4 text-left hover:bg-gray-50 hover:border-gray-400 transition-colors">
                      <p className="font-medium truncate">{s.name}</p>
                      <p className="text-[13px] text-gray-400 capitalize">{s.drive} · no events yet</p>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
    </div>
  );
}

// One series as a fanned deck of event cards. Cards overlap at rest and spread apart on hover.
function SeriesRow({ s, onOpen }: { s: SeriesListItem; onOpen: (id: string) => void }) {
  const [hover, setHover] = useState(false);
  const shown = s.events.slice(0, MAX_FAN);
  const extra = s.events.length - shown.length;
  const slots = shown.length + (extra > 0 ? 1 : 0);
  const restX = 34; // overlap offset at rest
  const width = hover ? (slots - 1) * (CARD_W + 12) + CARD_W : (slots - 1) * restX + CARD_W;

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={() => onOpen(s.id)}
      className="cursor-pointer rounded-2xl border border-border p-4 hover:shadow-md transition-shadow"
    >
      <div className="flex items-baseline justify-between mb-3">
        <span className="font-medium">{s.name}</span>
        <span className="text-[13px] text-gray-500 capitalize">{s.drive} · {s.memberCount} event{s.memberCount === 1 ? "" : "s"}</span>
      </div>
      <div className="relative h-[152px] overflow-hidden transition-[width] duration-300" style={{ width, maxWidth: "100%" }}>
        {shown.map((e, i) => {
          const x = hover ? i * (CARD_W + 12) : i * restX;
          return (
            <div key={e.id} className="absolute left-0 top-0 w-44 rounded-xl border border-border bg-white shadow-sm overflow-hidden transition-transform duration-300"
              style={{ transform: `translateX(${x}px)`, zIndex: i }}>
              <MiniCard event={e} />
            </div>
          );
        })}
        {extra > 0 && (
          <div className="absolute left-0 top-0 w-44 h-36 rounded-xl border border-dashed border-gray-300 bg-gray-50 flex items-center justify-center text-sm text-gray-500 transition-transform duration-300"
            style={{ transform: `translateX(${hover ? shown.length * (CARD_W + 12) : shown.length * restX}px)`, zIndex: shown.length }}>
            +{extra} more
          </div>
        )}
      </div>
    </div>
  );
}

function MiniCard({ event }: { event: SeriesCardEvent }) {
  return (
    <div className="flex flex-col h-36">
      {/* No cover → just text (no placeholder cover area); with a cover → show the image band. */}
      {event.coverImageUrl && <img src={event.coverImageUrl} alt="" className="h-16 w-full object-cover" />}
      <div className="p-2 flex-1 min-h-0">
        <p className="text-[13px] font-medium leading-tight line-clamp-3">{event.title}</p>
        <p className="text-[11px] text-gray-400 mt-1 inline-flex items-center gap-1"><Calendar className="w-3 h-3" />{event.date ? fmtDay(event.date) : "No date"}</p>
      </div>
    </div>
  );
}
