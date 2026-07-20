import { useEffect, useState } from "react";
import { ChevronLeft } from "lucide-react";
import { getSeriesCampaign, saveCampaign, type SeriesEvent } from "../lib/db";
import { type Campaign, emptyCampaign } from "../lib/campaign";
import { SeriesPlan } from "./SeriesPlan";
import { SeriesPeople } from "./SeriesPeople";
import { SeriesBudget } from "./SeriesBudget";
import { SeriesBriefs } from "./SeriesBriefs";

export interface TabProps {
  seriesId: string;
  campaign: Campaign;
  events: SeriesEvent[];
  save: (next: Campaign) => void;
  onOpenEvent?: (id: string) => void;
  reload: () => void;
}
type Tab = "plan" | "people" | "budget" | "briefs";
const TABS: { key: Tab; label: string }[] = [
  { key: "plan", label: "Plan" }, { key: "people", label: "People & logistics" },
  { key: "budget", label: "Budget" }, { key: "briefs", label: "Briefs" },
];

export function SeriesDashboard({ seriesId, onBack, onOpenEvent }: { seriesId: string; onBack: () => void; onOpenEvent?: (id: string) => void }) {
  const [name, setName] = useState("");
  const [campaign, setCampaign] = useState<Campaign>(emptyCampaign());
  const [events, setEvents] = useState<SeriesEvent[]>([]);
  const [tab, setTab] = useState<Tab>("plan");
  const [loading, setLoading] = useState(true);

  const load = () => { setLoading(true); getSeriesCampaign(seriesId).then((s) => { setName(s.name); setCampaign(s.campaign); setEvents(s.events); }).catch(() => {}).finally(() => setLoading(false)); };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [seriesId]);

  // Optimistic save: update local state immediately, persist in the background, reload on error.
  const save = (next: Campaign) => { setCampaign(next); saveCampaign(seriesId, next).catch(() => load()); };

  const props: TabProps = { seriesId, campaign, events, save, onOpenEvent, reload: load };

  return (
    <div className="max-w-5xl mx-auto">
      <button onClick={onBack} className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900 mb-3"><ChevronLeft className="w-4 h-4" /> Series</button>
      <h1 className="text-2xl mb-1">{name}</h1>
      <p className="text-sm text-gray-500 mb-5 capitalize">{campaign.drive} drive · {events.length} event{events.length === 1 ? "" : "s"}</p>

      <div className="border-b border-gray-200 mb-6 flex gap-4">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)} className={`pb-2 text-sm border-b-2 transition-colors ${tab === t.key ? "border-gray-900 text-gray-900 font-medium" : "border-transparent text-gray-500 hover:text-gray-800"}`}>{t.label}</button>
        ))}
      </div>

      {loading ? <p className="text-gray-400 py-12 text-center">Loading…</p> : (
        <>
          {tab === "plan" && <SeriesPlan {...props} />}
          {tab === "people" && <SeriesPeople {...props} />}
          {tab === "budget" && <SeriesBudget {...props} />}
          {tab === "briefs" && <SeriesBriefs {...props} />}
        </>
      )}
    </div>
  );
}
