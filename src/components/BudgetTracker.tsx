import { useEffect, useState, type ReactNode } from "react";
import { Plus, Trash2, ArrowUp, ArrowDown, Check, ExternalLink, GripVertical } from "lucide-react";
import { DndContext, PointerSensor, useSensor, useSensors, closestCorners, useDroppable, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, arrayMove, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  type PlanningBudget, type BudgetLineTracker, type BudgetStatus, type BudgetApproval,
  type VendorRow, type VendorSuggestion,
  BUDGET_STATUSES, getBudgetApproval, setBudgetTarget, setEventBudgetTarget,
  setBudgetCategories, addBudgetRow, updateBudgetRow, deleteBudgetLine,
  suggestVendors, resolveVendor, createVendor,
} from "../lib/db";
import { categoryHeader, budgetRollup, type BudgetCategory } from "../lib/budgetModel";
import { StatCard } from "./StatCard";
import { BudgetDropArea, BudgetImportModal } from "./BudgetImport";

function money(n: number | null | undefined, currency = "USD"): string {
  return n == null ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(n);
}

const STATUS_LABEL: Record<BudgetStatus, string> = { estimate: "Estimate", quoted: "Quoted", paid: "Paid" };
const HEADER_COLOR: Record<string, string> = {
  actual: "text-green-700", estimate: "text-gray-500", range: "text-amber-600", empty: "text-gray-300",
};
// Per-row status color — the left-edge dot on each row matches its status tile's color.
const STATUS_DOT: Record<BudgetStatus, string> = { estimate: "bg-gray-400", quoted: "bg-blue-400", paid: "bg-green-500" };
const newCatId = () => "cat-" + (globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2, 14));

// The single cost store for an event: optional categories (each with an optional estimate) grouping
// vendor rows, plus loose lines with no category. Category headers resolve via the ladder
// (categoryHeader); the top tiles roll up per-status across everything (budgetRollup).
export function BudgetTracker({ budget, eventId, eventBudgetTarget = null, location = null }: {
  budget: PlanningBudget; eventId: string; eventBudgetTarget?: number | null; location?: string | null;
}) {
  const cur = budget.currency;
  const [categories, setCategories] = useState<BudgetCategory[]>(
    [...budget.categories].sort((a, b) => a.order - b.order),
  );
  const [lines, setLines] = useState<BudgetLineTracker[]>(budget.lines);
  const [dropFile, setDropFile] = useState<File | null>(null);
  const [importNote, setImportNote] = useState<string | null>(null);

  // Target seeding: an assigned approval budget seeds the target when none is set yet.
  const [approval, setApproval] = useState<BudgetApproval | null>(null);
  useEffect(() => { void getBudgetApproval(eventId).then(setApproval); }, [eventId]);
  const assignedBudget = approval?.status === "assigned" ? eventBudgetTarget : null;
  const seedTarget = budget.targetAmount ?? assignedBudget;
  const [target, setTarget] = useState<number | null>(seedTarget);
  const [targetInput, setTargetInput] = useState(seedTarget != null ? String(seedTarget) : "");
  useEffect(() => {
    if (seedTarget == null) return;
    setTarget((c) => (c == null ? seedTarget : c));
    setTargetInput((c) => (c === "" ? String(seedTarget) : c));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedTarget]);
  useEffect(() => {
    if (budget.targetAmount == null && assignedBudget != null) void setBudgetTarget(budget.id, assignedBudget);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignedBudget, budget.targetAmount, budget.id]);

  // ── row helpers ────────────────────────────────────────────────────────────
  const rowsIn = (cid: string | null) =>
    lines.filter((l) => l.categoryId === cid).sort((a, b) => (a.sortOrder ?? 1e9) - (b.sortOrder ?? 1e9));
  const patchRow = (id: string, f: Partial<BudgetLineTracker>) =>
    setLines((p) => p.map((l) => (l.id === id ? { ...l, ...f } : l)));
  const editRow = async (id: string, f: Partial<BudgetLineTracker>) => {
    patchRow(id, f);
    await updateBudgetRow(id, {
      ...(f.label !== undefined ? { label: f.label ?? "" } : {}),
      ...(f.confirmedAmount !== undefined ? { amount: f.confirmedAmount } : {}),
      ...(f.status !== undefined ? { status: f.status } : {}),
      ...(f.categoryId !== undefined ? { categoryId: f.categoryId } : {}),
      ...(f.vendorId !== undefined ? { vendorId: f.vendorId } : {}),
      ...(f.vendorName !== undefined ? { vendorName: f.vendorName } : {}),
      ...(f.docUrl !== undefined ? { link: f.docUrl } : {}),
    }).catch(() => {});
  };
  const addRow = async (categoryId: string | null) => {
    const nextOrder = Math.max(0, ...rowsIn(categoryId).map((l) => (l.sortOrder ?? 0) + 1));
    const row = await addBudgetRow(budget.id, { label: "", amount: null, status: "estimate", categoryId, sortOrder: nextOrder });
    setLines((p) => [...p, row]);
  };
  const removeRow = async (id: string) => {
    setLines((p) => p.filter((l) => l.id !== id));
    await deleteBudgetLine(id).catch(() => {});
  };

  // ── category helpers ───────────────────────────────────────────────────────
  const persistCats = async (next: BudgetCategory[]) => { setCategories(next); await setBudgetCategories(budget.id, next).catch(() => {}); };
  const addCategory = () => persistCats([...categories, { id: newCatId(), name: "New category", estimate: null, order: categories.length }]);
  const editCategory = (id: string, f: Partial<BudgetCategory>) => persistCats(categories.map((c) => (c.id === id ? { ...c, ...f } : c)));
  const removeCategory = async (id: string) => {
    // Never orphan rows: reassign this category's rows to loose (no category) first.
    const toLoose = rowsIn(id);
    for (const r of toLoose) await editRow(r.id, { categoryId: null });
    await persistCats(categories.filter((c) => c.id !== id));
  };

  // ── target ─────────────────────────────────────────────────────────────────
  const saveTarget = async (v: string) => {
    const n = v.trim() === "" ? null : Number(v);
    setTarget(n);
    await setBudgetTarget(budget.id, n).catch(() => {});
    await setEventBudgetTarget(eventId, n).catch(() => {});
  };

  // ── drag: reorder categories, and reorder/move rows across groups ────────────
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const onDragEnd = async (e: DragEndEvent) => {
    const activeId = String(e.active.id);
    const overId = e.over ? String(e.over.id) : null;
    if (!overId || activeId === overId) return;

    // Category reorder → reassign order, persist.
    if (activeId.startsWith("cat:") && overId.startsWith("cat:")) {
      const from = categories.findIndex((c) => "cat:" + c.id === activeId);
      const to = categories.findIndex((c) => "cat:" + c.id === overId);
      if (from < 0 || to < 0) return;
      await persistCats(arrayMove(categories, from, to).map((c, i) => ({ ...c, order: i })));
      return;
    }

    // Row move/reorder. Resolve the target group (category id, or null for loose) from what we're over.
    if (!activeId.startsWith("row:")) return;
    const rowId = activeId.slice(4);
    const active = lines.find((l) => l.id === rowId);
    if (!active) return;
    let targetCat: string | null;
    if (overId.startsWith("group:")) targetCat = overId.slice(6) === "loose" ? null : overId.slice(6);
    else if (overId.startsWith("cat:")) targetCat = overId.slice(4);
    else if (overId.startsWith("row:")) targetCat = lines.find((l) => l.id === overId.slice(4))?.categoryId ?? active.categoryId;
    else return;

    const targetRows = lines.filter((l) => l.categoryId === targetCat && l.id !== rowId)
      .sort((a, b) => (a.sortOrder ?? 1e9) - (b.sortOrder ?? 1e9));
    let insertAt = targetRows.length;
    if (overId.startsWith("row:")) {
      const idx = targetRows.findIndex((l) => l.id === overId.slice(4));
      if (idx >= 0) insertAt = idx;
    }
    const orderedIds = targetRows.map((l) => l.id);
    orderedIds.splice(insertAt, 0, rowId);

    // Optimistic: active row joins the target group; every row in that group gets its new index.
    setLines((prev) => prev.map((l) => {
      const oi = orderedIds.indexOf(l.id);
      if (l.id === rowId) return { ...l, categoryId: targetCat, sortOrder: oi };
      return oi >= 0 ? { ...l, sortOrder: oi } : l;
    }));
    await updateBudgetRow(rowId, { categoryId: targetCat, sortOrder: orderedIds.indexOf(rowId) }).catch(() => {});
    for (const id of orderedIds) {
      if (id === rowId) continue;
      await updateBudgetRow(id, { sortOrder: orderedIds.indexOf(id) }).catch(() => {});
    }
  };

  // ── rollup / tiles ─────────────────────────────────────────────────────────
  const roll = budgetRollup(lines.map((l) => ({ status: l.status, amount: l.confirmedAmount })));
  const total = roll.estimate + roll.quoted + roll.paid;
  const overTarget = target != null && total > target;
  const varState: "none" | "under" | "near" | "over" =
    target == null ? "none" : total >= target * 1.1 ? "over" : total >= target * 0.9 ? "near" : "under";
  const varText = { none: "text-gray-300", under: "text-green-600", near: "text-yellow-600", over: "text-red-500" }[varState];

  const empty = categories.length === 0 && lines.length === 0;

  return (
    <BudgetDropArea onFile={setDropFile} className="bg-white rounded-2xl border border-border p-6">
      {importNote && <p className="text-[15px] text-gray-500 inline-flex items-center gap-1 mb-3"><Check className="w-3.5 h-3.5 text-green-600" /> {importNote}</p>}

      {/* Status tiles + vs-target. Lighter rings so the color reads as a hint, not a warning. */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-3">
        <StatCard label="Estimate" value={money(roll.estimate, cur)} accent="ring-gray-200" />
        <StatCard label="Quoted" value={money(roll.quoted, cur)} accent="ring-blue-200" />
        <StatCard label="Paid" value={money(roll.paid, cur)} accent="ring-green-200" />
        <StatCard
          label="vs target"
          value={target == null ? <span className="text-gray-300">—</span> : money(total, cur)}
          sub={target != null && (
            <span className={`inline-flex items-center gap-0.5 ${varText}`}>
              {overTarget ? <ArrowUp className="w-3.5 h-3.5" /> : <ArrowDown className="w-3.5 h-3.5" />}
              {money(Math.abs(target - total), cur)} {overTarget ? "over" : "under"}
            </span>
          )}
        />
      </div>

      {/* Target — its own field (kept separate from the tiles, as before). */}
      <div id="budget-target-field" className="flex items-center justify-end gap-2 text-sm mb-5">
        <span className="text-gray-500">Target</span>
        <input
          type="number"
          value={targetInput}
          onChange={(e) => setTargetInput(e.target.value)}
          onBlur={(e) => saveTarget(e.target.value)}
          placeholder="—"
          className="w-28 text-right border border-border rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-gray-300"
        />
        {target != null && (
          <span className={total > target ? "text-red-600" : "text-gray-500"}>
            {total > target ? `${money(total - target, cur)} over` : `${money(target - total, cur)} left`}
          </span>
        )}
      </div>

      {empty && (
        <p className="text-sm text-gray-400 mb-4">No budget yet. Add a category or a loose line below, or drop a breakdown (CSV) to import lines.</p>
      )}

      {/* Categories + loose lines — one DndContext so rows can be dragged between groups and
          categories reordered. */}
      <DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={onDragEnd}>
        <SortableContext items={categories.map((c) => "cat:" + c.id)} strategy={verticalListSortingStrategy}>
          <div className="space-y-4">
            {categories.map((cat) => {
              const rows = rowsIn(cat.id);
              const h = categoryHeader(rows.map((l) => ({ status: l.status, amount: l.confirmedAmount })));
              const headerText =
                h.kind === "empty" ? "—"
                : h.kind === "range" ? (h.value === h.rangeHigh ? money(h.value, cur) : `${money(h.value, cur)}–${money(h.rangeHigh, cur)}`)
                : money(h.value, cur);
              // Estimate is a goal — when there's an actual, show it measured against the est (mini vs-target).
              const vsEst = cat.estimate != null && h.kind === "actual" && h.value != null ? h.value - cat.estimate : null;
              return (
                <SortableCat key={cat.id} id={"cat:" + cat.id}>
                  {(handle) => (
                    <div className="rounded-xl border border-gray-200">
                      {/* Category header */}
                      <div className="flex items-center gap-3 px-4 py-2.5 bg-gray-50 rounded-t-xl">
                        <button {...handle} className="cursor-grab active:cursor-grabbing text-gray-300 hover:text-gray-500 shrink-0" title="Drag to reorder"><GripVertical className="w-4 h-4" /></button>
                        <input
                          value={cat.name}
                          onChange={(e) => setCategories((p) => p.map((c) => (c.id === cat.id ? { ...c, name: e.target.value } : c)))}
                          onBlur={(e) => editCategory(cat.id, { name: e.target.value.trim() || "Category" })}
                          className="flex-1 min-w-0 bg-transparent font-medium text-gray-900 focus:outline-none"
                        />
                        {/* Estimate = the goal for this category. Always an editable "est ___"; the
                            actual number to its right is measured against it (mini vs-target). */}
                        <span className="inline-flex items-center gap-1.5 text-sm text-gray-400">
                          est
                          <input
                            key={`${cat.id}-est`}
                            type="number"
                            defaultValue={cat.estimate ?? ""}
                            onBlur={(e) => editCategory(cat.id, { estimate: e.target.value.trim() === "" ? null : Number(e.target.value) })}
                            placeholder="—"
                            className="w-20 text-right border border-gray-200 rounded px-1 py-0.5 focus:outline-none focus:ring-2 focus:ring-gray-300"
                          />
                        </span>
                        <span className={`text-sm font-semibold tabular-nums ${HEADER_COLOR[h.kind]}`}>
                          {headerText}
                          {h.pendingCount > 0 && <span className="ml-1 font-normal text-amber-600">· +{h.pendingCount} still quoting</span>}
                        </span>
                        {vsEst != null && (
                          <span className={`text-[13px] shrink-0 ${vsEst > 0 ? "text-red-600" : vsEst < 0 ? "text-green-600" : "text-gray-400"}`}>
                            {vsEst > 0 ? `${money(vsEst, cur)} over est` : vsEst < 0 ? `${money(-vsEst, cur)} under est` : "on est"}
                          </span>
                        )}
                        <button onClick={() => removeCategory(cat.id)} title="Remove category (rows move to loose)" className="text-gray-300 hover:text-red-500 shrink-0"><Trash2 className="w-4 h-4" /></button>
                      </div>
                      {/* Rows */}
                      <GroupDroppable id={"group:" + cat.id}>
                        <SortableContext items={rows.map((l) => "row:" + l.id)} strategy={verticalListSortingStrategy}>
                          <div className="divide-y divide-gray-100 min-h-[10px]">
                            {rows.map((l) => <SortableRow key={l.id} line={l} cur={cur} category={cat.name} location={location} onEdit={editRow} onRemove={removeRow} />)}
                          </div>
                        </SortableContext>
                      </GroupDroppable>
                      <button onClick={() => addRow(cat.id)} className="w-full text-left px-4 py-2 text-[13px] text-gray-500 hover:text-gray-900 inline-flex items-center gap-1"><Plus className="w-3.5 h-3.5" /> add vendor row</button>
                    </div>
                  )}
                </SortableCat>
              );
            })}
          </div>
        </SortableContext>

        {/* Loose lines */}
        {(rowsIn(null).length > 0 || categories.length > 0) && (
          <div className="mt-5">
            <p className="text-[13px] font-medium text-gray-400 mb-1.5">Loose lines</p>
            <GroupDroppable id="group:loose">
              <div className="rounded-xl border border-gray-200 divide-y divide-gray-100">
                <SortableContext items={rowsIn(null).map((l) => "row:" + l.id)} strategy={verticalListSortingStrategy}>
                  {rowsIn(null).map((l) => <SortableRow key={l.id} line={l} cur={cur} category={null} location={location} onEdit={editRow} onRemove={removeRow} />)}
                </SortableContext>
                <button onClick={() => addRow(null)} className="w-full text-left px-4 py-2 text-[13px] text-gray-500 hover:text-gray-900 inline-flex items-center gap-1"><Plus className="w-3.5 h-3.5" /> add line</button>
              </div>
            </GroupDroppable>
          </div>
        )}
      </DndContext>

      <div className="mt-4 flex items-center gap-4">
        <button onClick={addCategory} className="text-[13px] text-gray-600 hover:text-gray-900 inline-flex items-center gap-1"><Plus className="w-3.5 h-3.5" /> add category</button>
        <span className="text-[13px] text-gray-300">or drop a breakdown (CSV) to import loose lines</span>
      </div>

      {dropFile && (
        <BudgetImportModal
          budget={{ ...budget, lines }}
          currency={cur}
          file={dropFile}
          onClose={() => setDropFile(null)}
          onApplied={(note) => { setImportNote(note); setDropFile(null); void refreshLooseFromDb(); }}
        />
      )}
    </BudgetDropArea>
  );

  // Imported lines are written by BudgetImportModal directly; re-read them (they land loose).
  async function refreshLooseFromDb() {
    const { listBudgetLines } = await import("../lib/db");
    setLines(await listBudgetLines(budget.id).catch(() => lines));
  }
}

// One budget row: label · optional vendor · status · optional link · amount. The vendor field feeds
// the global directory (autocomplete + near-match dedup) via VendorField.
function Row({ line, cur, category, location, onEdit, onRemove, dragHandle }: {
  line: BudgetLineTracker; cur: string; category: string | null; location: string | null;
  onEdit: (id: string, f: Partial<BudgetLineTracker>) => void; onRemove: (id: string) => void;
  dragHandle?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-2">
      {dragHandle}
      {/* Status dot — same color as the status tile (green paid · blue quoted · gray estimate). */}
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${STATUS_DOT[line.status]}`} title={STATUS_LABEL[line.status]} />
      <input
        defaultValue={line.label ?? ""}
        onBlur={(e) => e.target.value !== (line.label ?? "") && onEdit(line.id, { label: e.target.value })}
        placeholder="What is it?"
        className="basis-40 shrink min-w-0 bg-transparent text-sm text-gray-800 focus:outline-none"
      />
      <VendorField line={line} category={category} location={location} onEdit={onEdit} />
      <select
        value={line.status}
        onChange={(e) => onEdit(line.id, { status: e.target.value as BudgetStatus })}
        className="text-[13px] border border-gray-200 rounded px-1.5 py-1 text-gray-600 focus:outline-none focus:ring-2 focus:ring-gray-300"
      >
        {BUDGET_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
      </select>
      <div className="flex items-center gap-1 w-28">
        <input
          defaultValue={line.docUrl ?? ""}
          onBlur={(e) => e.target.value !== (line.docUrl ?? "") && onEdit(line.id, { docUrl: e.target.value.trim() || null })}
          placeholder="link"
          className="flex-1 min-w-0 bg-transparent text-[13px] text-blue-600 focus:outline-none truncate"
        />
        {line.docUrl && (
          <a href={line.docUrl} target="_blank" rel="noreferrer" title="Open link" className="text-blue-500 hover:text-blue-700 shrink-0"><ExternalLink className="w-3.5 h-3.5" /></a>
        )}
      </div>
      <input
        type="number"
        defaultValue={line.confirmedAmount ?? ""}
        onBlur={(e) => { const v = e.target.value.trim() === "" ? null : Number(e.target.value); if (v !== line.confirmedAmount) onEdit(line.id, { confirmedAmount: v }); }}
        placeholder={money(0, cur)}
        className="w-16 shrink-0 text-right text-sm border border-gray-200 rounded px-1.5 py-1 focus:outline-none focus:ring-2 focus:ring-gray-300"
      />
      <button onClick={() => onRemove(line.id)} title="Remove" className="text-gray-300 hover:text-red-500 shrink-0"><Trash2 className="w-4 h-4" /></button>
    </div>
  );
}

// Vendor field for a row: a text input backed by directory suggestions (datalist). On commit it
// resolves the typed name against the directory — exact match links silently, a near match prompts
// ("use one, or create new?"), no match creates a new directory vendor. Only rows with a vendor feed
// the directory; clearing it unlinks.
function VendorField({ line, category, location, onEdit }: {
  line: BudgetLineTracker; category: string | null; location: string | null;
  onEdit: (id: string, f: Partial<BudgetLineTracker>) => void;
}) {
  const [name, setName] = useState(line.vendorName ?? "");
  const [near, setNear] = useState<VendorRow[] | null>(null);
  const [suggestions, setSuggestions] = useState<VendorSuggestion[]>([]);
  useEffect(() => { void suggestVendors(category, location).then(setSuggestions).catch(() => {}); }, [category, location]);
  const listId = `vend-sugg-${line.id}`;

  const commit = async () => {
    const n = name.trim();
    if (n === (line.vendorName ?? "")) return;
    if (!n) { onEdit(line.id, { vendorId: null, vendorName: null }); return; }
    const res = await resolveVendor(n);
    if (res.kind === "exact") { setName(res.name); onEdit(line.id, { vendorId: res.id, vendorName: res.name }); }
    else if (res.kind === "near") { setNear(res.matches); onEdit(line.id, { vendorName: n }); } // await the user's choice
    else { const v = await createVendor(n, category); onEdit(line.id, { vendorId: v.id, vendorName: v.name }); }
  };
  const useExisting = (v: VendorRow) => { setName(v.name ?? ""); setNear(null); onEdit(line.id, { vendorId: v.id, vendorName: v.name ?? name }); };
  const createNew = async () => { const v = await createVendor(name.trim(), category); setNear(null); onEdit(line.id, { vendorId: v.id, vendorName: v.name }); };

  return (
    <div className="relative flex-1 min-w-0">
      <input
        value={name}
        list={listId}
        onChange={(e) => setName(e.target.value)}
        onBlur={commit}
        placeholder="vendor (optional)"
        className="w-full bg-transparent text-[13px] text-gray-500 focus:outline-none"
      />
      <datalist id={listId}>
        {suggestions.map((s, i) => <option key={i} value={s.name} />)}
      </datalist>
      {near && (
        <div className="absolute z-20 left-0 top-full mt-1 w-56 rounded-lg border border-amber-200 bg-white shadow-lg p-2 text-[13px]">
          <p className="text-amber-700 mb-1">“{name.trim()}” looks similar to:</p>
          {near.map((v) => (
            <button key={v.id} onClick={() => useExisting(v)} className="block w-full text-left px-2 py-1 rounded hover:bg-amber-50 text-gray-700">{v.name}</button>
          ))}
          <button onClick={createNew} className="block w-full text-left px-2 py-1 rounded hover:bg-gray-50 text-gray-500 mt-0.5 border-t border-gray-100">Create new “{name.trim()}”</button>
        </div>
      )}
    </div>
  );
}

// ── drag primitives (dnd-kit) ────────────────────────────────────────────────
// A sortable category card. Passes its drag-handle props to the render child so only the grip
// starts a drag (the header's inputs stay editable).
function SortableCat({ id, children }: { id: string; children: (handle: Record<string, any>) => ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1, zIndex: isDragging ? 10 : undefined };
  return <div ref={setNodeRef} style={style}>{children({ ...listeners, ...attributes })}</div>;
}

// A sortable budget row — the grip handle starts the drag; the row's fields stay editable.
function SortableRow(props: {
  line: BudgetLineTracker; cur: string; category: string | null; location: string | null;
  onEdit: (id: string, f: Partial<BudgetLineTracker>) => void; onRemove: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: "row:" + props.line.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 };
  return (
    <div ref={setNodeRef} style={style}>
      <Row {...props} dragHandle={
        <button {...listeners} {...attributes} className="cursor-grab active:cursor-grabbing text-gray-200 hover:text-gray-500 shrink-0" title="Drag"><GripVertical className="w-3.5 h-3.5" /></button>
      } />
    </div>
  );
}

// A drop target for a group (a category body, or the loose group) so a row can be dropped into an
// empty group, not only onto another row.
function GroupDroppable({ id, children }: { id: string; children: ReactNode }) {
  const { setNodeRef } = useDroppable({ id });
  return <div ref={setNodeRef}>{children}</div>;
}
