import { useState } from "react";
import { Check, Pencil, X, ArrowUpRight, AlertTriangle, Shuffle, CornerDownRight } from "lucide-react";
import { confirmSlackCapture, dismissSlackCapture, editSlackCapture, type SlackCapture, type CaptureHome } from "../lib/db";

// The lanes a capture can be moved to when the extraction guessed wrong (e.g. a vendor read as a
// person). Order mirrors the sections; label reads plainly in the menu.
const HOME_MOVE: { home: CaptureHome; label: string }[] = [
  { home: "person", label: "Staffing" },
  { home: "budget", label: "Budget" },
  { home: "open", label: "Still open" },
  { home: "plan", label: "Plan" },
];
// How each home reads as a category chip on the card.
const HOME_TAG: Record<CaptureHome, { label: string; cls: string }> = {
  person: { label: "Staffing", cls: "bg-blue-100 text-blue-700" },
  budget: { label: "Budget", cls: "bg-emerald-100 text-emerald-700" },
  open: { label: "Still open", cls: "bg-violet-100 text-violet-700" },
  plan: { label: "Plan", cls: "bg-gray-100 text-gray-600" },
};

// A single proposed Slack capture, engageable in place: confirm / edit / move / dismiss, with a link
// back to the source message and a category chip showing which lane it's in. Violet = from-Slack,
// not yet accepted. `onJump` (inbox only) makes the text click through to the section it affects.
export function SlackCaptureCard({ capture, onChange, onConfirm, onReclassify, onJump }: {
  capture: SlackCapture;
  onChange: () => void;
  onConfirm?: (capture: SlackCapture) => Promise<void>;
  onReclassify?: (capture: SlackCapture, home: CaptureHome) => Promise<void>;
  onJump?: (capture: SlackCapture) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [moving, setMoving] = useState(false);
  const [summary, setSummary] = useState(capture.summary);
  const [detail, setDetail] = useState(capture.detail ?? "");
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try { await fn(); onChange(); } catch { setBusy(false); }
    // On success the row is refetched away by onChange; no need to clear busy.
  };
  const saveEdit = () =>
    run(async () => { await editSlackCapture(capture.id, { summary: summary.trim(), detail: detail.trim() || null }); setEditing(false); });

  const conflict = (capture.flags as any)?.conflict;
  const ambiguity = (capture.flags as any)?.ambiguity as string | undefined;
  const tag = HOME_TAG[capture.home];

  return (
    <div className="rounded-lg border border-violet-200 bg-violet-50/50 px-3 py-2.5">
      <div className="flex items-start gap-2.5">
        <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-violet-500 shrink-0" title="Proposed from Slack" />
        <div className="flex-1 min-w-0">
          {/* Category chip — updates when the capture is moved to another lane. */}
          <div className="mb-1 flex items-center gap-1.5">
            <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${tag.cls}`}>{tag.label}</span>
            {onJump && <span className="text-[10px] text-gray-400">from Slack</span>}
          </div>

          {editing ? (
            <div className="space-y-1.5">
              <input value={summary} onChange={(e) => setSummary(e.target.value)} autoFocus
                className="w-full text-[14px] text-gray-900 border border-violet-300 rounded-md px-2 py-1 focus:outline-none focus:ring-1 focus:ring-violet-400" />
              <input value={detail} onChange={(e) => setDetail(e.target.value)} placeholder="detail (optional)"
                className="w-full text-[13px] text-gray-600 border border-gray-200 rounded-md px-2 py-1 focus:outline-none focus:ring-1 focus:ring-violet-400" />
            </div>
          ) : onJump ? (
            <button onClick={() => onJump(capture)} className="group text-left w-full" title="Jump to the section this affects">
              <span className="text-[14px] text-gray-900 leading-snug group-hover:underline">
                {capture.summary}{capture.detail && <span className="text-gray-500"> — {capture.detail}</span>}
              </span>
              <CornerDownRight className="inline-block w-3 h-3 ml-1 text-gray-300 group-hover:text-violet-500 align-middle" />
            </button>
          ) : (
            <p className="text-[14px] text-gray-900 leading-snug">
              {capture.summary}{capture.detail && <span className="text-gray-500"> — {capture.detail}</span>}
            </p>
          )}

          {(ambiguity || conflict) && !editing && (
            <p className="mt-1 flex items-center gap-1 text-[12px] text-amber-700">
              <AlertTriangle className="w-3 h-3 shrink-0" />
              {ambiguity ?? `conflicts with the set ${conflict?.field ?? "value"} — won't overwrite`}
            </p>
          )}

          {/* Actions — larger tap targets; confirm is the clear primary. */}
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[13px]">
            {editing ? (
              <>
                <button onClick={saveEdit} disabled={busy} className="inline-flex items-center gap-1 rounded-md bg-violet-600 px-3 py-1.5 font-medium text-white hover:bg-violet-700 disabled:opacity-50">
                  <Check className="w-3.5 h-3.5" /> {busy ? "saving…" : "save"}
                </button>
                <button onClick={() => { setEditing(false); setSummary(capture.summary); setDetail(capture.detail ?? ""); }} className="rounded-md px-2.5 py-1.5 text-gray-500 hover:bg-gray-100">cancel</button>
              </>
            ) : (
              <>
                <button onClick={() => run(() => (onConfirm ? onConfirm(capture) : confirmSlackCapture(capture.id)))} disabled={busy} className="inline-flex items-center gap-1 rounded-md bg-violet-600 px-3 py-1.5 font-medium text-white hover:bg-violet-700 disabled:opacity-50">
                  <Check className="w-3.5 h-3.5" /> {busy ? "confirming…" : "confirm"}
                </button>
                <button onClick={() => setEditing(true)} disabled={busy} className="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-gray-600 hover:bg-gray-100 disabled:opacity-50">
                  <Pencil className="w-3.5 h-3.5" /> edit
                </button>
                {onReclassify && (
                  <button onClick={() => setMoving((m) => !m)} disabled={busy} className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 hover:bg-gray-100 disabled:opacity-50 ${moving ? "bg-violet-100 text-violet-700" : "text-gray-600"}`}>
                    <Shuffle className="w-3.5 h-3.5" /> move
                  </button>
                )}
                <button onClick={() => run(() => dismissSlackCapture(capture.id))} disabled={busy} className="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-gray-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-50">
                  <X className="w-3.5 h-3.5" /> dismiss
                </button>
                {capture.sourceRef && (
                  <a href={capture.sourceRef} target="_blank" rel="noreferrer" className="ml-auto inline-flex items-center gap-0.5 text-violet-600 hover:text-violet-800">
                    source <ArrowUpRight className="w-3.5 h-3.5" />
                  </a>
                )}
              </>
            )}
          </div>

          {moving && onReclassify && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] text-gray-400">move to:</span>
              {HOME_MOVE.filter((h) => h.home !== capture.home).map((h) => (
                <button key={h.home} onClick={() => run(async () => { await onReclassify(capture, h.home); setMoving(false); })} disabled={busy}
                  className="rounded-full border border-gray-200 px-2.5 py-1 text-[12px] text-gray-700 hover:border-violet-300 hover:bg-violet-50 hover:text-violet-700 disabled:opacity-50">
                  {h.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
