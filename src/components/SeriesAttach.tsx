import { useEffect, useRef, useState } from "react";
import { Layers, ChevronDown, X } from "lucide-react";
import { listEvents, listSeries, setEventSeries, type SeriesListItem } from "../lib/db";

// The event ↔ series link, shown on the event title card. Displays the paired series (if any) behind a
// stacked-cards (Layers) icon, and lets you attach / change / detach the event's series right here.
// Self-contained: if the current series isn't passed in, it looks it up (so it works on any event view).
export function SeriesAttach({ eventId, seriesId, seriesName, onChanged }: {
  eventId: string;
  seriesId?: string | null;   // pass when the page already knows it; omit to look it up
  seriesName?: string | null;
  onChanged?: (seriesId: string | null) => void;
}) {
  const provided = seriesId !== undefined || seriesName !== undefined;
  const [curId, setCurId] = useState<string | null>(seriesId ?? null);
  const [curName, setCurName] = useState<string | null>(seriesName ?? null);
  const [list, setList] = useState<SeriesListItem[] | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Look up the current series if the caller didn't provide it.
  useEffect(() => {
    if (provided) return;
    listEvents().then((all) => { const e = all.find((x) => x.id === eventId); if (e) { setCurId(e.seriesId); setCurName(e.seriesName); } }).catch(() => {});
  }, [eventId, provided]);

  // Close the menu on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    if (!list) listSeries().then(setList).catch(() => setList([]));
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown); document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const choose = async (id: string | null) => {
    setBusy(true);
    await setEventSeries(eventId, id).catch(() => {});
    setCurId(id);
    setCurName(id ? (list?.find((s) => s.id === id)?.name ?? curName) : null);
    setBusy(false); setOpen(false);
    onChanged?.(id);
  };

  return (
    <span className="relative inline-block" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        disabled={busy}
        title={curName ? `In series: ${curName}` : "Attach this event to a series"}
        className={`inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-2.5 py-1 text-[13px] transition-colors disabled:opacity-60 ${curName ? "bg-white text-gray-700 hover:bg-gray-50" : "text-gray-500 hover:bg-gray-50"}`}
      >
        <Layers className="w-3.5 h-3.5 shrink-0" />
        <span className="truncate max-w-[16rem]">{curName ?? "Add to series"}</span>
        <ChevronDown className="w-3.5 h-3.5 shrink-0 text-gray-400" />
      </button>

      {open && (
        <div className="absolute z-30 mt-1 left-0 w-60 bg-white border border-border rounded-lg shadow-lg p-1 max-h-72 overflow-y-auto">
          {list === null ? (
            <p className="text-[13px] text-gray-400 px-2 py-2">Loading…</p>
          ) : (
            <>
              {list.length === 0 && <p className="text-[13px] text-gray-400 px-2 py-2">No series yet.</p>}
              {list.map((s) => (
                <button key={s.id} onClick={() => void choose(s.id)} className={`flex w-full items-center justify-between gap-2 px-2 py-1.5 rounded text-sm text-left hover:bg-gray-50 ${s.id === curId ? "bg-gray-100" : ""}`}>
                  <span className="inline-flex items-center gap-1.5 min-w-0"><Layers className="w-3.5 h-3.5 text-gray-400 shrink-0" /><span className="truncate">{s.name}</span></span>
                  <span className="text-[12px] text-gray-400 shrink-0 capitalize">{s.drive}</span>
                </button>
              ))}
              {curId && (
                <button onClick={() => void choose(null)} className="mt-1 flex w-full items-center gap-1.5 px-2 py-1.5 rounded text-[13px] text-left text-gray-500 hover:bg-gray-50 border-t border-gray-100">
                  <X className="w-3.5 h-3.5" /> Remove from series
                </button>
              )}
            </>
          )}
        </div>
      )}
    </span>
  );
}
