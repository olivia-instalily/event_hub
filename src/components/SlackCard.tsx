import { useState, type ReactNode } from "react";
import { Check, Pencil, X, ArrowUpRight, AlertTriangle, Trash2, CheckSquare, Square } from "lucide-react";
import { type CaptureHome } from "../lib/db";

// Category chip per home — shared by every Slack surface (event + series).
export const HOME_TAG: Record<CaptureHome, { label: string; cls: string }> = {
  person: { label: "Staffing", cls: "bg-blue-100 text-blue-700" },
  budget: { label: "Budget", cls: "bg-emerald-100 text-emerald-700" },
  open: { label: "Still open", cls: "bg-violet-100 text-violet-700" },
  plan: { label: "Plan", cls: "bg-gray-100 text-gray-600" },
};
// Lanes a capture can be moved to (reclassify home).
const HOME_MOVE: { home: CaptureHome; label: string }[] = [
  { home: "person", label: "Staffing" }, { home: "budget", label: "Budget" },
  { home: "open", label: "Still open" }, { home: "plan", label: "Plan" },
];

// A capture normalized to what the card renders — callers map SlackCapture / SeriesCapture /
// AssignedCapture into this common shape.
export type SlackCardModel = {
  id: string; home: CaptureHome; summary: string; detail: string | null;
  sourceRef: string | null; badge?: ReactNode; warning?: string | null;
};

// The single Slack card used by both the event Overview and the Series Overview. Only the handlers a
// surface supplies are rendered — checkbox, assign chips, keep/discard, resolve, edit, move.
// Layout: checkbox left · chip + badges + source arrow (top-right) · summary/detail · action row with
// edit/move on the left and keep/discard tight on the bottom-right.
export function SlackCard({
  model, tone = "violet", selected, onToggleSelect, onEdit, onMove, onKeep, onDiscard,
  assignTargets, onAssign, onResolve,
}: {
  model: SlackCardModel;
  tone?: "violet" | "emerald";
  selected?: boolean; onToggleSelect?: () => void;
  onEdit?: (summary: string, detail: string | null) => Promise<void>;
  onMove?: (home: CaptureHome) => Promise<void>;
  onKeep?: () => Promise<void>;
  onDiscard?: () => Promise<void>;
  assignTargets?: { id: string; name: string }[];
  onAssign?: (eventId: string) => Promise<void>;
  onResolve?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [summary, setSummary] = useState(model.summary);
  const [detail, setDetail] = useState(model.detail ?? "");
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<void>) => { setBusy(true); try { await fn(); } finally { setBusy(false); } };
  const saveEdit = () => run(async () => { await onEdit?.(summary.trim(), detail.trim() || null); setEditing(false); });
  const tag = HOME_TAG[model.home];
  const toneCls = tone === "emerald" ? "border-emerald-200 bg-emerald-50/40" : "border-violet-200 bg-violet-50/50";

  return (
    <div className={`rounded-lg border px-3 py-2.5 ${toneCls}`}>
      <div className="flex items-start gap-2">
        {onToggleSelect && (
          <button onClick={onToggleSelect} className="mt-0.5 shrink-0 text-gray-400 hover:text-violet-600" aria-label="Select">
            {selected ? <CheckSquare className="w-4 h-4 text-violet-600" /> : <Square className="w-4 h-4" />}
          </button>
        )}
        <div className="flex-1 min-w-0">
          {/* chip + badge + source arrow (top-right) */}
          <div className="mb-1 flex items-center gap-1.5">
            <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${tag.cls}`}>{tag.label}</span>
            {model.badge}
            {model.sourceRef && (
              <a href={model.sourceRef} target="_blank" rel="noreferrer" title="Open in Slack" className="ml-auto inline-flex items-center gap-0.5 text-[11px] text-violet-600 hover:text-violet-800">source <ArrowUpRight className="w-3 h-3" /></a>
            )}
          </div>

          {editing ? (
            <div className="space-y-1.5">
              <input value={summary} onChange={(e) => setSummary(e.target.value)} autoFocus
                className="w-full text-[14px] text-gray-900 border border-violet-300 rounded-md px-2 py-1 focus:outline-none focus:ring-1 focus:ring-violet-400" />
              <input value={detail} onChange={(e) => setDetail(e.target.value)} placeholder="detail (optional)"
                className="w-full text-[13px] text-gray-600 border border-gray-200 rounded-md px-2 py-1 focus:outline-none focus:ring-1 focus:ring-violet-400" />
              {/* Move-to lives inside edit now (no separate move button). */}
              {onMove && (
                <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                  <span className="text-[11px] text-gray-400">move to:</span>
                  {HOME_MOVE.filter((h) => h.home !== model.home).map((h) => (
                    <button key={h.home} onClick={() => run(async () => { await onMove(h.home); setEditing(false); })} disabled={busy}
                      className="rounded-full border border-gray-200 px-2.5 py-1 text-[12px] text-gray-700 hover:border-violet-300 hover:bg-violet-50 hover:text-violet-700 disabled:opacity-50">{h.label}</button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <p className="text-[14px] text-gray-900 leading-snug">{model.summary}{model.detail && <span className="text-gray-500"> — {model.detail}</span>}</p>
          )}

          {model.warning && !editing && (
            <p className="mt-1 flex items-center gap-1 text-[12px] text-amber-700"><AlertTriangle className="w-3 h-3 shrink-0" />{model.warning}</p>
          )}

          {/* assign-to (series-unrouted only) */}
          {!editing && assignTargets && onAssign && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] text-gray-400">assign to:</span>
              {assignTargets.map((t) => (
                <button key={t.id} disabled={busy} onClick={() => run(() => onAssign(t.id))}
                  className="rounded-full border border-gray-200 px-2.5 py-1 text-[12px] text-gray-700 hover:border-violet-300 hover:bg-violet-50 hover:text-violet-700 disabled:opacity-50">{t.name}</button>
              ))}
            </div>
          )}

          {/* action row: edit/move/resolve on the left, keep/discard tight on the bottom-right */}
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[13px]">
            {editing ? (
              <>
                <button onClick={saveEdit} disabled={busy} className="inline-flex items-center gap-1 rounded-md bg-violet-600 px-3 py-1.5 font-medium text-white hover:bg-violet-700 disabled:opacity-50"><Check className="w-3.5 h-3.5" /> {busy ? "saving…" : "save"}</button>
                <button onClick={() => { setEditing(false); setSummary(model.summary); setDetail(model.detail ?? ""); }} className="rounded-md px-2.5 py-1.5 text-gray-500 hover:bg-gray-100">cancel</button>
              </>
            ) : (
              <>
                {onResolve && <button onClick={onResolve} disabled={busy} className="inline-flex items-center gap-1 rounded-md bg-violet-600 px-3 py-1.5 font-medium text-white hover:bg-violet-700 disabled:opacity-50"><Check className="w-3.5 h-3.5" /> resolve</button>}
                {onEdit && <button onClick={() => setEditing(true)} disabled={busy} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-gray-600 hover:bg-gray-100 disabled:opacity-50"><Pencil className="w-3.5 h-3.5" /> edit</button>}
                {(onKeep || onDiscard) && (
                  <div className="ml-auto flex items-center gap-0.5 text-[11px]">
                    {onKeep && <button onClick={() => run(onKeep)} disabled={busy} title="Clear this card, keep what it added" className="rounded px-1.5 py-0.5 text-gray-500 hover:bg-gray-100 disabled:opacity-50">keep</button>}
                    {onDiscard && <button onClick={() => run(onDiscard)} disabled={busy} title="Discard (reverse what it added, then remove)" className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"><Trash2 className="w-3.5 h-3.5" /></button>}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Panel wrapper: optional select-all + bulk keep/discard header, then the caller-configured cards.
export function SlackCaptureList({ models, selected, onToggleAll, onBulkKeep, onBulkDiscard, card, emptyText }: {
  models: SlackCardModel[];
  selected: Set<string>; onToggleAll: (on: boolean) => void;
  onBulkKeep?: () => Promise<void>; onBulkDiscard?: () => Promise<void>;
  card: (m: SlackCardModel) => ReactNode; emptyText?: string;
}) {
  const [busy, setBusy] = useState(false);
  const run = async (fn?: () => Promise<void>) => { if (!fn) return; setBusy(true); try { await fn(); } finally { setBusy(false); } };
  if (models.length === 0) return emptyText ? <p className="text-[13px] text-gray-400 mt-2">{emptyText}</p> : null;
  const allOn = selected.size === models.length && models.length > 0;
  return (
    <>
      <div className="mt-2 flex items-center gap-2">
        <button onClick={() => onToggleAll(!allOn)} className="inline-flex items-center gap-1 text-[12px] text-gray-500 hover:text-gray-800">
          {allOn ? <CheckSquare className="w-4 h-4 text-violet-600" /> : <Square className="w-4 h-4" />} Select all
        </button>
        {selected.size > 0 && (onBulkKeep || onBulkDiscard) && (
          <div className="ml-auto flex items-center gap-1.5">
            {onBulkKeep && <button onClick={() => run(onBulkKeep)} disabled={busy} title="Clear the cards, keep what they added" className="inline-flex items-center gap-1 rounded-md border border-gray-200 px-2.5 py-1 text-[12px] text-gray-600 hover:bg-gray-50 disabled:opacity-50"><X className="w-3.5 h-3.5" /> Keep ({selected.size})</button>}
            {onBulkDiscard && <button onClick={() => run(onBulkDiscard)} disabled={busy} title="Discard the selected" className="inline-flex items-center gap-1 rounded-md border border-red-200 px-2.5 py-1 text-[12px] text-red-600 hover:bg-red-50 disabled:opacity-50"><Trash2 className="w-3.5 h-3.5" /> Discard ({selected.size})</button>}
          </div>
        )}
      </div>
      <ul className="mt-2 space-y-2">{models.map((m) => <li key={m.id}>{card(m)}</li>)}</ul>
    </>
  );
}
