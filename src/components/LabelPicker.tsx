import { useEffect, useState } from "react";
import { X, Plus } from "lucide-react";
import { listLabels, createLabel, addLabel, removeLabel, type Label, type LabelScope } from "../lib/db";

/** Assigned labels as removable chips + an add/create dropdown. Self-contained. */
export function LabelPicker({
  scope,
  itemId,
  initialLabelIds,
  onChange,
}: {
  scope: LabelScope;
  itemId: string;
  initialLabelIds: string[];
  onChange?: (labelIds: string[]) => void;
}) {
  const [all, setAll] = useState<Label[]>([]);
  const [ids, setIds] = useState<string[]>(initialLabelIds);
  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState("");

  useEffect(() => { listLabels(scope).then(setAll).catch(() => {}); }, [scope]);
  useEffect(() => { setIds(initialLabelIds); }, [itemId]); // eslint-disable-line react-hooks/exhaustive-deps

  const assigned = all.filter((l) => ids.includes(l.id));
  const available = all.filter((l) => !ids.includes(l.id));

  const add = async (labelId: string) => {
    const prev = ids;
    const next = [...ids, labelId];
    setIds(next);
    onChange?.(next);
    setOpen(false);
    try { await addLabel(scope, itemId, labelId); } catch { setIds(prev); onChange?.(prev); }
  };
  const remove = async (labelId: string) => {
    const prev = ids;
    const next = ids.filter((x) => x !== labelId);
    setIds(next);
    onChange?.(next);
    try { await removeLabel(scope, itemId, labelId); } catch { setIds(prev); onChange?.(prev); }
  };
  const create = async () => {
    const name = newName.trim();
    if (!name) return;
    const lbl = await createLabel(name, scope);
    setAll((p) => [...p, lbl]);
    setNewName("");
    await add(lbl.id);
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {assigned.map((l) => (
        <span key={l.id} className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[15px] bg-gray-100 text-gray-700">
          {l.name}
          <button onClick={() => remove(l.id)} className="text-gray-400 hover:text-gray-700" aria-label={`Remove ${l.name}`}>
            <X className="w-3 h-3" />
          </button>
        </span>
      ))}
      <div className="relative">
        <button
          onClick={() => setOpen((o) => !o)}
          className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[15px] border border-dashed border-gray-300 text-gray-500 hover:bg-gray-50"
        >
          <Plus className="w-3 h-3" /> Label
        </button>
        {open && (
          <div className="absolute z-20 mt-1 w-52 bg-white border border-border rounded-lg shadow-lg p-2">
            {available.map((l) => (
              <button key={l.id} onClick={() => add(l.id)} className="block w-full text-left px-2 py-1 text-sm hover:bg-gray-50 rounded">
                {l.name}
              </button>
            ))}
            {available.length === 0 && <p className="px-2 py-1 text-[15px] text-gray-400">No more labels</p>}
            <div className="flex items-center gap-1 mt-1 pt-1 border-t border-gray-100">
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") create(); }}
                placeholder="New label"
                className="flex-1 min-w-0 px-2 py-1 text-sm border border-border rounded focus:outline-none focus:ring-2 focus:ring-gray-300"
              />
              <button onClick={create} className="shrink-0 px-2 py-1 text-sm bg-gray-200 rounded hover:bg-gray-300">Add</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
