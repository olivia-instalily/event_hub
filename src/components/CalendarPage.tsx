import { useEffect, useState } from "react";
import { CalendarDays } from "lucide-react";
import { listEvents, type EventListItem } from "../lib/db";
import { CalendarView } from "./EventsPage";

// Top-level calendar of all events (month grid), reached from the nav. Reuses the same CalendarView
// the Events page uses in its calendar mode.
export function CalendarPage({ onOpenEvent }: { onOpenEvent: (id: string) => void }) {
  const [events, setEvents] = useState<EventListItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    listEvents().then((e) => { if (!cancelled) setEvents(e); }).catch(() => {}).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <CalendarDays className="w-6 h-6 text-gray-700" />
        <h1 className="text-2xl">Calendar</h1>
      </div>
      {loading ? (
        <p className="text-gray-400 py-12 text-center">Loading…</p>
      ) : (
        <CalendarView events={events} onOpen={onOpenEvent} />
      )}
    </div>
  );
}
