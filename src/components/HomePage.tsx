import { Calendar, MapPin, CheckSquare, Plus, Trash2, BadgeCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { listEvents, deleteEvent, listOwnerTodos, type EventListItem, type OwnerTodo } from "../lib/db";
import { useProfile, initials } from "../lib/profile";
import { TagStack } from "./TagStack";
import { ConfirmModal } from "./Modal";
import { NewEventDropZone } from "./NewEventDropZone";
import { useEventDrop } from "./useEventDrop";

const NOT_CAPTURED = "Not captured";
// Phase color dots — same palette/order as the phase tracker (by phase order).
const PHASE_DOT = ["bg-blue-500", "bg-violet-500", "bg-amber-500", "bg-emerald-500", "bg-rose-500", "bg-teal-500"];

/** Profile-dependent landing page: events assigned to the current profile + a (future) todos rail. */
export function HomePage({ onOpenEvent, onCreateEvent, onNewEventFiles }: { onOpenEvent: (eventId: string) => void; onCreateEvent: () => void; onNewEventFiles?: (files: File[]) => void }) {
  const { current } = useProfile();
  const [events, setEvents] = useState<EventListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<EventListItem | null>(null);
  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const id = deleteTarget.id;
    setEvents((prev) => prev.filter((e) => e.id !== id)); // optimistic
    setDeleteTarget(null);
    try { await deleteEvent(id); } catch (e: any) { setError(e.message ?? String(e)); }
  };

  const [todos, setTodos] = useState<OwnerTodo[]>([]);
  // Drop a doc/folder onto an event card here too (shared with the Events list).
  const reload = () => { listEvents().then(setEvents).catch(() => {}); };
  const { dropZone, dragOverId, dropBusyId, overlays: dropOverlays } = useEventDrop(reload);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listEvents()
      .then((e) => { if (!cancelled) setEvents(e); })
      .catch((e) => { if (!cancelled) setError(e.message ?? String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // Todos = upcoming deliverables across the events this profile owns.
  useEffect(() => {
    if (!current) { setTodos([]); return; }
    let cancelled = false;
    listOwnerTodos(current.id).then((t) => { if (!cancelled) setTodos(t); }).catch(() => { if (!cancelled) setTodos([]); });
    return () => { cancelled = true; };
  }, [current?.id]);

  // Events the current profile owns. Future/in-process first (soonest), then past (most recent), undated last.
  const myEvents = !current
    ? []
    : events
        .filter((e) => !e.isTemplate) // templates aren't events — hidden from Home
        .filter((e) => e.owners.some((o) => o.id === current.id))
        .sort((a, b) => {
          const ad = a.date ?? "", bd = b.date ?? "";
          const aPast = a.status === "past", bPast = b.status === "past";
          if (aPast !== bPast) return aPast ? 1 : -1; // upcoming before past
          if (!ad && !bd) return 0;
          if (!ad) return 1;
          if (!bd) return -1;
          return aPast ? bd.localeCompare(ad) : ad.localeCompare(bd);
        });

  // Todos grouped by event (the active events you own), showing at most 5 per event.
  const todoGroups = (() => {
    const m = new Map<string, { eventId: string; name: string; items: OwnerTodo[]; total: number }>();
    for (const td of todos) {
      let g = m.get(td.eventId);
      if (!g) { g = { eventId: td.eventId, name: td.eventName, items: [], total: 0 }; m.set(td.eventId, g); }
      g.total++;
      if (g.items.length < 5) g.items.push(td);
    }
    return [...m.values()].map((g) => ({ ...g, more: g.total - g.items.length }));
  })();

  return (
    <div>
      {dropOverlays}
      <div className="flex items-center justify-between gap-3 mb-8">
        <div className="flex items-center gap-3 cursor-default select-none">
          {current && (
            <span className="group relative cursor-default">
              <span className={`flex items-center justify-center w-10 h-10 rounded-full text-white text-sm cursor-default select-none ${current.color ?? "bg-gray-500"}`}>
                {initials(current.name)}
              </span>
              {/* Full-name tooltip — shows instantly on hover (no fade), with a caret. */}
              <span className="pointer-events-none absolute left-1/2 top-full z-20 mt-2 -translate-x-1/2 hidden group-hover:block">
                <span className="relative block whitespace-nowrap rounded-lg bg-gray-900 px-3 py-1.5 text-[13px] font-medium text-white shadow-lg">
                  {current.name}
                  <span className="absolute -top-1 left-1/2 h-2 w-2 -translate-x-1/2 rotate-45 bg-gray-900" />
                </span>
              </span>
            </span>
          )}
          <div>
            <h1 className="text-2xl">{current ? `Hi, ${current.name.split(/\s+/)[0]}` : "Home"}</h1>
            {!current && <p className="text-gray-500 text-sm">Pick a profile to see your events.</p>}
          </div>
        </div>
        <button
          onClick={onCreateEvent}
          className="flex items-center gap-2 px-4 py-2 bg-muted text-foreground rounded-lg hover:brightness-95 hover:shadow-sm transition shrink-0"
        >
          <Plus className="w-4 h-4" />
          Create Event
        </button>
      </div>

      {onNewEventFiles && <div className="mb-8"><NewEventDropZone onFiles={onNewEventFiles} onClick={onCreateEvent} /></div>}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Your events */}
        <section className="lg:col-span-2">
          <h2 className="text-lg mb-4">Your events</h2>

          {loading && <p className="text-gray-500 text-sm">Loading…</p>}
          {error && <p className="text-red-600 text-sm">{error}</p>}

          {!loading && !error && myEvents.length === 0 && (
            <div className="border border-dashed border-gray-300 rounded-2xl p-8 text-center text-gray-500 text-sm">
              No events are assigned to {current ? current.name.split(/\s+/)[0] : "you"} yet.
            </div>
          )}

          {!loading && !error && myEvents.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              {myEvents.map((event) => (
                <div
                  key={event.id}
                  {...dropZone(event.id, event.title)}
                  onClick={() => onOpenEvent(event.id)}
                  className={`group relative text-left bg-white rounded-2xl p-6 hover:shadow-md transition-shadow overflow-hidden flex flex-col cursor-pointer ${dragOverId === event.id ? 'border ring-2 ring-gray-400 border-gray-400 bg-gray-50' : 'border border-border'}`}
                >
                  {dropBusyId === event.id && <div className="absolute inset-0 z-20 bg-white/70 flex items-center justify-center text-sm text-gray-600">Processing…</div>}
                  <button
                    onClick={(e) => { e.stopPropagation(); setDeleteTarget(event); }}
                    className="absolute top-2 right-2 z-10 p-1.5 text-gray-400 hover:text-red-600 hover:bg-gray-100 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                    aria-label="Delete event"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                  {event.coverImageUrl && (
                    <img
                      src={event.coverImageUrl}
                      alt=""
                      className="-mx-6 -mt-6 mb-4 h-32 w-[calc(100%+3rem)] max-w-none object-cover"
                      style={{ objectPosition: event.coverPosition ?? "50% 50%" }}
                    />
                  )}

                  <div className="flex items-center justify-between gap-2 mb-2">
                    {event.format && <span className="px-2.5 py-1 bg-gray-100 rounded-md text-[15px]">{event.format}</span>}
                    {event.attendeeCount != null && (
                      <span className="text-gray-500 text-[15px] whitespace-nowrap">{event.attendeeCount} checked in</span>
                    )}
                  </div>

                  <h3 className="text-lg mb-1 flex items-center gap-1.5"><span>{event.title}</span>{event.finalRecordComplete && <span title="Complete record" className="inline-flex shrink-0"><BadgeCheck className="w-4 h-4 text-emerald-600" /></span>}</h3>
                  {event.seriesName && <p className="text-gray-500 text-sm mb-3">{event.seriesName}</p>}

                  <div className="flex flex-wrap items-center gap-2 mt-auto pt-2">
                    <span className="px-3 py-1 bg-gray-100 rounded-md text-sm flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      {event.date ?? NOT_CAPTURED}
                    </span>
                    <span className="px-3 py-1 bg-gray-100 rounded-md text-sm flex items-center gap-1">
                      <MapPin className="w-3 h-3" />
                      {event.location ?? NOT_CAPTURED}
                    </span>
                    {event.tags.length > 0 && <TagStack tags={event.tags} />}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Todos — grouped by event (the active events you own), capped at 5 each. */}
        <section>
          <h2 className="text-lg mb-4">Todos</h2>
          {todos.length === 0 ? (
            <div className="border border-dashed border-gray-300 rounded-2xl p-8 text-center text-gray-500">
              <CheckSquare className="w-6 h-6 mx-auto mb-2 text-gray-400" />
              <p className="text-sm">{current ? "No open deliverables on your events." : "Pick a profile to see your todos."}</p>
            </div>
          ) : (
            <div className="space-y-4">
              {todoGroups.map((g) => (
                <div key={g.eventId} className="bg-white rounded-2xl border border-border overflow-hidden">
                  <button onClick={() => onOpenEvent(g.eventId)} className="w-full flex items-center justify-between gap-2 px-4 py-2.5 bg-muted/50 hover:bg-muted text-left">
                    <span className="font-medium text-sm truncate">{g.name}</span>
                    <span className="text-[13px] text-gray-400 shrink-0">{g.total} open</span>
                  </button>
                  <div className="divide-y divide-gray-100">
                    {g.items.map((td) => {
                      const overdue = td.dueDate && td.dueDate < new Date().toISOString().slice(0, 10);
                      const urgent = td.phaseOrder === g.items[0].phaseOrder; // earliest phase in this event
                      return (
                        <button key={td.id} onClick={() => onOpenEvent(td.eventId)} className={`w-full text-left px-4 py-3 flex items-start gap-3 hover:bg-gray-50 transition-colors ${urgent ? "bg-gray-50/60" : ""}`}>
                          <span className={`w-2.5 h-2.5 rounded-full mt-1 shrink-0 ${PHASE_DOT[td.phaseOrder % PHASE_DOT.length] ?? "bg-gray-300"}`} title={td.phase ?? "Unphased"} />
                          <span className="flex-1 min-w-0">
                            <span className={`block text-sm truncate ${urgent ? "text-gray-900 font-medium" : "text-gray-900"}`}>{td.title}</span>
                            {td.phase && <span className="block text-[15px] text-gray-400 truncate">{td.phase}</span>}
                          </span>
                          <span className={`text-[15px] shrink-0 ${overdue ? "text-red-600 font-medium" : "text-gray-400"}`}>{overdue ? "overdue" : td.dueDate ?? "—"}</span>
                        </button>
                      );
                    })}
                    {g.more > 0 && (
                      <button onClick={() => onOpenEvent(g.eventId)} className="w-full text-left px-4 py-2 text-[13px] text-gray-500 hover:bg-gray-50">+{g.more} more on this event</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {deleteTarget && (
        <ConfirmModal
          title="Delete event"
          message={`Delete “${deleteTarget.title}”? This can't be undone.`}
          confirmLabel="Delete"
          danger
          onConfirm={confirmDelete}
          onClose={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
