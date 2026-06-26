import { useState } from "react";
import { Activity, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@instalily/ui/button";
import { syncEventToLinear } from "../lib/db";

// Sync control for mirroring an event's deliverables into Linear (event → Project in the single
// "EventHub" team, each deliverable → an Issue). Shows a "Sync to Linear" button until synced,
// then an "Open in Linear" link plus a quiet Resync. Confirmation message after each run.

export function LinearSync({
  eventId,
  projectUrl = null,
  count,
  onSynced,
}: {
  eventId: string;
  projectUrl?: string | null;  // event.linear_project_url, if already synced
  count: number;               // number of deliverables (for the button label)
  onSynced?: () => void;
}) {
  const [url, setUrl] = useState<string | null>(projectUrl);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const sync = async () => {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const res = await syncEventToLinear(eventId);
      setUrl(res.projectUrl ?? url);
      setMsg(`Synced ${res.synced} ${res.synced === 1 ? "issue" : "issues"} to Linear`);
      onSynced?.();
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-2 shrink-0">
      {err && <span className="text-[13px] text-red-600 max-w-[16rem] truncate" title={err}>{err}</span>}
      {!err && msg && <span className="text-[13px] text-emerald-700">{msg}</span>}
      {url ? (
        <Button size="sm" variant="outline" onClick={sync} disabled={busy} title="Push EventHub deliverables out to Linear (overwrites issue status there). Linear → EventHub happens automatically on page load.">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          Push to Linear
        </Button>
      ) : (
        <Button size="sm" variant="outline" onClick={sync} disabled={busy || count === 0} title="Create this event's Linear project and push its deliverables as issues">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Activity className="w-4 h-4" />}
          Sync to Linear
        </Button>
      )}
    </div>
  );
}
