import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Upload, X, AlertCircle, ArrowRight, Loader2, ClipboardPaste } from "lucide-react";
import {
  addBudgetLines, deleteBudgetLine, updateBudgetLine, classifyBudgetLines,
  type PlanningBudget, type BudgetLineTracker,
} from "../lib/db";
import { categoryKey } from "../lib/budgetCategories";

const money = (n: number | null, currency = "USD") =>
  n == null ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(n);

// ── Parsing ───────────────────────────────────────────────────────────────────
function splitRow(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === delim) { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function parseDelimited(text: string): string[][] {
  const rows = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (!rows.length) return [];
  const first = rows[0];
  // Pick the delimiter that splits the header into the most columns.
  const delim = [",", "\t", ";"].sort((a, b) => first.split(b).length - first.split(a).length)[0];
  return rows.map((r) => splitRow(r, delim));
}

function parseAmount(s: string): number | null {
  if (s == null) return null;
  const t = s.trim();
  if (!/[0-9]/.test(t)) return null;
  const neg = /^\(.*\)$/.test(t);
  const n = Number(t.replace(/[^0-9.]/g, ""));
  return Number.isNaN(n) ? null : (neg ? -n : n);
}

const isTotalLabel = (s: string) => /\b(total|subtotal|sum|grand\s*total)\b/i.test(s);

type Line = { label: string; amount: number | null };

/** One-shot budget parse (no UI): delimiter-detect, pick the amount column (most parseable
 *  numbers), label = first other column, skip header + total rows. Shared with the drop ingest
 *  so dropping a CSV anywhere parses it the same way as the import modal. */
export function parseBudgetText(text: string): Line[] {
  const grid = parseDelimited(text);
  if (grid.length === 0) return [];
  const cols = Math.max(...grid.map((r) => r.length));
  let amtCol = 1, best = -1;
  for (let c = 0; c < cols; c++) {
    const score = grid.filter((r) => parseAmount(r[c] ?? "") != null).length;
    if (score > best) { best = score; amtCol = c; }
  }
  const labelCol = amtCol === 0 ? 1 : 0;
  const hasHeader = parseAmount(grid[0][amtCol] ?? "") == null; // first row's amount cell isn't a number → header
  const body = hasHeader ? grid.slice(1) : grid;
  const out: Line[] = [];
  for (const r of body) {
    const label = (r[labelCol] ?? "").trim();
    const amount = parseAmount(r[amtCol] ?? "");
    if (!label && amount == null) continue;
    if (isTotalLabel(label)) continue;
    out.push({ label: label || "Untitled", amount });
  }
  return out;
}

// ── Click-to-choose control (explicit affordance; drag is handled by BudgetDropArea) ──
export function BudgetDropZone({ label, onFile, className }: { label: string; onFile: (f: File) => void; className?: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <button
      type="button"
      onClick={() => inputRef.current?.click()}
      className={`flex items-center justify-center gap-2 rounded-lg border border-dashed border-gray-300 px-3 py-2 text-sm text-gray-500 hover:bg-gray-50 transition-colors ${className ?? ""}`}
    >
      <Upload className="w-4 h-4" /> {label}
      <input ref={inputRef} type="file" accept=".csv,.tsv,.txt,text/csv,text/plain" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }} />
    </button>
  );
}

/** Paste-a-breakdown: opens a textarea, then funnels the pasted text through the same
 *  import pipeline as a dropped file (by wrapping it in a virtual .csv File). */
export function BudgetPasteButton({ onFile, className }: { onFile: (f: File) => void; className?: string }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const submit = () => {
    const t = text.trim();
    if (!t) return;
    onFile(new File([t], "Pasted breakdown.csv", { type: "text/csv" }));
    setOpen(false); setText("");
  };
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`flex items-center justify-center gap-2 rounded-lg border border-dashed border-gray-300 px-3 py-2 text-sm text-gray-500 hover:bg-gray-50 transition-colors ${className ?? ""}`}
      >
        <ClipboardPaste className="w-4 h-4" /> Paste a breakdown
      </button>
      {open && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={() => setOpen(false)}>
          <div className="bg-white rounded-2xl border border-black max-w-lg w-full p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-xl">Paste a budget breakdown</h2>
              <button onClick={() => setOpen(false)} className="p-1 text-gray-400 hover:text-gray-900" aria-label="Close"><X className="w-5 h-5" /></button>
            </div>
            <p className="text-sm text-gray-500 mb-3">Paste rows from a spreadsheet or a list — one category and amount per line (comma, tab, or semicolon separated).</p>
            <textarea
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={8}
              placeholder={"Venue, 5000\nCatering, 3200\nA/V, 1500"}
              className="w-full px-3 py-2 border border-black rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-gray-300"
            />
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setOpen(false)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900">Cancel</button>
              <button onClick={submit} disabled={!text.trim()} className="inline-flex items-center gap-1 px-4 py-2 bg-gray-900 text-white rounded-lg text-sm hover:bg-gray-800 disabled:opacity-50">Process <ArrowRight className="w-4 h-4" /></button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

/** Wraps a whole section so a file dropped anywhere inside it imports — the box tints
 *  light grey while a file is dragged over it. */
export function BudgetDropArea({ onFile, className, children }: { onFile: (f: File) => void; className?: string; children: ReactNode }) {
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes("Files");
  return (
    <div
      onDragEnter={(e) => { if (!hasFiles(e)) return; e.preventDefault(); depth.current++; setOver(true); }}
      onDragOver={(e) => { if (hasFiles(e)) e.preventDefault(); }}
      onDragLeave={() => { depth.current = Math.max(0, depth.current - 1); if (depth.current === 0) setOver(false); }}
      onDrop={(e) => { e.preventDefault(); depth.current = 0; setOver(false); const f = e.dataTransfer.files?.[0]; if (f) onFile(f); }}
      className={`relative ${className ?? ""}`}
    >
      {children}
      {over && (
        <div className="pointer-events-none absolute inset-0 rounded-2xl bg-gray-200/60 border-2 border-dashed border-gray-400 flex items-center justify-center z-10">
          <span className="text-sm text-gray-700 bg-white/90 px-3 py-1 rounded-full inline-flex items-center gap-1.5"><Upload className="w-4 h-4" /> Drop CSV to import budget</span>
        </div>
      )}
    </div>
  );
}

// ── Import modal: parse → map → review → confirm ────────────────────────────────
type Stage = "map" | "review" | "confirm";

export function BudgetImportModal({ budget, file, currency = "USD", onClose, onApplied, onConfirm }: {
  budget: PlanningBudget;
  file: File;
  currency?: string;
  onClose: () => void;
  onApplied: (note: string) => void;
  // When provided, confirming hands the reviewed lines back instead of writing them — the
  // caller decides how to apply (e.g. filling editable target fields by category).
  onConfirm?: (lines: { label: string; amount: number | null }[]) => Promise<string>;
}) {
  const [grid, setGrid] = useState<string[][] | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [hasHeader, setHasHeader] = useState(true);
  const [labelCol, setLabelCol] = useState(0);
  const [amountCol, setAmountCol] = useState(1);
  const [stage, setStage] = useState<Stage>("map");
  const [rows, setRows] = useState<Line[]>([]);
  const [mergeMode, setMergeMode] = useState<"append" | "replace">("append");
  const [busy, setBusy] = useState(false);
  const [confirmReplace, setConfirmReplace] = useState(false);

  const kind = classifyBudgetLines(budget.lines);

  // Read + parse the dropped file once.
  useEffect(() => {
    let cancelled = false;
    file.text().then((text) => {
      if (cancelled) return;
      const g = parseDelimited(text);
      if (g.length === 0) { setParseError("Couldn't read any rows from that file."); return; }
      setGrid(g);
      // Auto-guess columns: amount = column with the most parseable numbers; label = first other.
      const cols = Math.max(...g.map((r) => r.length));
      const body = g.slice(1); // skip likely header for guessing
      let bestAmt = 1, bestScore = -1;
      for (let c = 0; c < cols; c++) {
        const score = body.filter((r) => parseAmount(r[c] ?? "") != null).length;
        if (score > bestScore) { bestScore = score; bestAmt = c; }
      }
      setAmountCol(bestAmt);
      setLabelCol(bestAmt === 0 ? 1 : 0);
    }).catch((e) => { if (!cancelled) setParseError(e?.message ?? String(e)); });
    return () => { cancelled = true; };
  }, [file]);

  const colCount = grid ? Math.max(...grid.map((r) => r.length)) : 0;

  // Sanity check: a budget breakdown should have a column that's mostly amounts. If the
  // best amount column is sparse, the file probably isn't budget data — make the user
  // confirm before we fill their budget with gibberish.
  const [acknowledged, setAcknowledged] = useState(false);
  const bodyLen = grid ? (hasHeader ? Math.max(0, grid.length - 1) : grid.length) : 0;
  const amountMatches = useMemo(() => {
    if (!grid) return 0;
    const body = hasHeader ? grid.slice(1) : grid;
    return body.filter((r) => parseAmount(r[amountCol] ?? "") != null).length;
  }, [grid, amountCol, hasHeader]);
  const suspicious = grid != null && (bodyLen === 0 || amountMatches === 0 || amountMatches / bodyLen < 0.3);

  // Build review lines from the current mapping (excluding a detected total row).
  const buildRows = (): { lines: Line[]; declaredTotal: number | null } => {
    if (!grid) return { lines: [], declaredTotal: null };
    const body = hasHeader ? grid.slice(1) : grid;
    const lines: Line[] = [];
    let declaredTotal: number | null = null;
    for (const r of body) {
      const label = (r[labelCol] ?? "").trim();
      const amount = parseAmount(r[amountCol] ?? "");
      if (!label && amount == null) continue;
      if (isTotalLabel(label)) { if (amount != null) declaredTotal = amount; continue; }
      lines.push({ label: label || "Untitled", amount });
    }
    return { lines, declaredTotal };
  };

  const [declaredTotal, setDeclaredTotal] = useState<number | null>(null);
  const goReview = () => { const { lines, declaredTotal } = buildRows(); setRows(lines); setDeclaredTotal(declaredTotal); setStage("review"); };

  const sum = rows.reduce((s, l) => s + (l.amount ?? 0), 0);
  const mismatch = declaredTotal != null && Math.round(declaredTotal) !== Math.round(sum);

  // Append conflict resolution: dropped lines whose category matches an existing line (fuzzy).
  const existingByLabel = useMemo(() => {
    const m = new Map<string, BudgetLineTracker>();
    for (const l of budget.lines) if (l.label) m.set(categoryKey(l.label), l);
    return m;
  }, [budget.lines]);
  const conflicts = useMemo(
    () => rows.map((r, i) => ({ i, line: r, existing: existingByLabel.get(categoryKey(r.label)) })).filter((c) => c.existing),
    [rows, existingByLabel],
  );
  const [winners, setWinners] = useState<Record<number, "existing" | "dropped">>({});
  const winnerFor = (i: number) => winners[i] ?? "dropped";

  const apply = async () => {
    setBusy(true);
    try {
      const usable = rows.filter((l) => l.label.trim());
      // Caller-controlled apply (e.g. fill editable category fields by fuzzy match).
      if (onConfirm) { onApplied(await onConfirm(usable)); return; }
      let note = "";
      if (kind === "empty") {
        await addBudgetLines(budget.id, usable);
        note = `Added ${usable.length} budget line${usable.length === 1 ? "" : "s"}.`;
      } else if (kind === "projected") {
        await Promise.all(budget.lines.map((l) => deleteBudgetLine(l.id)));
        await addBudgetLines(budget.id, usable);
        note = `Replaced ${budget.lines.length} projected estimate${budget.lines.length === 1 ? "" : "s"}.`;
      } else if (mergeMode === "replace") {
        await Promise.all(budget.lines.map((l) => deleteBudgetLine(l.id)));
        await addBudgetLines(budget.id, usable);
        note = `Replaced the budget with ${usable.length} dropped line${usable.length === 1 ? "" : "s"}.`;
      } else {
        // Append: merge conflicts by chosen winner; add the rest.
        const conflictIdx = new Set(conflicts.map((c) => c.i));
        const toAdd = usable.filter((_, i) => !conflictIdx.has(i));
        await addBudgetLines(budget.id, toAdd);
        await Promise.all(
          conflicts
            .filter((c) => winnerFor(c.i) === "dropped")
            .map((c) => updateBudgetLine(c.existing!.id, { amount: c.line.amount })),
        );
        note = `Appended ${toAdd.length} line${toAdd.length === 1 ? "" : "s"}${conflicts.length ? `, merged ${conflicts.length}` : ""}.`;
      }
      onApplied(note);
    } catch (e: any) {
      setParseError(e?.message ?? String(e));
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl border border-black max-w-2xl w-full max-h-[85vh] overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-xl">Import budget breakdown</h2>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-900" aria-label="Close"><X className="w-5 h-5" /></button>
        </div>
        <p className="text-sm text-gray-400 mb-4 truncate">{file.name}</p>

        {parseError && <p className="text-red-600 text-sm mb-3 inline-flex items-center gap-1"><AlertCircle className="w-4 h-4" /> {parseError}</p>}
        {!grid && !parseError && <p className="text-sm text-gray-400">Reading file…</p>}

        {/* Sanity gate — file doesn't look like a budget */}
        {grid && suspicious && !acknowledged && (
          <div>
            <div className="text-sm bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-3 py-3 mb-4 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>This doesn't look like a budget breakdown — {amountMatches === 0 ? "no column of amounts was found" : `only ${amountMatches} of ${bodyLen} row${bodyLen === 1 ? "" : "s"} have an amount`}. Importing it could fill your budget with gibberish.</span>
            </div>
            <div className="flex justify-between">
              <button onClick={onClose} className="text-sm text-gray-600 hover:text-gray-900">Cancel</button>
              <button onClick={() => setAcknowledged(true)} className="inline-flex items-center gap-1 px-4 py-2 bg-gray-200 rounded-lg text-sm hover:bg-gray-300">Import anyway <ArrowRight className="w-4 h-4" /></button>
            </div>
          </div>
        )}

        {/* Step 1 — column mapping */}
        {grid && stage === "map" && (!suspicious || acknowledged) && (
          <div>
            <div className="flex flex-wrap items-center gap-4 mb-3 text-sm">
              <label className="inline-flex items-center gap-2">
                <span className="text-gray-600">Category column</span>
                <select value={labelCol} onChange={(e) => setLabelCol(Number(e.target.value))} className="px-2 py-1 border border-black rounded">
                  {Array.from({ length: colCount }, (_, c) => <option key={c} value={c}>Column {c + 1}</option>)}
                </select>
              </label>
              <label className="inline-flex items-center gap-2">
                <span className="text-gray-600">Amount column</span>
                <select value={amountCol} onChange={(e) => setAmountCol(Number(e.target.value))} className="px-2 py-1 border border-black rounded">
                  {Array.from({ length: colCount }, (_, c) => <option key={c} value={c}>Column {c + 1}</option>)}
                </select>
              </label>
              <label className="inline-flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={hasHeader} onChange={(e) => setHasHeader(e.target.checked)} />
                <span className="text-gray-600">First row is a header</span>
              </label>
            </div>
            <div className="rounded-lg border border-gray-200 overflow-x-auto">
              <table className="w-full text-sm">
                <tbody>
                  {grid.slice(0, 6).map((r, ri) => (
                    <tr key={ri} className={`border-t border-gray-100 ${hasHeader && ri === 0 ? "bg-gray-50 text-gray-400" : ""}`}>
                      {Array.from({ length: colCount }, (_, c) => (
                        <td key={c} className={`px-3 py-1.5 ${c === labelCol ? "font-medium" : c === amountCol ? "text-right" : "text-gray-400"}`}>{r[c] ?? ""}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex justify-end mt-4">
              <button onClick={goReview} className="inline-flex items-center gap-1 px-4 py-2 bg-gray-200 rounded-lg text-sm hover:bg-gray-300">Review <ArrowRight className="w-4 h-4" /></button>
            </div>
          </div>
        )}

        {/* Step 2 — review table */}
        {stage === "review" && (
          <div>
            {mismatch && (
              <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3 inline-flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" /> File total {money(declaredTotal, currency)} ≠ sum of lines {money(sum, currency)}.
              </p>
            )}
            <div className="rounded-lg border border-gray-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-500"><tr><th className="text-left px-3 py-2 font-normal">Category</th><th className="text-right px-3 py-2 font-normal">Amount</th><th className="w-8" /></tr></thead>
                <tbody>
                  {rows.length === 0 && <tr><td colSpan={3} className="px-3 py-3 text-gray-400">No lines parsed — go back and remap the columns.</td></tr>}
                  {rows.map((l, i) => (
                    <tr key={i} className="border-t border-gray-100">
                      <td className="px-3 py-1.5"><input value={l.label} onChange={(e) => setRows((p) => p.map((x, j) => j === i ? { ...x, label: e.target.value } : x))} className="w-full px-1 py-0.5 border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-gray-300" /></td>
                      <td className="px-3 py-1.5 text-right"><input type="number" value={l.amount ?? ""} onChange={(e) => setRows((p) => p.map((x, j) => j === i ? { ...x, amount: e.target.value === "" ? null : Number(e.target.value) } : x))} className="w-28 px-1 py-0.5 text-right border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-gray-300" /></td>
                      <td className="px-3 py-1.5 text-center"><button onClick={() => setRows((p) => p.filter((_, j) => j !== i))} className="text-gray-300 hover:text-red-600"><X className="w-4 h-4" /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-sm text-gray-500 mt-2 text-right">Total: {money(sum, currency)}</p>
            <div className="flex justify-between mt-4">
              <button onClick={() => setStage("map")} className="text-sm text-gray-600 hover:text-gray-900">← Back</button>
              <button onClick={() => setStage("confirm")} disabled={rows.length === 0} className="inline-flex items-center gap-1 px-4 py-2 bg-gray-200 rounded-lg text-sm hover:bg-gray-300 disabled:opacity-50">Continue <ArrowRight className="w-4 h-4" /></button>
            </div>
          </div>
        )}

        {/* Step 3 — confirm (branch by what's already there) */}
        {stage === "confirm" && (
          <div>
            {onConfirm && <p className="text-sm text-gray-600 mb-4">Fill {rows.length} categor{rows.length === 1 ? "y" : "ies"} into your budget — matching categories drop into their existing fields, the rest are added. Everything stays editable.</p>}
            {!onConfirm && kind === "empty" && <p className="text-sm text-gray-600 mb-4">Add {rows.length} line{rows.length === 1 ? "" : "s"} to this budget.</p>}
            {!onConfirm && kind === "projected" && <p className="text-sm text-gray-600 mb-4">This replaces {budget.lines.length} projected estimate{budget.lines.length === 1 ? "" : "s"} with your breakdown.</p>}

            {!onConfirm && kind === "real" && (
              <div className="mb-4">
                <p className="text-sm text-gray-600 mb-2">You've already entered budget data. How should the dropped lines be applied?</p>
                <div className="space-y-2">
                  <label className={`flex items-start gap-2 rounded-lg border p-3 cursor-pointer ${mergeMode === "append" ? "border-black ring-1 ring-black" : "border-gray-200"}`}>
                    <input type="radio" checked={mergeMode === "append"} onChange={() => setMergeMode("append")} className="mt-0.5" />
                    <span className="text-sm"><span className="font-medium">Append</span> — add the dropped lines alongside what's there{conflicts.length ? `, merging ${conflicts.length} matching categor${conflicts.length === 1 ? "y" : "ies"}.` : "."}</span>
                  </label>
                  <label className={`flex items-start gap-2 rounded-lg border p-3 cursor-pointer ${mergeMode === "replace" ? "border-black ring-1 ring-black" : "border-gray-200"}`}>
                    <input type="radio" checked={mergeMode === "replace"} onChange={() => setMergeMode("replace")} className="mt-0.5" />
                    <span className="text-sm"><span className="font-medium">Replace</span> — clear the existing budget and use the dropped file.</span>
                  </label>
                </div>

                {/* Append conflict resolution */}
                {mergeMode === "append" && conflicts.length > 0 && (
                  <div className="mt-3 rounded-lg border border-gray-200 divide-y divide-gray-100">
                    {conflicts.map((c) => (
                      <div key={c.i} className="px-3 py-2 text-sm flex items-center justify-between gap-3">
                        <span className="min-w-0 truncate">{c.line.label}</span>
                        <span className="flex items-center gap-1 shrink-0">
                          <button onClick={() => setWinners((w) => ({ ...w, [c.i]: "existing" }))} className={`px-2 py-0.5 rounded-full text-xs border ${winnerFor(c.i) === "existing" ? "bg-gray-900 text-white border-gray-900" : "border-gray-300 text-gray-600"}`}>keep {money(c.existing!.confirmedAmount, currency)}</button>
                          <button onClick={() => setWinners((w) => ({ ...w, [c.i]: "dropped" }))} className={`px-2 py-0.5 rounded-full text-xs border ${winnerFor(c.i) === "dropped" ? "bg-gray-900 text-white border-gray-900" : "border-gray-300 text-gray-600"}`}>use {money(c.line.amount, currency)}</button>
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Destructive warning — only for replace-over-real-data */}
                {mergeMode === "replace" && (
                  <label className="mt-3 flex items-start gap-2 text-sm bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2 cursor-pointer">
                    <input type="checkbox" checked={confirmReplace} onChange={(e) => setConfirmReplace(e.target.checked)} className="mt-0.5" />
                    <span><AlertCircle className="w-4 h-4 inline mr-1" />This will overwrite the budget you've already entered ({budget.lines.length} line{budget.lines.length === 1 ? "" : "s"}). Proceed?</span>
                  </label>
                )}
              </div>
            )}

            <div className="flex justify-between mt-2">
              <button onClick={() => setStage("review")} className="text-sm text-gray-600 hover:text-gray-900">← Back</button>
              <button
                onClick={apply}
                disabled={busy || (!onConfirm && kind === "real" && mergeMode === "replace" && !confirmReplace)}
                className="inline-flex items-center gap-1 px-4 py-2 bg-gray-900 text-white rounded-lg text-sm hover:bg-gray-800 disabled:opacity-50"
              >
                {busy && <Loader2 className="w-4 h-4 animate-spin" />}
                {onConfirm ? "Fill budget" : kind === "real" && mergeMode === "replace" ? "Overwrite budget" : kind === "real" ? "Append lines" : "Populate budget"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
