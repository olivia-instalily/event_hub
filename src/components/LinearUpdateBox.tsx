import { useEffect, useRef, useState } from "react";
import { Activity, ExternalLink, Loader2, Send, X } from "lucide-react";
import { Button } from "@instalily/ui/button";
import {
  detectUpdate, setDeliverableStatus, setAllDeliverablesStatus, getDeliverableCounts, setEngagementStage, recordEventUpdate, syncEventToLinear,
  getDeliverableLinear,
} from "../lib/db";

// A bulk "mark everything done" instruction — applies to ALL deliverables, not one. The single-match
// detect-update path can't express "all", so catch it before triage. Requires a complete-ish verb
// AND an everything-ish scope ("all", "every", "everything") so a single-task note isn't swept up.
function isBulkComplete(t: string): boolean {
  const s = t.toLowerCase();
  const done = /\b(complete[d]?|finish(ed)?|done|close[d]?|mark(ed)?\s+(as\s+)?(done|complete))\b/.test(s);
  const all = /\b(all|every(thing)?|each)\b/.test(s);
  return done && all;
}

// Pull a Linear issue identifier (e.g. "EVT-12") out of its web url for a friendly label.
function ticketLabel(url: string | null): string {
  const m = url?.match(/\/issue\/([A-Za-z0-9]+-\d+)/);
  return m ? m[1] : "ticket";
}

// Structured confirmation of what actually happened, with an optional ticket link.
type Result = { text: string; pre?: string; post?: string; label?: string; url?: string | null };

// A "drop a Linear update" box, processed like @Linear in Slack: free text → Claude/heuristic
// triage (detect-update) → act on the matching deliverable / vendor, mirrored to Linear when the
// event is already synced. Two looks:
//   variant="card"     → inline card (Overview, under Budget / above Deliverables)
//   variant="floating" → fixed lower-right pill on the Deliverables page that expands a composer

export function LinearUpdateBox({
  eventId,
  linearSynced = false,
  onApplied,
  variant = "card",
}: {
  eventId: string;
  linearSynced?: boolean; // event already mirrored to Linear → push the change back too
  onApplied?: () => void;
  variant?: "card" | "floating";
}) {
  const [open, setOpen] = useState(variant === "card"); // card is always open; floating toggles
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // A bulk "mark everything done" is held here pending explicit confirmation (it moves many tickets).
  const [pending, setPending] = useState<{ text: string; open: number } | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Floating box: the result confirmation lingers; clicking outside the box (or Escape) dismisses it.
  const close = () => { setOpen(false); setResult(null); setErr(null); setPending(null); };
  useEffect(() => {
    if (variant !== "floating" || !open) return;
    const onDown = (e: MouseEvent) => { if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) close(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [variant, open]);

  const submit = async () => {
    const t = text.trim();
    if (!t) return;
    // Bulk "mark everything done" moves many tickets at once — don't act on it directly. Look up
    // how many are still open and ask for explicit confirmation first (see the confirm bar below).
    if (isBulkComplete(t)) {
      setBusy(true); setErr(null); setResult(null);
      try {
        const { open: openCount } = await getDeliverableCounts(eventId);
        setPending({ text: t, open: openCount });
      } catch (e: any) { setErr(e?.message ?? String(e)); }
      finally { setBusy(false); }
      return;
    }
    setBusy(true); setErr(null); setResult(null);
    try {
      const p = await detectUpdate(eventId, t, "linear", null);
      // complete = Done; status carries an explicit target (Todo / In Progress / Done).
      const targetStatus = p.kind === "complete" ? "Done" : p.kind === "status" ? (p.status || null) : null;

      if (targetStatus && p.deliverableId) {
        await setDeliverableStatus(p.deliverableId, targetStatus);
        await recordEventUpdate(eventId, { source: "linear", summary: p.summary, detail: t, deliverableId: p.deliverableId });
        // Mirror to Linear (await so we can read back the issue link), then confirm with the ticket.
        let url: string | null = null;
        if (linearSynced) {
          try { await syncEventToLinear(eventId); const d = await getDeliverableLinear(p.deliverableId); url = d?.linearIssueUrl ?? null; } catch { /* keep EventHub result */ }
        }
        const title = p.matchedName ?? "task";
        setResult(url
          ? { text: "", pre: "Moved ticket ", label: ticketLabel(url), url, post: ` “${title}” to ${targetStatus}` }
          : { text: `Moved “${title}” to ${targetStatus}` });
      } else if (p.kind === "contract" && p.engagementId) {
        await setEngagementStage(p.engagementId, "Contracted", { note: t });
        await recordEventUpdate(eventId, { source: "linear", summary: p.summary, detail: t, engagementId: p.engagementId });
        if (linearSynced) void syncEventToLinear(eventId).catch(() => {});
        setResult({ text: `Moved “${p.matchedName ?? "vendor"}” to Contracted` });
      } else {
        await recordEventUpdate(eventId, { source: "linear", summary: p.summary, detail: t, engagementId: p.engagementId });
        if (linearSynced) void syncEventToLinear(eventId).catch(() => {});
        setResult({ text: `Logged: ${p.summary || "update"}` });
      }
      setText("");
      onApplied?.();
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  // Confirmed bulk close-out: mark ALL deliverables Done, then mirror the whole set to Linear
  // (linear-sync pushes every deliverable's state) so no ticket is left open.
  const confirmBulk = async () => {
    if (!pending) return;
    setBusy(true); setErr(null); setResult(null);
    try {
      const n = await setAllDeliverablesStatus(eventId, "Done");
      await recordEventUpdate(eventId, { source: "linear", summary: "Marked all deliverables Done", detail: pending.text });
      let note = "";
      if (linearSynced) {
        try { const r = await syncEventToLinear(eventId); note = r?.synced != null ? ` · ${r.synced} ticket${r.synced === 1 ? "" : "s"} moved in Linear` : ""; }
        catch { note = " · couldn't reach Linear — tickets not updated"; }
      }
      setResult({ text: `Marked ${n} deliverable${n === 1 ? "" : "s"} Done${note}` });
      setText("");
      onApplied?.();
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setBusy(false); setPending(null);
    }
  };

  const composer = (
    <div className="space-y-2">
      <textarea
        value={text}
        onChange={(e) => { setText(e.target.value); setResult(null); setErr(null); setPending(null); }}
        onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submit(); }}
        rows={variant === "floating" ? 3 : 2}
        placeholder="Drop a Linear update — e.g. “caterer contract signed”, “finished the run-of-show deck”…"
        className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-300 resize-y"
      />
      {pending ? (
        // Confirm bar for the bulk close-out — explicit, since it moves many tickets at once.
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
          <p className="text-[13px] text-amber-900">
            {pending.open === 0
              ? "All deliverables are already marked Done — nothing to move."
              : linearSynced
                ? `Mark all ${pending.open} open deliverable${pending.open === 1 ? "" : "s"} Done and move their Linear ticket${pending.open === 1 ? "" : "s"} to completed?`
                : `Mark all ${pending.open} open deliverable${pending.open === 1 ? "" : "s"} Done? (this event isn't synced to Linear)`}
          </p>
          <div className="flex items-center justify-end gap-2 mt-2">
            <button onClick={() => setPending(null)} disabled={busy} className="px-3 py-1.5 text-[13px] text-gray-600 hover:text-gray-900">{pending.open === 0 ? "Dismiss" : "Cancel"}</button>
            {pending.open > 0 && (
              <Button size="sm" onClick={confirmBulk} disabled={busy}>
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Activity className="w-4 h-4" />}
                {linearSynced ? "Move all in Linear" : "Mark all Done"}
              </Button>
            )}
          </div>
        </div>
      ) : (
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] min-w-0 truncate">
          {err ? (
            <span className="text-red-600">{err}</span>
          ) : result ? (
            <span className="text-emerald-700 inline-flex items-center gap-1">
              ✓ {result.pre}
              {result.url && result.label && (
                <a href={result.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 font-medium underline decoration-dotted underline-offset-2 hover:text-emerald-900">
                  {result.label}<ExternalLink className="w-3 h-3" />
                </a>
              )}
              {result.post ?? result.text}
            </span>
          ) : (
            <span className="text-gray-400">⌘/Ctrl+Enter to send</span>
          )}
        </span>
        <Button size="sm" onClick={submit} disabled={busy || !text.trim()}>
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          Send
        </Button>
      </div>
      )}
    </div>
  );

  if (variant === "card") {
    return (
      <div className="bg-white rounded-2xl border border-border p-5">
        <div className="flex items-center gap-2 mb-3">
          <Activity className="w-4 h-4 text-purple-600" />
          <h3 className="font-medium">Linear update</h3>
        </div>
        {composer}
      </div>
    );
  }

  // Floating: fixed lower-right pill that expands into a composer popover. The result lingers;
  // click-outside / Escape collapse it (handled above).
  return (
    <div className="fixed bottom-6 right-6 z-40">
      {open ? (
        <div ref={popoverRef} className="w-80 bg-white rounded-2xl border border-border shadow-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-purple-600" />
              <h3 className="font-medium text-sm">Linear update</h3>
            </div>
            <button onClick={close} className="text-gray-400 hover:text-gray-700" aria-label="Close"><X className="w-4 h-4" /></button>
          </div>
          {composer}
        </div>
      ) : (
        <button
          onClick={() => setOpen(true)}
          title="Drop a Linear update"
          aria-label="Drop a Linear update"
          className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-purple-600 text-white shadow-lg hover:bg-purple-700 transition-colors"
        >
          <Activity className="w-5 h-5" />
        </button>
      )}
    </div>
  );
}
