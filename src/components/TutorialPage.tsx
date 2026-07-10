import { useMemo, useState, type ComponentType } from "react";
import {
  HelpCircle, Clock, Search, PlayCircle,
  FolderInput, Copy, History, PencilLine,
  DollarSign, GitBranch, Activity, CalendarDays, Flag,
} from "lucide-react";

// STATIC help/reference page: bite-sized use-case walkthroughs (Arcade embeds) grouped by section.
// Player on the left, task index on the right; clicking an index item loads that walkthrough.
//
// This is NOT a guided tour — it doesn't read app state or point at live elements. It just renders
// videos, so it doesn't break when the UI changes (a stale clip just gets re-recorded).
//
// ADD/REORDER a walkthrough = edit SECTIONS below (data), not this component. To make an item live:
// set `embedUrl` to the Arcade embed URL and flip `status` to "ready".

type Status = "ready" | "soon" | "planned";

interface Walkthrough {
  title: string;                 // task-first, e.g. "Create from a folder"
  when: string;                  // one-line "when you'd do this"
  icon: ComponentType<{ className?: string }>;
  length: string;                // duration, e.g. "1:10"
  embedUrl: string | null;       // Arcade embed URL; null until recorded
  status: Status;
}

interface Section { heading: string; blurb: string; items: Walkthrough[] }

const SECTIONS: Section[] = [
  {
    heading: "Getting an event in",
    blurb: "The four ways an event starts life in EventHub.",
    items: [
      { title: "Create from a folder", when: "You have a brief, budget, or attendee list to drop in.", icon: FolderInput, length: "1:10", embedUrl: null, status: "soon" },
      { title: "Spin up from a similar event", when: "You've run something like this before and want to reuse it.", icon: Copy, length: "0:55", embedUrl: null, status: "soon" },
      { title: "Color in a past event", when: "Backfilling an event that already happened.", icon: History, length: "1:05", embedUrl: null, status: "soon" },
      { title: "Build from scratch", when: "Starting fresh with no source material.", icon: PencilLine, length: "0:50", embedUrl: null, status: "soon" },
    ],
  },
  {
    heading: "Planning the event",
    blurb: "Working an event through to the day-of.",
    items: [
      { title: "Budget flow", when: "Scoping a target and tracking spend against it.", icon: DollarSign, length: "1:20", embedUrl: null, status: "soon" },
      { title: "Phases", when: "Laying out the timeline and its deliverables.", icon: GitBranch, length: "1:00", embedUrl: null, status: "soon" },
      { title: "Sync with Linear", when: "Mirroring deliverables into Linear as issues.", icon: Activity, length: "0:45", embedUrl: null, status: "soon" },
      { title: "Calendar", when: "Putting the event on the shared company calendar.", icon: CalendarDays, length: "0:40", embedUrl: null, status: "soon" },
    ],
  },
  {
    heading: "After the event",
    blurb: "Closing an event out into a complete record.",
    items: [
      { title: "Wrap & settle", when: "Recording what happened and settling the budget.", icon: Flag, length: "—", embedUrl: null, status: "planned" },
    ],
  },
];

const STATUS_LABEL: Record<Status, string> = { ready: "", soon: "Soon", planned: "Planned" };

function StatusBadge({ item }: { item: Walkthrough }) {
  if (item.status === "ready") {
    return <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-[12px] text-gray-600"><PlayCircle className="w-3 h-3" /> {item.length}</span>;
  }
  const cls = item.status === "soon" ? "bg-amber-50 text-amber-700" : "bg-gray-100 text-gray-500";
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px] ${cls}`}><Clock className="w-3 h-3" /> {STATUS_LABEL[item.status]}</span>;
}

// A ready item only plays if it actually has an embed URL — otherwise it degrades to the staged look.
const isPlayable = (w: Walkthrough) => w.status === "ready" && !!w.embedUrl;

export function TutorialPage() {
  const allItems = useMemo(() => SECTIONS.flatMap((s) => s.items), []);
  // Default selection: first playable walkthrough, else the first item.
  const [selectedTitle, setSelectedTitle] = useState<string>(() => (allItems.find(isPlayable) ?? allItems[0])?.title ?? "");
  const [query, setQuery] = useState("");

  const selected = allItems.find((w) => w.title === selectedTitle) ?? allItems[0];

  // Nice-to-have: filter the index by title. Sections with no matches drop out.
  const q = query.trim().toLowerCase();
  const filtered = q
    ? SECTIONS.map((s) => ({ ...s, items: s.items.filter((w) => w.title.toLowerCase().includes(q)) })).filter((s) => s.items.length > 0)
    : SECTIONS;

  const SelIcon = selected?.icon ?? HelpCircle;

  return (
    <div className="max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-1">
        <HelpCircle className="w-6 h-6 text-gray-700" />
        <h1 className="text-2xl">How to use EventHub</h1>
      </div>
      <p className="text-sm text-gray-500 mb-6">Short, task-focused walkthroughs. Pick one on the right to watch it here.</p>

      <div className="grid gap-6 lg:grid-cols-[1.9fr_1fr]">
        {/* Player (left) */}
        <div>
          <div className="relative aspect-video w-full overflow-hidden rounded-xl border border-border bg-gray-900">
            {selected && isPlayable(selected) ? (
              <iframe
                key={selected.title}
                src={selected.embedUrl!}
                title={selected.title}
                className="w-full h-full"
                allowFullScreen
                allow="clipboard-write; fullscreen; picture-in-picture"
              />
            ) : (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-center text-gray-400">
                <Clock className="w-8 h-8 mb-3" />
                <p className="text-gray-200 font-medium">{selected?.status === "planned" ? "Planned" : "Coming soon"}</p>
                <p className="text-sm mt-1 max-w-xs">This walkthrough hasn't been recorded yet — check back soon.</p>
              </div>
            )}
            {selected && isPlayable(selected) && (
              <span className="absolute top-3 right-3 rounded-full bg-black/60 px-2 py-0.5 text-[12px] text-white">{selected.length}</span>
            )}
          </div>

          {/* Caption */}
          {selected && (
            <div className="mt-3 flex items-start gap-3">
              <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-700"><SelIcon className="w-5 h-5" /></span>
              <div className="min-w-0">
                <h2 className="text-lg font-medium leading-tight">{selected.title}</h2>
                <p className="text-sm text-gray-500 mt-0.5">{selected.when}</p>
              </div>
            </div>
          )}
        </div>

        {/* Index (right) */}
        <div className="lg:max-h-[72vh] lg:overflow-y-auto lg:pr-1">
          <div className="relative mb-3">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search walkthroughs…"
              className="w-full rounded-lg border border-border pl-8 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300"
            />
          </div>

          {filtered.length === 0 && <p className="text-sm text-gray-400 px-1 py-6 text-center">No walkthroughs match "{query}".</p>}

          <div className="space-y-6">
            {filtered.map((section) => (
              <section key={section.heading}>
                <h3 className="text-[15px] font-medium text-gray-900">{section.heading}</h3>
                <p className="text-[13px] text-gray-500 mb-2">{section.blurb}</p>
                <div className="space-y-1">
                  {section.items.map((item) => {
                    const Icon = item.icon;
                    const active = item.title === selectedTitle;
                    return (
                      <button
                        key={item.title}
                        onClick={() => setSelectedTitle(item.title)}
                        className={`flex w-full items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left transition-colors ${
                          active ? "border-gray-300 bg-gray-100" : "border-transparent hover:bg-gray-50"
                        }`}
                      >
                        <Icon className="w-4 h-4 shrink-0 text-gray-500" />
                        <span className="flex-1 truncate text-sm text-gray-800">{item.title}</span>
                        <StatusBadge item={item} />
                      </button>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
