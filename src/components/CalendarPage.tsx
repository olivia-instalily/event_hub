import { useEffect, useState } from "react";
import { CalendarDays, Plus, MapPin, ExternalLink, X, Users } from "lucide-react";
import { listEvents, listExternalConferences, listAttendeesForEvent, type EventListItem, type PersonView } from "../lib/db";
import { CalendarView } from "./EventsPage";
import { ExternalConferenceForm } from "./ExternalConferenceForm";
import { Modal } from "./Modal";

// Calendar dot categories — colors mirror CalendarView's dotColor. Grouped by what they mean:
// the first three are events WE'RE PLANNING (running); external is one we're ATTENDING.
type CatKey = "future" | "in-process" | "past" | "external";
type LegendItem = { key: CatKey; label: string; dot: string };
const PLANNING_LEGEND: LegendItem[] = [
  { key: "future", label: "Future", dot: "bg-blue-500" },
  { key: "in-process", label: "In-process", dot: "bg-amber-500" },
  { key: "past", label: "Past", dot: "bg-gray-400" },
];
const EXTERNAL_LEGEND: LegendItem[] = [
  { key: "external", label: "External", dot: "bg-purple-500" },
];

// Top-level calendar of all events (month grid) + lightweight EXTERNAL conferences we're attending.
// Reuses the same CalendarView the Events page uses; external items are marked and open a read-only
// card (they're not operated events — no workspace).
export function CalendarPage({ onOpenEvent }: { onOpenEvent: (id: string) => void }) {
  const [events, setEvents] = useState<EventListItem[]>([]);
  const [external, setExternal] = useState<EventListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [detail, setDetail] = useState<EventListItem | null>(null);
  const [filter, setFilter] = useState<CatKey | null>(null); // one-at-a-time dot filter

  const load = () => {
    setLoading(true);
    Promise.all([listEvents(), listExternalConferences()])
      .then(([e, x]) => { setEvents(e); setExternal(x); })
      .catch(() => {})
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const merged = [...events, ...external];
  // External items open a read-only card; real events route to the workspace.
  const onOpen = (id: string) => { const x = external.find((e) => e.id === id); if (x) setDetail(x); else onOpenEvent(id); };

  // Same categories as the calendar dots — one filter at a time (click a legend dot to filter, click
  // it again to clear).
  const category = (e: EventListItem): CatKey => e.isExternal ? "external" : (e.macroStage === "Wrapped" || e.status === "past") ? "past" : e.status === "in-process" ? "in-process" : "future";
  const shown = filter ? merged.filter((e) => category(e) === filter) : merged;

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <CalendarDays className="w-6 h-6 text-gray-700" />
        <h1 className="text-2xl">Calendar</h1>
      </div>

      {/* Dot legend — click to filter (one at a time; click again to clear). Grouped: events we're
          planning (running) vs. external events we're attending. */}
      {(() => {
        const chip = (l: LegendItem) => {
          const active = filter === l.key;
          return (
            <button
              key={l.key}
              onClick={() => setFilter(active ? null : l.key)}
              aria-pressed={active}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] transition-colors ${active ? "border-gray-900 bg-gray-900 text-white" : "border-border bg-white text-gray-600 hover:bg-gray-50"}`}
            >
              <span className={`w-2 h-2 rounded-full ${l.dot}`} /> {l.label}
            </button>
          );
        };
        return (
          <div className="space-y-1.5 mb-5">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[12px] text-gray-400 w-28 shrink-0">We're planning</span>
              {PLANNING_LEGEND.map(chip)}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[12px] text-gray-400 w-28 shrink-0">We're attending</span>
              {EXTERNAL_LEGEND.map(chip)}
              {/* Add an external event — purple dot + plus, right after the External chip. */}
              <button onClick={() => setAddOpen(true)} title="Add external event" aria-label="Add external event" className="inline-flex items-center gap-1 rounded-full border border-border bg-white px-2 py-1 text-gray-600 hover:bg-gray-50 transition-colors">
                <span className="w-2 h-2 rounded-full bg-purple-500" /><Plus className="w-3 h-3" />
              </button>
              {filter && <button onClick={() => setFilter(null)} className="text-[12px] text-gray-400 hover:text-gray-700 ml-1">Clear filter</button>}
            </div>
          </div>
        );
      })()}

      {loading ? (
        <p className="text-gray-400 py-12 text-center">Loading…</p>
      ) : (
        <CalendarView events={shown} onOpen={onOpen} />
      )}

      {addOpen && <ExternalConferenceForm onClose={() => setAddOpen(false)} onCreated={() => { setAddOpen(false); load(); }} />}
      {detail && <ExternalDetail item={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}

// Read-only card for an external conference — External · quarter, date range, location, info link,
// and attendee chips. No status/phase/budget affordances (it's not an operated event).
function ExternalDetail({ item, onClose }: { item: EventListItem; onClose: () => void }) {
  const [people, setPeople] = useState<PersonView[] | null>(null);
  useEffect(() => { listAttendeesForEvent(item.id).then(setPeople).catch(() => setPeople([])); }, [item.id]);

  const fmt = (d: string) => new Date(d + "T12:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  const range = item.date ? (item.endDate && item.endDate !== item.date ? `${fmt(item.date)} – ${fmt(item.endDate)}` : fmt(item.date)) : "No date";

  return (
    <Modal title={item.title} onClose={onClose} maxWidth="max-w-md">
      <div className="space-y-3">
        <span className="inline-flex items-center gap-1 text-[12px] font-medium text-purple-700 bg-purple-50 border border-purple-200 rounded-full px-2 py-0.5">
          External{item.quarter ? ` · ${item.quarter}` : ""}
        </span>
        {item.why && <p className="text-sm text-gray-700">{item.why}</p>}
        <div className="text-sm text-gray-700 space-y-1.5">
          <div className="flex items-center gap-2"><CalendarDays className="w-4 h-4 text-gray-400 shrink-0" /> {range}</div>
          {item.location && <div className="flex items-center gap-2"><MapPin className="w-4 h-4 text-gray-400 shrink-0" /> {item.location}</div>}
          {item.infoUrl && <div className="flex items-center gap-2"><ExternalLink className="w-4 h-4 text-gray-400 shrink-0" /> <a href={item.infoUrl} target="_blank" rel="noreferrer" className="text-blue-600 underline decoration-dotted underline-offset-2 hover:text-blue-800 truncate">{item.infoUrl}</a></div>}
        </div>
        <div>
          <div className="flex items-center gap-2 text-[13px] text-gray-500 mb-1"><Users className="w-4 h-4" /> Attending{people ? ` (${people.length})` : ""}</div>
          {people === null ? (
            <p className="text-[13px] text-gray-400">Loading…</p>
          ) : people.length === 0 ? (
            <p className="text-[13px] text-gray-400">No one tagged yet.</p>
          ) : (
            <ul className="flex flex-wrap gap-1.5">
              {people.map((p) => (
                <li key={p.id} className="inline-flex items-center bg-gray-100 rounded-full px-2.5 py-0.5 text-[13px] text-gray-800">{p.name ?? "Unnamed"}{p.org ? ` · ${p.org}` : ""}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <div className="flex justify-end mt-5"><button onClick={onClose} className="inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg border border-gray-300 hover:bg-gray-50"><X className="w-4 h-4" /> Close</button></div>
    </Modal>
  );
}
