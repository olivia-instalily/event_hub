import { useState } from "react";
import { CalendarPlus, Check, Loader2, ExternalLink } from "lucide-react";
import { Button } from "@instalily/ui/button";
import { syncEventToGoogleCalendar } from "../lib/db";

// Shared control for pushing an event onto the company Google Calendar (one toggleable
// secondary calendar under calendar@instalily.ai). Used both as an inline prompt in the
// create/setup flow and as a persistent action item on the event page. Only meaningful
// once the event has a date — callers gate on that.
//
//   variant="inline"  → compact button shown next to the date field during setup
//   variant="action"  → full-width amber action-item card on the event page

export function GCalSync({
  eventId,
  synced,
  htmlLink = null,
  variant = "inline",
  onSynced,
}: {
  eventId: string;
  synced: boolean;            // already on the calendar (gcalEventId present)
  htmlLink?: string | null;   // deep link to the Google Calendar event, if known
  variant?: "inline" | "action";
  onSynced?: () => void;
}) {
  const [done, setDone] = useState(synced);
  const [link, setLink] = useState<string | null>(htmlLink);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // True only when this component performed the sync (drives the confirmation message).
  const [justSynced, setJustSynced] = useState(false);

  const add = async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await syncEventToGoogleCalendar(eventId);
      setLink(res.htmlLink ?? null);
      setDone(true);
      setJustSynced(true);
      onSynced?.();
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  // Once synced: the action item shows nothing (the green header calendar icon conveys it);
  // the inline (setup) control shows a small confirmation with a "View" link.
  if (done) {
    if (variant === "action") return null;
    return (
      <span className="inline-flex items-center gap-1.5 text-[15px] text-emerald-700">
        <Check className="w-4 h-4" />
        {justSynced ? "Added to Google Calendar" : "On Google Calendar"}
        {link && (
          <a
            href={link}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 underline decoration-dotted underline-offset-2 hover:text-emerald-900"
          >
            View <ExternalLink className="w-3.5 h-3.5" />
          </a>
        )}
      </span>
    );
  }

  if (variant === "action") {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
        <div className="flex items-center gap-3">
          <CalendarPlus className="w-5 h-5 text-amber-700 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-[15px] font-medium text-amber-900">Add this event to Google Calendar</p>
            <p className="text-[13px] text-amber-700">Puts it on the shared company calendar (calendar@instalily.ai).</p>
          </div>
          <Button size="sm" onClick={add} disabled={busy}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CalendarPlus className="w-4 h-4" />}
            Add to calendar
          </Button>
        </div>
        {err && <p className="text-[13px] text-red-600 mt-2">{err}</p>}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Button size="sm" variant="outline" onClick={add} disabled={busy}>
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CalendarPlus className="w-4 h-4" />}
        Add to Google Calendar
      </Button>
      {err && <span className="text-[13px] text-red-600">{err}</span>}
    </div>
  );
}
