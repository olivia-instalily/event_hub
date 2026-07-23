import { useState } from "react";
import { Calendar, CalendarPlus, Loader2, Link2Off } from "lucide-react";
import { syncEventToGoogleCalendar, deleteEventFromGoogleCalendar } from "../lib/db";

// Google Calendar link control for the event title card. Auto-sync already pushes dated events to
// the shared calendar; this shows the state and lets you manage the link:
//   • synced   → green calendar icon linking to the event + a delink button (confirm → deletes the
//                calendar instance; the EventHub event stays).
//   • unsynced → an "add to calendar" icon that (re)links.
// Hidden when the event has no date (Google Calendar needs one). `onChange` should refetch the plan
// so the icon reflects the new state.
export function GcalLinkControl({ eventId, synced, htmlLink, hasDate, onChange }: {
  eventId: string;
  synced: boolean;
  htmlLink: string | null;
  hasDate: boolean;
  onChange: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!hasDate) return null;

  const relink = async () => {
    setBusy(true); setErr(null);
    try { await syncEventToGoogleCalendar(eventId); onChange(); }
    catch (e: any) { setErr(e?.message ?? String(e)); }
    finally { setBusy(false); }
  };
  const delink = async () => {
    setBusy(true); setErr(null);
    try { await deleteEventFromGoogleCalendar(eventId); setConfirming(false); onChange(); }
    catch (e: any) { setErr(e?.message ?? String(e)); }
    finally { setBusy(false); }
  };

  if (confirming) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[13px] text-gray-600">
        Remove from Google Calendar?
        <button onClick={delink} disabled={busy} className="text-red-600 hover:text-red-700 font-medium disabled:opacity-50">{busy ? "Removing…" : "Remove"}</button>
        <button onClick={() => setConfirming(false)} disabled={busy} className="text-gray-500 hover:text-gray-700">Cancel</button>
      </span>
    );
  }

  if (synced) {
    return (
      <span className="inline-flex items-center gap-1">
        {htmlLink ? (
          <a href={htmlLink} target="_blank" rel="noreferrer" title="View in Google Calendar" className="inline-flex text-emerald-600 hover:text-emerald-700">
            <Calendar className="w-5 h-5" />
          </a>
        ) : (
          <Calendar className="w-5 h-5 text-emerald-600" />
        )}
        <button onClick={() => setConfirming(true)} title="Remove from Google Calendar" className="inline-flex text-gray-300 hover:text-gray-600">
          <Link2Off className="w-3.5 h-3.5" />
        </button>
        {err && <span className="text-[12px] text-red-600">{err}</span>}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1">
      <button onClick={relink} disabled={busy} title="Add to Google Calendar" className="inline-flex items-center text-gray-400 hover:text-gray-700 disabled:opacity-50">
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CalendarPlus className="w-5 h-5" />}
      </button>
      {err && <span className="text-[12px] text-red-600">{err}</span>}
    </span>
  );
}
