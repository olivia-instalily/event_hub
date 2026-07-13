import { useState } from "react";
import { Activity, AlertTriangle, ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { checkLinearProject, syncEventToLinear } from "../lib/db";

// "Open in Linear" that never leads to a dead page. A Linear project can be deleted out from under us
// in Linear itself; before navigating, we verify it still exists. If it's gone, we say so and offer a
// one-click re-sync that recreates the project and pushes every deliverable back into it.
//
// When the event isn't synced yet (projectUrl is null), the same button becomes "Sync to Linear":
// one click creates the project, pushes every deliverable, and opens it.
export function OpenInLinear({
  eventId,
  projectUrl,
  className,
  onSynced,
}: {
  eventId: string;
  projectUrl: string | null;
  className?: string;
  onSynced?: (url: string | null) => void;
}) {
  const [url, setUrl] = useState(projectUrl);
  const [checking, setChecking] = useState(false);
  const [resyncing, setResyncing] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  // Open a blank tab synchronously (inside the click gesture) so popup blockers don't eat it, then
  // point it at the project once existence is confirmed — or close it and surface the re-sync offer.
  const open = async () => {
    setErr(null); setMsg(null); setDeleted(false);
    const tab = window.open("", "_blank");
    setChecking(true);
    try {
      const r = await checkLinearProject(eventId);
      if (r.exists && r.url) {
        setUrl(r.url);
        if (tab) tab.location.href = r.url; else window.open(r.url, "_blank");
      } else {
        tab?.close();
        setDeleted(true); // linked once, but the project is gone from Linear
      }
    } catch (e: any) {
      tab?.close();
      setErr(e?.message ?? String(e));
    } finally {
      setChecking(false);
    }
  };

  const resync = async () => {
    setErr(null); setMsg(null);
    const tab = window.open("", "_blank");
    setResyncing(true);
    try {
      const res = await syncEventToLinear(eventId, { recreate: true });
      setDeleted(false);
      setUrl(res.projectUrl ?? url);
      setMsg(`Recreated in Linear — ${res.synced} ${res.synced === 1 ? "issue" : "issues"} synced`);
      if (res.projectUrl && tab) tab.location.href = res.projectUrl; else tab?.close();
    } catch (e: any) {
      tab?.close();
      setErr(e?.message ?? String(e));
    } finally {
      setResyncing(false);
    }
  };

  // First-time sync from the corner button: create the project, push deliverables, open it.
  const sync = async () => {
    setErr(null); setMsg(null);
    const tab = window.open("", "_blank");
    setResyncing(true);
    try {
      const res = await syncEventToLinear(eventId);
      setUrl(res.projectUrl ?? null);
      setMsg(`Created in Linear — ${res.synced} ${res.synced === 1 ? "issue" : "issues"} synced`);
      if (res.projectUrl && tab) tab.location.href = res.projectUrl; else tab?.close();
      onSynced?.(res.projectUrl ?? null);
    } catch (e: any) {
      tab?.close();
      setErr(e?.message ?? String(e));
    } finally {
      setResyncing(false);
    }
  };

  return (
    <div className={className}>
      {!url ? (
        <button
          onClick={sync}
          disabled={resyncing}
          title="Create this event's project in Linear and push every deliverable into it"
          className="inline-flex items-center gap-1 text-[15px] text-purple-600 hover:text-purple-800 disabled:opacity-60"
        >
          {resyncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Activity className="w-4 h-4" />}
          Sync to Linear <ExternalLink className="w-3.5 h-3.5" />
        </button>
      ) : deleted ? (
        <div className="flex flex-col items-end gap-1 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 shadow-sm">
          <div className="flex items-center gap-1.5 text-[13px] text-amber-800">
            <AlertTriangle className="w-4 h-4 shrink-0" /> This event's Linear project was deleted.
          </div>
          <button
            onClick={resync}
            disabled={resyncing}
            title="Recreate the project in Linear and push every deliverable back into it"
            className="inline-flex items-center gap-1 text-[13px] font-medium text-purple-700 hover:text-purple-900 disabled:opacity-60"
          >
            {resyncing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Re-sync to Linear
          </button>
        </div>
      ) : (
        <button
          onClick={open}
          disabled={checking}
          title="Open this event's project in Linear"
          className="inline-flex items-center gap-1 text-[15px] text-purple-600 hover:text-purple-800 disabled:opacity-60"
        >
          {checking ? <Loader2 className="w-4 h-4 animate-spin" /> : <Activity className="w-4 h-4" />}
          Open in Linear <ExternalLink className="w-3.5 h-3.5" />
        </button>
      )}
      {err && <div className="mt-1 max-w-[16rem] text-right text-[12px] text-red-600" title={err}>{err}</div>}
      {msg && !err && <div className="mt-1 text-right text-[12px] text-emerald-700">{msg}</div>}
    </div>
  );
}
