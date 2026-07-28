import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Activity, X, Send, Loader2, ExternalLink, Check } from "lucide-react";
import {
  detectUpdate, setDeliverableStatus, setAllDeliverablesStatus, setEngagementStage, recordEventUpdate,
  syncEventToLinear, getDeliverableLinear, getDeliverableCounts, addDeliverable, getEventPlanning,
} from "../lib/db";

// A lower-right bubble that MORPHS (one continuous element) into a centered command window: type a
// natural-language Linear instruction for THIS event and it runs the update. Reuses the same engine
// as the inline "Linear update" card (detect-update triage → deliverable / vendor action → mirror to
// Linear). Writes are propose-then-confirm; reads (queries) run directly. Scoped to one event.

// A bulk "mark everything done" — applies to ALL deliverables. Needs a complete-ish verb AND an
// everything-ish scope so a single-task note isn't swept up.
function isBulkComplete(t: string): boolean {
  const s = t.toLowerCase();
  const done = /\b(complete[d]?|finish(ed)?|done|close[d]?|mark(ed)?\s+(as\s+)?(done|complete))\b/.test(s);
  const all = /\b(all|every(thing)?|each)\b/.test(s);
  return done && all;
}
// A read: "what's still open", "how many are left", "list the open tasks", …
function isQuery(t: string): boolean {
  return /\b(what('?s)?|which|how many|list|show|any)\b.*\b(open|left|remaining|outstanding|still|to-?dos?|pending|unfinished|not\s+done)\b/i.test(t)
    || /\bstill\b.*\bopen\b/i.test(t);
}
// A create: "add an issue for AV backup", "create a task to book the DJ", …
function isCreate(t: string): boolean {
  return /\b(add|create|open|make|new)\b.*\b(issue|ticket|task|deliverable|to-?do)\b/i.test(t);
}
// Best-effort title from a create instruction: prefer the clause after for/about/to/:, else strip the
// leading "add an issue …" scaffolding. The propose-then-confirm step lets the user cancel a bad guess.
function createTitle(t: string): string {
  const m = t.match(/\b(?:for|about|to|regarding|:)\s+(.+)$/i);
  let title = (m ? m[1] : t).trim();
  title = title.replace(/^\s*(?:add|create|open|make|new)\s+(?:an?\s+)?(?:issue|ticket|task|deliverable|to-?do)\s*(?:for|about|to|:)?\s*/i, "").trim();
  return title.replace(/^["'“”]|["'“”]$/g, "").trim();
}
// Pull a Linear identifier (e.g. "EVT-12") out of an issue url for a friendly link label.
function ticketLabel(url: string | null | undefined): string {
  const m = url?.match(/\/issue\/([A-Za-z0-9]+-\d+)/);
  return m ? m[1] : "ticket";
}

type Entry = { role: "cmd" | "result" | "error"; text: string; pre?: string; post?: string; url?: string | null; label?: string; list?: string[] };
type Pending = { text: string; run: () => Promise<Entry> };

export function LinearLauncher({ eventId, linearSynced = false, onApplied }: { eventId: string; linearSynced?: boolean; onApplied?: () => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<Entry[]>([]); // persists across close/reopen (component stays mounted)
  const [pending, setPending] = useState<Pending | null>(null);
  // Before the event has a Linear project, the launcher leads with a "Sync to Linear" area instead
  // of the free-text command surface (commands need a linked project to be meaningful).
  const [synced, setSynced] = useState(linearSynced);
  const [syncing, setSyncing] = useState(false);
  const [syncErr, setSyncErr] = useState<string | null>(null);
  useEffect(() => { setSynced(linearSynced); }, [linearSynced]);

  const reduced = useRef(typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  const push = (e: Entry) => setLog((l) => [...l, e]);
  const propose = (desc: string, run: () => Promise<Entry>) => setPending({ text: desc, run });

  // Focus the input once the shape has (mostly) formed on open; return focus to the bubble on close.
  useEffect(() => {
    if (open) { const t = setTimeout(() => inputRef.current?.focus(), reduced.current ? 0 : 160); return () => clearTimeout(t); }
    shellRef.current?.focus();
  }, [open]);
  // Escape closes (never close on outside click — easy to lose an in-progress command).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  useEffect(() => { logEndRef.current?.scrollIntoView({ behavior: reduced.current ? "auto" : "smooth" }); }, [log, pending]);

  const runQuery = async () => {
    const { total, open: openCount } = await getDeliverableCounts(eventId);
    if (openCount === 0) { push({ role: "result", text: `Nothing open — all ${total} deliverable${total === 1 ? "" : "s"} are done.` }); return; }
    let titles: string[] = [];
    try { const plan = await getEventPlanning(eventId); titles = (plan?.deliverables ?? []).filter((d) => d.status !== "Done").map((d) => d.title); } catch { /* count-only */ }
    push({ role: "result", text: `${openCount} of ${total} still open:`, list: titles.slice(0, 12) });
  };

  const submit = async () => {
    const t = text.trim();
    if (!t || busy || pending) return;
    push({ role: "cmd", text: t });
    setText("");
    setBusy(true);
    try {
      // 1. Query (read) — runs directly.
      if (isQuery(t)) { await runQuery(); return; }

      // 2. Create issue (write) — propose.
      if (isCreate(t)) {
        const title = createTitle(t) || "New task";
        propose(`Create a new deliverable “${title}”${linearSynced ? " and a matching Linear issue" : ""}?`, async () => {
          const d = await addDeliverable(eventId, { title, phase: "", ownerRole: null, dueDate: null });
          let url: string | null = null;
          if (linearSynced) { try { await syncEventToLinear(eventId); const dl = await getDeliverableLinear(d.id); url = dl?.linearIssueUrl ?? null; } catch { /* keep EventHub result */ } }
          await recordEventUpdate(eventId, { source: "linear", summary: `Created “${title}”`, detail: t, deliverableId: d.id });
          onApplied?.();
          return url ? { role: "result", text: "", pre: "Created ", url, label: ticketLabel(url), post: ` “${title}”` } : { role: "result", text: `Created “${title}”` };
        });
        return;
      }

      // 3. Bulk "mark everything done" (write) — propose.
      if (isBulkComplete(t)) {
        const { open: openCount } = await getDeliverableCounts(eventId);
        if (openCount === 0) { push({ role: "result", text: "All deliverables are already done — nothing to move." }); return; }
        propose(linearSynced
          ? `Mark all ${openCount} open deliverable${openCount === 1 ? "" : "s"} Done and move their Linear ticket${openCount === 1 ? "" : "s"} to completed?`
          : `Mark all ${openCount} open deliverable${openCount === 1 ? "" : "s"} Done?`, async () => {
          const n = await setAllDeliverablesStatus(eventId, "Done");
          let note = "";
          if (linearSynced) { try { const r = await syncEventToLinear(eventId); note = r?.synced != null ? ` · ${r.synced} ticket${r.synced === 1 ? "" : "s"} moved in Linear` : ""; } catch { note = " · couldn’t reach Linear — tickets not updated"; } }
          onApplied?.();
          return { role: "result", text: `Marked ${n} deliverable${n === 1 ? "" : "s"} Done${note}` };
        });
        return;
      }

      // 4. Status change / vendor contract / note — via the shared triage engine.
      const p = await detectUpdate(eventId, t, "linear", null);
      const targetStatus = p.kind === "complete" ? "Done" : p.kind === "status" ? (p.status || null) : null;
      if (targetStatus && p.deliverableId) {
        const name = p.matchedName ?? "task";
        propose(`Move “${name}” to ${targetStatus}${linearSynced ? " (and its Linear ticket)" : ""}?`, async () => {
          await setDeliverableStatus(p.deliverableId!, targetStatus);
          await recordEventUpdate(eventId, { source: "linear", summary: p.summary, detail: t, deliverableId: p.deliverableId });
          let url: string | null = null;
          if (linearSynced) { try { await syncEventToLinear(eventId); const d = await getDeliverableLinear(p.deliverableId!); url = d?.linearIssueUrl ?? null; } catch { /* keep EventHub result */ } }
          onApplied?.();
          return url ? { role: "result", text: "", pre: "Moved ", url, label: ticketLabel(url), post: ` “${name}” to ${targetStatus}` } : { role: "result", text: `Moved “${name}” to ${targetStatus}` };
        });
        return;
      }
      if (p.kind === "contract" && p.engagementId) {
        const name = p.matchedName ?? "vendor";
        propose(`Mark “${name}” as Contracted?`, async () => {
          await setEngagementStage(p.engagementId!, "Contracted", { note: t });
          await recordEventUpdate(eventId, { source: "linear", summary: p.summary, detail: t, engagementId: p.engagementId });
          if (linearSynced) void syncEventToLinear(eventId).catch(() => {});
          onApplied?.();
          return { role: "result", text: `Marked “${name}” Contracted` };
        });
        return;
      }
      // Nothing to mutate in Linear — record it as a note (low-risk), runs directly.
      await recordEventUpdate(eventId, { source: "linear", summary: p.summary, detail: t, engagementId: p.engagementId });
      onApplied?.();
      push({ role: "result", text: `Logged: ${p.summary || "update"}` });
    } catch (e: any) {
      push({ role: "error", text: e?.message ?? String(e) });
    } finally {
      setBusy(false);
    }
  };

  const confirmPending = async () => {
    if (!pending) return;
    setBusy(true);
    try { push(await pending.run()); }
    catch (e: any) { push({ role: "error", text: e?.message ?? String(e) }); }
    finally { setPending(null); setBusy(false); }
  };
  const cancelPending = () => { setPending(null); push({ role: "result", text: "Cancelled — nothing changed." }); };

  const syncNow = async () => {
    setSyncing(true); setSyncErr(null);
    try {
      const res = await syncEventToLinear(eventId);
      setSynced(true);
      push({ role: "result", text: `Synced ${res.synced} ${res.synced === 1 ? "issue" : "issues"} to Linear` });
      onApplied?.();
    } catch (e: any) { setSyncErr(e?.message ?? String(e)); }
    finally { setSyncing(false); }
  };

  // ── Morph shell ──────────────────────────────────────────────────────────
  // ONE element that transitions size / shape / position: corner circle ⇆ centered window. top/left are
  // set in BOTH states (auto isn't animatable) so the bubble visibly travels to the center.
  const resting: CSSProperties = { left: "calc(100vw - 72px)", top: "calc(100vh - 72px)", width: 52, height: 52, borderRadius: 9999, transform: "none", backgroundColor: "#7c3aed", border: "1px solid transparent", cursor: "pointer" };
  const opened: CSSProperties = { left: "50%", top: "50%", width: "min(560px, 94vw)", height: "min(320px, 80vh)", borderRadius: 16, transform: "translate(-50%, -50%)", backgroundColor: "#ffffff", border: "1px solid #e5e7eb", cursor: "default" };
  const ease = "cubic-bezier(.4,0,.2,1)";
  const morph = reduced.current ? "none"
    : `left .3s ${ease}, top .3s ${ease}, width .3s ${ease}, height .3s ${ease}, border-radius .3s ${ease}, transform .3s ${ease}, background-color .2s ${ease}, border-color .2s ${ease}`;

  return (
    <>
      {/* Visual-only backdrop (no close-on-click) so an in-progress command can't be lost by a stray click. */}
      {open && <div className="fixed inset-0 z-[90] bg-black/10" style={{ transition: reduced.current ? "none" : "opacity .3s" }} aria-hidden />}
      <div
        ref={shellRef}
        tabIndex={-1}
        role={open ? "dialog" : "button"}
        aria-label={open ? "Linear command window" : "Open Linear command launcher"}
        onClick={() => { if (!open) setOpen(true); }}
        className="fixed z-[95] overflow-hidden shadow-xl outline-none"
        style={{ ...(open ? opened : resting), transition: morph }}
      >
        {/* Resting icon — fades out fast as the shape opens. */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none" style={{ opacity: open ? 0 : 1, transition: reduced.current ? "none" : "opacity .18s" }}>
          <Activity className="w-5 h-5 text-white" />
        </div>

        {/* Command surface — fades in AFTER the shape forms (delay), so content doesn't reflow mid-morph. */}
        <div
          className="absolute inset-0 flex flex-col"
          style={{ opacity: open ? 1 : 0, pointerEvents: open ? "auto" : "none", transition: reduced.current ? "none" : (open ? "opacity .18s ease .14s" : "opacity .1s ease") }}
        >
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-border shrink-0">
            <div className="flex items-center gap-2"><Activity className="w-4 h-4 text-purple-600" /><h3 className="font-medium text-sm">Linear</h3></div>
            <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-700" aria-label="Close"><X className="w-4 h-4" /></button>
          </div>

          {/* Command log — a compact strip that appears only once there's history; capped so the
              instruction field stays the main surface. Scrolls to the latest entry. */}
          {!synced ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center px-6 gap-3">
              <Activity className="w-8 h-8 text-purple-600" />
              <p className="text-sm text-gray-700">This event isn’t linked to Linear yet.</p>
              <p className="text-[13px] text-gray-400">Sync to create its Linear project and push deliverables as issues — then run commands here.</p>
              <button onClick={syncNow} disabled={syncing} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-purple-600 text-white text-sm hover:bg-purple-700 disabled:opacity-50">
                {syncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Activity className="w-4 h-4" />} Sync to Linear
              </button>
              {syncErr && <p className="text-[13px] text-red-600">{syncErr}</p>}
            </div>
          ) : (
          <>
          {(log.length > 0 || pending) && (
            <div className="shrink-0 max-h-[45%] overflow-y-auto px-4 py-2.5 space-y-2 border-b border-border bg-gray-50/60">
              {log.map((e, i) => (
                e.role === "cmd" ? (
                  <div key={i} className="flex justify-end"><span className="max-w-[85%] rounded-2xl rounded-br-sm bg-gray-200 px-3 py-1.5 text-[13px] text-gray-800">{e.text}</span></div>
                ) : e.role === "error" ? (
                  <div key={i} className="text-[13px] text-red-600">{e.text}</div>
                ) : (
                  <div key={i} className="text-[13px] text-emerald-700 inline-flex flex-wrap items-center gap-1">
                    <Check className="w-3.5 h-3.5 shrink-0" />
                    {e.pre}
                    {e.url && e.label && (
                      <a href={e.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 font-medium underline decoration-dotted underline-offset-2 hover:text-emerald-900">{e.label}<ExternalLink className="w-3 h-3" /></a>
                    )}
                    {e.post ?? e.text}
                    {e.list && (
                      <ul className="w-full mt-1 space-y-0.5 pl-5 list-disc text-gray-700">{e.list.map((it, j) => <li key={j}>{it}</li>)}</ul>
                    )}
                  </div>
                )
              ))}
              {/* Propose-then-confirm for a write. */}
              {pending && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                  <p className="text-[13px] text-amber-900">{pending.text}</p>
                  <div className="flex items-center justify-end gap-2 mt-2">
                    <button onClick={cancelPending} disabled={busy} className="px-3 py-1.5 text-[13px] text-gray-600 hover:text-gray-900">Cancel</button>
                    <button onClick={confirmPending} disabled={busy} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-gray-900 text-white text-[13px] hover:bg-black disabled:opacity-50">
                      {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Confirm
                    </button>
                  </div>
                </div>
              )}
              <div ref={logEndRef} />
            </div>
          )}

          {/* Instruction field — fills the remaining body; send button floats in its corner. */}
          <div className="relative flex-1 p-3">
            <textarea
              ref={inputRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void submit(); } }}
              disabled={!!pending}
              placeholder={pending ? "Confirm or cancel above first…" : "Type a Linear instruction for this event — e.g. “mark the run-of-show deck done”, “add an issue for AV backup”, “what’s still open”. Enter to send, Shift+Enter for newline."}
              className="w-full h-full resize-none px-3 py-2 pb-11 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-300 disabled:bg-gray-50 disabled:text-gray-400"
            />
            <button onClick={() => void submit()} disabled={busy || !text.trim() || !!pending} className="absolute bottom-5 right-5 inline-flex items-center justify-center h-9 w-9 rounded-lg bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-40" aria-label="Send">
              {busy && !pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </button>
          </div>
          </>
          )}
        </div>
      </div>
    </>
  );
}
