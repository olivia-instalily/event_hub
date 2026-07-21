import { useEffect, useState } from "react";
import { CalendarDays, Plus, ArrowRight } from "lucide-react";
import { listEvents, listExternalConferences, type EventListItem } from "../lib/db";
import { CalendarView } from "./EventsPage";
import { ExternalConferenceForm } from "./ExternalConferenceForm";
import { ExternalDetail, CategoryDots, categoryOf, ALL_CATS, type CatKey } from "./externalEvents";

// Clean, calendar-only view of everything on our radar: events we're running + external conferences
// we're attending. No cards/lines toggle here — the full Events page (with those views + all filters)
// is one click away. External items open a read-only card; real events route to their workspace.
export function CalendarPage({ onOpenEvent, onOpenEventsPage }: { onOpenEvent: (id: string) => void; onOpenEventsPage?: () => void }) {
  const [events, setEvents] = useState<EventListItem[]>([]);
  const [external, setExternal] = useState<EventListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [detail, setDetail] = useState<EventListItem | null>(null);
  const [cats, setCats] = useState<Set<CatKey>>(() => new Set(ALL_CATS)); // colored-dot filter (toggle in/out)

  const load = () => {
    setLoading(true);
    Promise.all([listEvents(), listExternalConferences()])
      .then(([e, x]) => { setEvents(e); setExternal(x); })
      .catch(() => {})
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const merged = [...events, ...external];
  const onOpen = (id: string) => { const x = external.find((e) => e.id === id); if (x) setDetail(x); else onOpenEvent(id); };
  const toggleCat = (k: CatKey) => setCats((prev) => { const n = new Set(prev); if (n.has(k)) n.delete(k); else n.add(k); return n.size ? n : new Set(ALL_CATS); });
  const shown = merged.filter((e) => cats.has(categoryOf(e)));

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-3">
          <CalendarDays className="w-6 h-6 text-gray-700" />
          <h1 className="text-2xl">Calendar</h1>
        </div>
        {onOpenEventsPage && (
          <button onClick={onOpenEventsPage} className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900 border border-border rounded-lg px-3 py-1.5 hover:bg-gray-50 transition-colors">
            Open full events page <ArrowRight className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Colored-dot filter — toggle categories in/out (default all). Same dots as the Events page. */}
      <div className="flex flex-wrap items-center gap-2 mb-5">
        <CategoryDots selected={cats} onToggle={toggleCat} />
        <button onClick={() => setAddOpen(true)} title="Add external event" aria-label="Add external event" className="inline-flex items-center gap-1 rounded-full border border-border bg-white px-2 py-1 text-gray-600 hover:bg-gray-50 transition-colors">
          <span className="w-2 h-2 rounded-full bg-purple-500" /><Plus className="w-3 h-3" />
        </button>
      </div>

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
