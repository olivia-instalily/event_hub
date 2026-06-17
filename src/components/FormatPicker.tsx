import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Plus, Check, X, Trash2 } from "lucide-react";
import { listFormats, addFormat, removeFormat } from "../lib/db";

// Formats are stored in the single `format` text column as a comma-joined list, so an event
// can carry several at once without a schema change. These convert to/from that storage.
export const parseFormats = (s: string | null | undefined): string[] =>
  (s ?? "").split(",").map((x) => x.trim()).filter(Boolean);
export const joinFormats = (arr: string[]): string | null => (arr.length ? arr.join(", ") : null);

type Pos = { left: number; top?: number; bottom?: number; maxHeight: number; width: number };
function computePos(el: HTMLElement | null, width: number, desired: number): Pos | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const left = Math.min(Math.max(8, r.left), window.innerWidth - width - 8);
  const below = window.innerHeight - r.bottom - 8;
  const above = r.top - 8;
  if (below < desired && above > below) return { left, bottom: window.innerHeight - r.top + 4, maxHeight: Math.min(desired, above), width };
  return { left, top: r.bottom + 4, maxHeight: Math.min(desired, below), width };
}

/**
 * Multi-select event "format" (gathering type) with an inline manager — toggle any number,
 * add a new type (Enter), or delete a type from the catalog. Event type (tags) is fixed; the
 * format catalog is extensible. Opens in a portal so it escapes card overflow clipping.
 */
export function FormatPicker({ value, onChange, className }: {
  value: string[];
  onChange: (v: string[]) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [formats, setFormats] = useState<string[]>([]);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<Pos | null>(null);

  const refresh = () => listFormats().then(setFormats).catch(() => {});
  useEffect(() => { if (open) refresh(); }, [open]);

  const q = query.trim();
  const filtered = formats.filter((f) => f.toLowerCase().includes(q.toLowerCase()));
  const canAdd = q.length > 0 && !formats.some((f) => f.toLowerCase() === q.toLowerCase());

  // Toggle keeps the menu open so several formats can be picked in one go.
  const toggle = (f: string) => onChange(value.includes(f) ? value.filter((x) => x !== f) : [...value, f]);
  const create = async () => {
    if (!canAdd) return;
    await addFormat(q);
    setFormats((p) => [...p, q].sort((a, b) => a.localeCompare(b)));
    if (!value.includes(q)) onChange([...value, q]);
    setQuery("");
  };
  const del = async (f: string) => { await removeFormat(f); setFormats((p) => p.filter((x) => x !== f)); if (value.includes(f)) onChange(value.filter((x) => x !== f)); };

  useLayoutEffect(() => { if (open) setPos(computePos(btnRef.current, 224, 320)); }, [open]);
  useEffect(() => {
    if (!open) return;
    const reposition = () => setPos(computePos(btnRef.current, 224, 320));
    const onDown = (e: MouseEvent) => {
      if (menuRef.current?.contains(e.target as Node) || btnRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <span className={`inline-flex ${className ?? ""}`} onClick={(e) => e.stopPropagation()}>
      <button
        ref={btnRef}
        onClick={() => setOpen((o) => !o)}
        className={`inline-flex items-center gap-1 rounded-full text-sm border ${value.length ? "px-2.5 py-1 bg-gray-100 text-gray-600 border-gray-200 hover:bg-gray-200" : "px-2 py-1 text-xs border-dashed border-gray-300 text-gray-500 hover:bg-gray-50"}`}
      >
        {value.length === 0 ? (
          <>Format</>
        ) : (
          <span className="inline-flex items-center gap-1 flex-wrap">
            {value.map((f) => <span key={f} className="px-2 py-0.5 rounded-full text-xs bg-white border border-gray-200">{f}</span>)}
          </span>
        )}
        <ChevronDown className="w-3 h-3 opacity-70 shrink-0" />
      </button>

      {open && pos && createPortal(
        <div
          ref={menuRef}
          onClick={(e) => e.stopPropagation()}
          style={{ position: "fixed", left: pos.left, top: pos.top, bottom: pos.bottom, width: pos.width, maxHeight: pos.maxHeight }}
          className="z-50 bg-white border border-black rounded-lg shadow-lg overflow-hidden flex flex-col"
        >
          <div className="bg-white p-1 border-b border-gray-100 flex items-center gap-1 shrink-0">
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && canAdd) void create(); }}
              placeholder="Find or add a format…"
              className="flex-1 px-2 py-1 text-sm border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-gray-300"
            />
            <button onClick={() => setOpen(false)} aria-label="Close" className="p-1 text-gray-400 hover:text-gray-700 shrink-0"><X className="w-4 h-4" /></button>
          </div>
          <div className="p-1 overflow-y-auto flex-1 min-h-0">
            {canAdd && (
              <button onClick={() => void create()} className="flex items-center gap-2 w-full text-left px-2 py-1.5 rounded hover:bg-gray-50 text-sm font-medium">
                <Plus className="w-3.5 h-3.5" /> Add “{q}”
              </button>
            )}
            {filtered.map((f) => (
              <div key={f} className="group flex items-center gap-1 rounded hover:bg-gray-50">
                <button onClick={() => toggle(f)} className="flex items-center justify-between flex-1 text-left px-2 py-1 text-sm">
                  <span>{f}</span>
                  {value.includes(f) && <Check className="w-4 h-4 text-gray-700" />}
                </button>
                <button onClick={() => void del(f)} aria-label={`Delete ${f}`} className="px-1.5 text-gray-300 hover:text-red-600 opacity-0 group-hover:opacity-100"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
            ))}
            {filtered.length === 0 && !canAdd && <p className="px-2 py-2 text-xs text-gray-400">No formats yet — type to add one.</p>}
          </div>
        </div>,
        document.body,
      )}
    </span>
  );
}
