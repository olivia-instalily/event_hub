import { useEffect, useState } from "react";
import { CalendarDays, Plus, ArrowRight } from "lucide-react";
import { listEvents, listExternalConferences, type EventListItem } from "../lib/db";
import { CalendarView } from "./EventsPage";
import { ExternalConferenceForm } from "./ExternalConferenceForm";
import { ExternalDetail, CAT_META, categoryOf, type CatKey } from "./externalEvents";

// Clean, calendar-only view of everything on our radar: events we're running + external conferences
// we're attending. Future/In-Process/Past act as a color key AND jump to that category's first event
// (they don't filter). External is the only real filter (show/hide). The full Events page (cards/
// lines + all filters) is one click away.
export function CalendarPage({ onOpenEvent, onOpenEventsPage }: { onOpenEvent: (id: string) => void; onOpenEventsPage?: () => void }) {
  const [events, setEvents] = useState<EventListItem[]>([]);
  const [external, setExternal] = useState<EventListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [detail, setDetail] = useState<EventListItem | null>(null);
  const [showExternal, setShowExternal] = useState(true); // the one real filter: show/hide external
  const [jump, setJump] = useState<{ date: string; nonce: number } | null>(null);

  const load = () => {
    setLoading(true);
    Promise.all([listEvents(), listExternalConferences()])
      .then(([e, x]) => { setEvents(e); setExternal(x); })
      .catch(() => {})
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const merged = [...events, ...external];
  const shown = showExternal ? merged : events; // Future/In-Process/Past never filter — only External
  const onOpen = (id: string) => { const x = external.find((e) => e.id === id); if (x) setDetail(x); else onOpenEvent(id); };

  // Jump the calendar to a category's first event: soonest upcoming for future/in-process, most
  // recent for past. Dated events only.
  const firstOf = (cat: CatKey): string | null => {
    const dated = merged.filter((e) => e.date && categoryOf(e) === cat).map((e) => e.date as string).sort();
    if (!dated.length) return null;
    return cat === "past" ? dated[dated.length - 1] : dated[0];
  };
  const jumpTo = (cat: CatKey) => { const d = firstOf(cat); if (d) setJump((j) => ({ date: d, nonce: (j?.nonce ?? 0) + 1 })); };

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

      {/* Future / In-Process / Past — a color key that also jumps to that category's first event
          (no filtering). External is the only real filter (show/hide). */}
      <div className="flex flex-wrap items-center gap-2 mb-5">
        {(["future", "in-process", "past"] as CatKey[]).map((k) => {
          const meta = CAT_META.find((m) => m.key === k)!;
          const has = merged.some((e) => e.date && categoryOf(e) === k);
          return (
            <button
              key={k}
              onClick={() => jumpTo(k)}
              disabled={!has}
              title={has ? `Jump to first ${meta.label} event` : `No ${meta.label} events`}
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-white px-2.5 py-1 text-[12px] text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-40 disabled:cursor-default"
            >
              <span className={`w-2 h-2 rounded-full ${meta.dot}`} /> {meta.label}
            </button>
          );
        })}
        <button
          onClick={() => setShowExternal((v) => !v)}
          aria-pressed={showExternal}
          title="Show or hide external events we're attending"
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] transition-colors ${showExternal ? "bg-gray-200 text-gray-900" : "text-gray-500 hover:bg-gray-100"}`}
        >
          <span className="w-2 h-2 rounded-full bg-purple-500" /> External
        </button>
        <button onClick={() => setAddOpen(true)} title="Add external event" aria-label="Add external event" className="inline-flex items-center gap-1 rounded-full border border-border bg-white px-2 py-1 text-gray-600 hover:bg-gray-50 transition-colors">
          <span className="w-2 h-2 rounded-full bg-purple-500" /><Plus className="w-3 h-3" />
        </button>
      </div>

      {loading ? (
        <p className="text-gray-400 py-12 text-center">Loading…</p>
      ) : (
        <CalendarView events={shown} onOpen={onOpen} jump={jump ?? undefined} />
      )}

      {addOpen && <ExternalConferenceForm onClose={() => setAddOpen(false)} onCreated={() => { setAddOpen(false); load(); }} />}
      {detail && <ExternalDetail item={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}
