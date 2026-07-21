import { useEffect, useState } from "react";
import { Calendar, MapPin, Star } from "lucide-react";
import type { TabProps } from "./SeriesDashboard";
import { waveColor } from "../lib/campaign";
import { listEvents, type EventListItem } from "../lib/db";
import { TagStack } from "./TagStack";

// Events tab: each member event as a compact version of its own title card (cover band, tags, title,
// format + date/location), plus which wave it's in (color-coded). Clicking opens the full event page
// (Back there returns to this series). Full event data is fetched to mirror the real title card.
export function SeriesEvents({ campaign, events, onOpenEvent }: TabProps) {
  const [rich, setRich] = useState<Record<string, EventListItem>>({});
  useEffect(() => { listEvents().then((all) => { const m: Record<string, EventListItem> = {}; for (const e of all) m[e.id] = e; setRich(m); }).catch(() => {}); }, []);

  if (events.length === 0) return <p className="text-gray-400">No events in this series yet — add them on the Plan tab.</p>;

  const waveOf = (eventId: string) => {
    const idx = campaign.waves.findIndex((w) => w.eventIds.includes(eventId));
    return idx >= 0 ? { wave: campaign.waves[idx], color: waveColor(idx) } : null;
  };

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {events.map((e) => {
        const full = rich[e.id];
        const w = waveOf(e.id);
        const anchor = campaign.anchorEventIds.includes(e.id);
        const cover = full?.coverImageUrl ?? null;
        return (
          <button
            key={e.id}
            onClick={() => onOpenEvent?.(e.id)}
            className="group text-left rounded-xl border border-border bg-white overflow-hidden hover:shadow-md transition-shadow flex flex-col"
          >
            {cover && (
              <div className="h-24 overflow-hidden">
                <img src={cover} alt="" className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" style={{ objectPosition: full?.coverPosition ?? "50% 50%" }} />
              </div>
            )}
            <div className="p-4">
              <div className="flex items-center justify-between gap-2 mb-1.5 min-h-[1.5rem]">
                {full && full.tags.length > 0 ? <TagStack tags={full.tags} /> : <span />}
                {w
                  ? <span className={`inline-flex items-center gap-1 text-[12px] shrink-0 ${w.color.text}`}><span className={`w-2 h-2 rounded-full ${w.color.dot}`} />{w.wave.name || "Wave"}</span>
                  : <span className="text-[12px] text-gray-400 shrink-0">Pending</span>}
              </div>
              <h3 className="text-[15px] font-medium mb-1 flex items-center gap-1.5">
                {anchor && <span title="Anchor event" className="inline-flex shrink-0"><Star className="w-3.5 h-3.5 text-amber-500" /></span>}
                <span className="truncate">{e.name}</span>
              </h3>
              <div className="flex flex-wrap items-center gap-2 text-[13px] text-gray-500">
                {full?.format && <span className="px-2 py-0.5 bg-gray-100 rounded-md text-[12px] text-gray-700">{full.format}</span>}
                <span className="inline-flex items-center gap-1"><Calendar className="w-3.5 h-3.5 text-gray-400" />{e.date ?? "No date"}</span>
                {e.location && <span className="inline-flex items-center gap-1 min-w-0"><MapPin className="w-3.5 h-3.5 text-gray-400 shrink-0" /><span className="truncate">{e.location}</span></span>}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
