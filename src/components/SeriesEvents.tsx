import { Calendar, MapPin, Star, ExternalLink } from "lucide-react";
import type { TabProps } from "./SeriesDashboard";
import { waveColor } from "../lib/campaign";

const money = (n: number) => "$" + n.toLocaleString();

// Events tab: a summary block per member event (the important-at-a-glance info). Clicking opens the
// full event page (Back there returns to this series). Each block shows which wave it's in (color-coded).
export function SeriesEvents({ campaign, events, onOpenEvent }: TabProps) {
  if (events.length === 0) return <p className="text-gray-400">No events in this series yet — add them on the Plan tab.</p>;

  const waveOf = (eventId: string) => {
    const idx = campaign.waves.findIndex((w) => w.eventIds.includes(eventId));
    return idx >= 0 ? { wave: campaign.waves[idx], color: waveColor(idx) } : null;
  };

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {events.map((e) => {
        const w = waveOf(e.id);
        const anchor = campaign.anchorEventIds.includes(e.id);
        return (
          <button
            key={e.id}
            onClick={() => onOpenEvent?.(e.id)}
            className="group text-left rounded-xl border border-border bg-white p-4 hover:shadow-md transition-shadow"
          >
            <div className="flex items-center justify-between gap-2 mb-2">
              <span className="inline-flex items-center gap-1.5 min-w-0">
                {anchor && <span title="Anchor event" className="shrink-0 inline-flex"><Star className="w-3.5 h-3.5 text-amber-500" /></span>}
                <span className="font-medium truncate">{e.name}</span>
              </span>
              <ExternalLink className="w-3.5 h-3.5 text-gray-400 shrink-0 group-hover:text-gray-600" />
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-gray-500">
              <span className="inline-flex items-center gap-1"><Calendar className="w-3.5 h-3.5 text-gray-400" />{e.date ?? "No date"}</span>
              {e.location && <span className="inline-flex items-center gap-1 min-w-0"><MapPin className="w-3.5 h-3.5 text-gray-400 shrink-0" /><span className="truncate">{e.location}</span></span>}
              {e.eventBudgetTarget != null && <span>{money(e.eventBudgetTarget)}</span>}
            </div>
            <div className="mt-2">
              {w
                ? <span className={`inline-flex items-center gap-1 text-[12px] ${w.color.text}`}><span className={`w-2 h-2 rounded-full ${w.color.dot}`} />{w.wave.name || "Wave"}</span>
                : <span className="text-[12px] text-gray-400">Pending · not in a wave</span>}
            </div>
          </button>
        );
      })}
    </div>
  );
}
