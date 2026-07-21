import { useEffect, useState } from "react";
import { ChevronLeft, Folder, ExternalLink, X } from "lucide-react";
import { getSeriesCampaign, getSeriesEvents, saveCampaign, type SeriesEvent } from "../lib/db";
import { type Campaign, emptyCampaign } from "../lib/campaign";
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
type Tab = "plan" | "events" | "people" | "budget" | "briefs";
const TABS: { key: Tab; label: string }[] = [
  { key: "plan", label: "Plan" }, { key: "events", label: "Events" },
  { key: "people", label: "People & logistics" },
  { key: "budget", label: "Budget" }, { key: "briefs", label: "Briefs" },
];

export function SeriesDashboard({ seriesId, onBack, onOpenEvent, initialTab }: { seriesId: string; onBack: () => void; onOpenEvent?: (id: string) => void; initialTab?: string | null }) {
  const [name, setName] = useState("");
  const [campaign, setCampaign] = useState<Campaign>(emptyCampaign());
  const [events, setEvents] = useState<SeriesEvent[]>([]);
  // Open the tab named by a deep link (?series=<id>&tab=…) when it's a real tab, else the default Plan.
  const [tab, setTab] = useState<Tab>(TABS.some((t) => t.key === initialTab) ? (initialTab as Tab) : "plan");
  const [loading, setLoading] = useState(true);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [folderEdit, setFolderEdit] = useState(false);
  const [folderInput, setFolderInput] = useState("");

  const load = () => { setLoading(true); getSeriesCampaign(seriesId).then((s) => { setName(s.name); setCampaign(s.campaign); setEvents(s.events); }).catch(() => {}).finally(() => setLoading(false)); };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [seriesId]);

  // Optimistic save: update local state immediately, persist in the background, reload on error.
  const save = (next: Campaign) => { setSaveError(null); setCampaign(next); saveCampaign(seriesId, next).then(() => setSaveError(null)).catch((e: unknown) => { setSaveError(e instanceof Error && e.message ? `Couldn't save — your last change was reverted (${e.message})` : "Couldn't save — your last change was reverted."); load(); }); };

  const reloadEvents = () => { getSeriesEvents(seriesId).then(setEvents).catch(() => {}); };
  const saveFolder = () => { const u = folderInput.trim(); save({ ...campaign, folderUrl: u && u.startsWith("http") ? u : null }); setFolderEdit(false); };

  const props: TabProps = { seriesId, campaign, events, save, onOpenEvent, reload: load, reloadEvents };

  return (
    <div className="max-w-5xl mx-auto">
      <button onClick={onBack} className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900 mb-3"><ChevronLeft className="w-4 h-4" /> Series</button>
      <h1 className="text-2xl mb-1">{name}</h1>
      <div className="flex items-center justify-between gap-3 mb-5">
        <p className="text-sm text-gray-500 capitalize">{campaign.drive} drive · {events.length} event{events.length === 1 ? "" : "s"}</p>
        {/* Single paired Drive folder (open-only). */}
        <div className="shrink-0">
          {folderEdit ? (
            <span className="inline-flex items-center gap-1">
              <input autoFocus value={folderInput} onChange={(e) => setFolderInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") saveFolder(); if (e.key === "Escape") setFolderEdit(false); }} placeholder="Paste Drive folder link…" className="w-64 px-2 py-1 border border-border rounded text-[13px] focus:outline-none focus:ring-2 focus:ring-gray-300" />
              <button onClick={saveFolder} className="text-[13px] text-gray-600 hover:text-gray-900">Save</button>
              <button onClick={() => setFolderEdit(false)} className="text-gray-400 hover:text-gray-700"><X className="w-4 h-4" /></button>
            </span>
          ) : campaign.folderUrl ? (
            <span className="inline-flex items-center gap-2">
              <a href={campaign.folderUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-[13px] text-gray-700 hover:text-gray-900 border border-border rounded-lg px-2.5 py-1 hover:bg-gray-50 transition-colors"><Folder className="w-4 h-4" /> Folder <ExternalLink className="w-3.5 h-3.5 text-gray-400" /></a>
              <button onClick={() => { setFolderInput(campaign.folderUrl ?? ""); setFolderEdit(true); }} className="text-[12px] text-gray-400 hover:text-gray-700">edit</button>
            </span>
          ) : (
            <button onClick={() => { setFolderInput(""); setFolderEdit(true); }} className="inline-flex items-center gap-1.5 text-[13px] text-gray-500 hover:text-gray-900 border border-dashed border-gray-300 rounded-lg px-2.5 py-1 hover:bg-gray-50 transition-colors"><Folder className="w-4 h-4" /> Add folder</button>
          )}
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
