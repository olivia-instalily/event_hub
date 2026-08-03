import { useEffect, useState } from "react";
import { CalendarClock, ArrowUpRight, Unlink } from "lucide-react";
import { getUpcomingMeetings, detachMeeting, type UpcomingMeeting } from "../lib/db";

// A small event-overview section listing calendar meetings that relate to this event (read live from
// the shared calendars). Self-hides when there are none. Each meeting can be detached if it's a wrong
// match — detach is sticky (by calendar id) so it won't re-appear.
export function UpcomingMeetings({ eventId }: { eventId: string }) {
  const [meetings, setMeetings] = useState<UpcomingMeeting[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const reload = () => { void getUpcomingMeetings(eventId).then(setMeetings).catch(() => setMeetings([])); };
  useEffect(() => { reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [eventId]);

  const detach = async (id: string) => { setBusy(id); try { await detachMeeting(eventId, id); setMeetings((m) => (m ?? []).filter((x) => x.id !== id)); } catch { /* ignore */ } finally { setBusy(null); } };

  const fmt = (iso: string) => new Date(iso).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

  // Self-hiding: render nothing until loaded, and nothing when there are no upcoming meetings.
  if (!meetings || meetings.length === 0) return null;

  return (
    <section className="bg-white rounded-2xl border border-border p-5">
      <div className="flex items-center gap-2 mb-3">
        <CalendarClock className="w-4 h-4 text-gray-400" />
        <h3 className="font-medium">Upcoming meetings</h3>
        <span className="text-[12px] text-gray-400">from the calendar · drop the transcript in Slack after each</span>
      </div>
      <ul className="divide-y divide-gray-100">
        {meetings.map((m) => (
          <li key={m.id} className="flex items-center gap-3 py-2">
            <span className="flex-1 min-w-0">
              <span className="block text-sm text-gray-800 truncate">{m.title}</span>
              <span className="block text-[12px] text-gray-500">{fmt(m.start)}</span>
            </span>
            {m.htmlLink && <a href={m.htmlLink} target="_blank" rel="noreferrer" title="Open in Google Calendar" className="shrink-0 text-gray-400 hover:text-violet-600"><ArrowUpRight className="w-4 h-4" /></a>}
            <button onClick={() => detach(m.id)} disabled={busy === m.id} title="Detach — this meeting isn't part of this event" className="shrink-0 inline-flex items-center gap-1 text-[12px] text-gray-400 hover:text-red-600 disabled:opacity-50">
              <Unlink className="w-3.5 h-3.5" /> detach
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
