import { useState } from "react";
import { CalendarPlus, Check, Loader2, ExternalLink, Activity } from "lucide-react";
import { Button } from "@instalily/ui/button";
import { syncEventToGoogleCalendar, syncEventToLinear, resolveGcalMatch } from "../lib/db";

// Shared control for hooking an event up to our external tools. Two uses:
//
//   variant="inline"  → compact "Add to Google Calendar" button shown next to the date during setup.
//   variant="action"  → the amber action-item card on the event page. Holds a line item per
//                        integration: Google Calendar (needs a date) + a Linear project. Each line
//                        turns into a confirmation once done; the whole card hides when nothing's left
//                        to set up.
//
// The Linear project is created under the single "EventHub" Linear team (see cloud-functions
// linear-sync) with one issue per deliverable — the confirmation names that team.

const LINEAR_TEAM = "EventHub"; // the Linear team every event project is created under

export function GCalSync({
  eventId,
  synced,
  htmlLink = null,
  variant = "inline",
  onSynced,
  gcalAvailable = true,
  linearSynced = false,
  linearProjectUrl = null,
  onLinearSynced,
  matchPending = null,
}: {
  eventId: string;
  synced: boolean;            // already on the calendar (gcalEventId present)
  htmlLink?: string | null;   // deep link to the Google Calendar event, if known
  variant?: "inline" | "action";
  onSynced?: () => void;
  gcalAvailable?: boolean;    // event has a date → the Google Calendar line is offered (action variant)
  linearSynced?: boolean;     // already mirrored to Linear (linear_project_id present)
  linearProjectUrl?: string | null; // deep link to the Linear project, if known
  onLinearSynced?: () => void;
  matchPending?: Record<string, { summary: string; reason?: string } | null> | null;
}) {
  const [done, setDone] = useState(synced);
  const [link, setLink] = useState<string | null>(htmlLink);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // True only when this component performed the sync (drives the confirmation message).
  const [justSynced, setJustSynced] = useState(false);
  const [pending, setPending] = useState<boolean>(!!matchPending);
  const pendingReason = matchPending ? (Object.values(matchPending).find((c) => c && c.reason)?.reason ?? "a possible existing match was found") : "a possible existing match was found";

  // Linear line state (action variant only).
  const [linDone, setLinDone] = useState(linearSynced);
  const [linLink, setLinLink] = useState<string | null>(linearProjectUrl);
  const [linBusy, setLinBusy] = useState(false);
  const [linErr, setLinErr] = useState<string | null>(null);
  const [linMsg, setLinMsg] = useState<string | null>(null); // confirmation after a sync this session
  const [linJustSynced, setLinJustSynced] = useState(false); // synced in THIS session → show a brief confirmation

  const add = async () => {
    setBusy(true); setErr(null);
    try {
      const res = await syncEventToGoogleCalendar(eventId);
      if (res.status === "needs_confirmation") { setPending(true); onSynced?.(); return; }
      setLink(res.htmlLink ?? null); setDone(true); setJustSynced(true); onSynced?.();
    } catch (e: any) { setErr(e?.message ?? String(e)); }
    finally { setBusy(false); }
  };
  const resolve = async (decision: "link" | "create") => {
    setBusy(true); setErr(null);
    try {
      await resolveGcalMatch(eventId, decision);
      if (decision === "create" || decision === "link") { setPending(false); setDone(true); setJustSynced(true); onSynced?.(); }
    } catch (e: any) { setErr(e?.message ?? String(e)); }
    finally { setBusy(false); }
  };

  const addLinear = async () => {
    setLinBusy(true);
    setLinErr(null);
    setLinMsg(null);
    try {
      const res = await syncEventToLinear(eventId);
      setLinLink(res.projectUrl ?? null);
      setLinDone(true);
      setLinJustSynced(true);
      setLinMsg(`Project created in Linear · ${LINEAR_TEAM} team · ${res.synced} ${res.synced === 1 ? "issue" : "issues"} synced`);
      onLinearSynced?.();
    } catch (e: any) {
      setLinErr(e?.message ?? String(e));
    } finally {
      setLinBusy(false);
    }
  };

  // ── Inline (setup) variant ────────────────────────────────────────────────
  if (variant !== "action") {
    if (done) {
      return (
        <span className="inline-flex items-center gap-1.5 text-[15px] text-emerald-700">
          <Check className="w-4 h-4" />
          {justSynced ? "Added to Google Calendar" : "On Google Calendar"}
          {link && (
            <a href={link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline decoration-dotted underline-offset-2 hover:text-emerald-900">
              View <ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}
        </span>
      );
    }
    if (pending && !done) {
      return (
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 text-[13px]">
            <CalendarPlus className="w-4 h-4 text-red-500" />
            <span className="text-red-600">{pendingReason}.</span>
            <button onClick={() => resolve("link")} disabled={busy} className="text-emerald-600 hover:text-emerald-700 font-medium disabled:opacity-50">Link</button>
            <button onClick={() => resolve("create")} disabled={busy} className="text-gray-600 hover:text-gray-800 disabled:opacity-50">Create new</button>
          </span>
          {err && <span className="text-[13px] text-red-600">{err}</span>}
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

  // ── Action variant — amber card listing only what's NOT done yet ───────────
  // A line stays only while its integration is pending. Once linked, it drops off entirely (a brief
  // confirmation lingers just for the sync you did this session). Card hides when nothing's left.
  // Auto-sync already adds dated events, so there's no manual "add to calendar" prompt here —
  // the GCal line appears only for a this-session confirmation or a collision "needs review".
  const gcalShow = gcalAvailable && (justSynced || pending);
  const linearShow = !linDone || linJustSynced;
  if (!gcalShow && !linearShow) return null;

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 divide-y divide-amber-200/70">
      {/* Google Calendar line — only when the event has a date and isn't already on the calendar */}
      {gcalShow && (
        <div className="py-3">
          {done ? (
            <div className="flex items-center gap-2 text-[15px] text-emerald-700">
              <Check className="w-4 h-4 shrink-0" />
              Added to Google Calendar
              {link && (
                <a href={link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline decoration-dotted underline-offset-2 hover:text-emerald-900">
                  View <ExternalLink className="w-3.5 h-3.5" />
                </a>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <CalendarPlus className="w-5 h-5 text-red-500 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-[15px] font-medium text-red-700">Review possible match</p>
                <p className="text-[13px] text-red-600">{pendingReason}.</p>
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => resolve("link")} disabled={busy}>
                  Link
                </Button>
                <Button size="sm" variant="outline" onClick={() => resolve("create")} disabled={busy}>
                  Create new
                </Button>
              </div>
            </div>
          )}
          {err && <p className="text-[13px] text-red-600 mt-2">{err}</p>}
        </div>
      )}

      {/* Linear project line — only while not yet linked */}
      {linearShow && (
        <div className="py-3">
          {linDone ? (
            <div className="flex items-center gap-2 text-[15px] text-emerald-700">
              <Check className="w-4 h-4 shrink-0" />
              <span>{linMsg ?? `Project created in Linear · ${LINEAR_TEAM} team`}</span>
              {linLink && (
                <a href={linLink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline decoration-dotted underline-offset-2 hover:text-emerald-900">
                  View <ExternalLink className="w-3.5 h-3.5" />
                </a>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <Activity className="w-5 h-5 text-amber-700 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-[15px] font-medium text-amber-900">Create a project in Linear</p>
                <p className="text-[13px] text-amber-700">Adds a project in the {LINEAR_TEAM} team, one issue per deliverable.</p>
              </div>
              <Button size="sm" onClick={addLinear} disabled={linBusy}>
                {linBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Activity className="w-4 h-4" />}
                Sync to Linear
              </Button>
            </div>
          )}
          {linErr && <p className="text-[13px] text-red-600 mt-2">{linErr}</p>}
        </div>
      )}
    </div>
  );
}
