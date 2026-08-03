import { useState } from "react";
import { Calendar, CalendarPlus, Loader2, Link2Off } from "lucide-react";
import { syncEventToGoogleCalendar, deleteEventFromGoogleCalendar, resolveGcalMatch } from "../lib/db";

// Google Calendar link control for the event title card. Auto-sync already pushes dated events to
// the shared calendar; this shows the state and lets you manage the link:
//   • synced   → green calendar icon linking to the event + a delink button (confirm → deletes the
//                calendar instance; the EventHub event stays).
//   • unsynced → an "add to calendar" icon that (re)links.
// Hidden when the event has no date (Google Calendar needs one). `onChange` should refetch the plan
// so the icon reflects the new state.
export function GcalLinkControl({ eventId, synced, htmlLink, hasDate, matchPending = null, onChange }: {
  eventId: string;
  synced: boolean;
  htmlLink: string | null;
  hasDate: boolean;
  matchPending?: Record<string, { summary: string; reason?: string } | null> | null;
  onChange: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!hasDate) return null;

  // Explicit (re)link → force a fresh calendar instance for THIS event ('create'), not 'auto'. After a
  // remove, 'auto' re-classifies and can re-adopt a look-alike (e.g. a duplicate event's instance) or
  // loop back into "needs review" — so the button appeared to do nothing. 'create' always makes this
  // event its own instance, which also repopulates the clickable link.
  const relink = async () => {
    setBusy(true); setErr(null);
    try { await syncEventToGoogleCalendar(eventId, "create"); onChange(); }
    catch (e: any) { setErr(e?.message ?? String(e)); }
    finally { setBusy(false); }
  };
  const delink = async () => {
    setBusy(true); setErr(null);
    try { await deleteEventFromGoogleCalendar(eventId); setConfirming(false); onChange(); }
    catch (e: any) { setErr(e?.message ?? String(e)); }
    finally { setBusy(false); }
  };

  const pendingReason = matchPending
    ? Object.values(matchPending).find((c) => c && c.reason)?.reason ?? "a possible existing match was found"
    : null;
  const resolve = async (decision: "link" | "create") => {
    setBusy(true); setErr(null);
    try { await resolveGcalMatch(eventId, decision); onChange(); }
    catch (e: any) { setErr(e?.message ?? String(e)); }
    finally { setBusy(false); }
  };

  if (!synced && matchPending) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[13px] text-gray-600">
        <span title="Needs review before syncing" className="inline-flex"><Calendar className="w-5 h-5 text-red-500" /></span>
        <span className="text-red-600">{pendingReason}.</span>
        <button onClick={() => resolve("link")} disabled={busy} className="text-emerald-600 hover:text-emerald-700 font-medium disabled:opacity-50">{busy ? "…" : "Link"}</button>
        <button onClick={() => resolve("create")} disabled={busy} className="text-gray-600 hover:text-gray-800 disabled:opacity-50">Create new</button>
        {err && <span className="text-[12px] text-red-600">{err}</span>}
      </span>
    );
  }

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
          // Synced but the clickable link is missing — offer a re-link to rebuild the instance + link
          // instead of a dead icon.
          <button onClick={relink} disabled={busy} title="Calendar link missing — re-link to fix" className="inline-flex items-center text-amber-600 hover:text-amber-700 disabled:opacity-50">
            {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <CalendarPlus className="w-5 h-5" />}
          </button>
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
