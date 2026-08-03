import { useEffect, useState } from "react";
import { ChevronLeft, Folder } from "lucide-react";
import { getSeriesCampaign, getSeriesEvents, saveCampaign, renameSeries, type SeriesEvent } from "../lib/db";
import { type Campaign, emptyCampaign } from "../lib/campaign";
import { CopyLinkButton } from "./CopyLinkButton";
import { DocLinkControl } from "./DocLinkControl";
import { SeriesOverview } from "./SeriesOverview";
import { SeriesPlan } from "./SeriesPlan";
import { SeriesEvents } from "./SeriesEvents";
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
  reloadEvents: () => void; // refetch only the member events (leaves the optimistic campaign intact)
}
type Tab = "overview" | "plan" | "events" | "people" | "budget" | "briefs";
const TABS: { key: Tab; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "plan", label: "Plan" }, { key: "events", label: "Events" },
  { key: "people", label: "People & logistics" },
  { key: "budget", label: "Budget" }, { key: "briefs", label: "Briefs" },
];

export function SeriesDashboard({ seriesId, onBack, onOpenEvent, initialTab }: { seriesId: string; onBack: () => void; onOpenEvent?: (id: string) => void; initialTab?: string | null }) {
  const [name, setName] = useState("");
  const [campaign, setCampaign] = useState<Campaign>(emptyCampaign());
  const [events, setEvents] = useState<SeriesEvent[]>([]);
  // Open the tab named by a deep link (?series=<id>&tab=…) when it's a real tab, else the default Plan.
  const [tab, setTab] = useState<Tab>(TABS.some((t) => t.key === initialTab) ? (initialTab as Tab) : "overview");
  const [loading, setLoading] = useState(true);
  const [saveError, setSaveError] = useState<string | null>(null);

  const load = () => { setLoading(true); getSeriesCampaign(seriesId).then((s) => { setName(s.name); setCampaign(s.campaign); setEvents(s.events); }).catch(() => {}).finally(() => setLoading(false)); };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [seriesId]);

  // Optimistic save: update local state immediately, persist in the background, reload on error.
  const save = (next: Campaign) => { setSaveError(null); setCampaign(next); saveCampaign(seriesId, next).then(() => setSaveError(null)).catch((e: unknown) => { setSaveError(e instanceof Error && e.message ? `Couldn't save — your last change was reverted (${e.message})` : "Couldn't save — your last change was reverted."); load(); }); };

  const reloadEvents = () => { getSeriesEvents(seriesId).then(setEvents).catch(() => {}); };

  const props: TabProps = { seriesId, campaign, events, save, onOpenEvent, reload: load, reloadEvents };

  return (
    <div className="max-w-5xl mx-auto">
      <button onClick={onBack} className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900 mb-3"><ChevronLeft className="w-4 h-4" /> Series</button>
      {/* Title is click-to-edit; commits on blur / Enter. Copy-link button copies the synced URL. */}
      <div className="flex items-start justify-between gap-3 mb-1">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => { void renameSeries(seriesId, name).catch(() => {}); }}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
          placeholder="Untitled campaign"
          aria-label="Series title"
          className="text-2xl min-w-0 flex-1 bg-transparent rounded border-b border-transparent hover:border-gray-200 focus:border-gray-400 focus:outline-none"
        />
        <CopyLinkButton className="mt-2 shrink-0" />
      </div>
      <div className="flex items-center justify-between gap-3 mb-5">
        <p className="text-sm text-gray-500 capitalize">{campaign.drive} drive · {events.length} event{events.length === 1 ? "" : "s"}</p>
        {/* Single paired Drive folder (open-only). */}
        <div className="shrink-0">
          <DocLinkControl
            url={campaign.folderUrl}
            onSave={(u) => save({ ...campaign, folderUrl: u })}
            label="Folder"
            icon={<Folder className="w-4 h-4" />}
            placeholder="Paste Drive folder link…"
          />
        </div>
      </div>

      <div className="border-b border-gray-200 mb-6 flex gap-4">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)} className={`pb-2 text-sm border-b-2 transition-colors ${tab === t.key ? "border-gray-900 text-gray-900 font-medium" : "border-transparent text-gray-500 hover:text-gray-800"}`}>{t.label}</button>
        ))}
      </div>

      {loading ? <p className="text-gray-400 py-12 text-center">Loading…</p> : (
        <>
          {saveError && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700">{saveError}</div>}
          {tab === "overview" && <SeriesOverview {...props} />}
          {tab === "plan" && <SeriesPlan {...props} />}
          {tab === "events" && <SeriesEvents {...props} />}
          {tab === "people" && <SeriesPeople {...props} />}
          {tab === "budget" && <SeriesBudget {...props} />}
          {tab === "briefs" && <SeriesBriefs {...props} />}
        </>
      )}
    </div>
  );
}
