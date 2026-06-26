import { useState, useRef, useLayoutEffect, useEffect } from "react";
import { createPortal } from "react-dom";
import { Plus, Check, X, Search } from "lucide-react";
import { TAG_CATEGORIES, tagBadgeVariant } from "../lib/tags";
import { Badge } from "@instalily/ui/badge";

type Pos = { left: number; top?: number; bottom?: number; maxHeight: number; width: number };

function computePos(el: HTMLElement | null, width: number, desiredHeight: number): Pos | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const left = Math.min(Math.max(8, r.left), window.innerWidth - width - 8);
  const spaceBelow = window.innerHeight - r.bottom - 8;
  const spaceAbove = r.top - 8;
  if (spaceBelow < desiredHeight && spaceAbove > spaceBelow) {
    return { left, bottom: window.innerHeight - r.top + 4, maxHeight: Math.min(desiredHeight, spaceAbove), width };
  }
  return { left, top: r.bottom + 4, maxHeight: Math.min(desiredHeight, spaceBelow), width };
}

/**
 * An event's taxonomy tag. Single-select (an event carries one tag), so it renders as a
 * plain full-color badge — no stacking. The editor (＋) opens a searchable list in a portal.
 */
export function TagStack({
  tags,
  editable,
  onChange,
  onTagClick,
}: {
  tags: string[];
  editable?: boolean;
  onChange?: (tags: string[]) => void;
  onTagClick?: (tag: string) => void; // click a pill to filter by that tag
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<Pos | null>(null);

  // Single-select: an event carries one taxonomy tag. Picking one replaces the rest;
  // clicking the selected one clears it. (Formats stay multi-select via FormatPicker.)
  const select = (t: string) => {
    onChange?.(tags.includes(t) ? [] : [t]);
    setOpen(false);
    setQuery("");
  };

  const q = query.trim().toLowerCase();
  const match = (t: string) => t.toLowerCase().includes(q);

  useLayoutEffect(() => {
    if (open) setPos(computePos(btnRef.current, 224, 320));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const reposition = () => setPos(computePos(btnRef.current, 224, 320));
    const onDown = (e: MouseEvent) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      if (btnRef.current?.contains(e.target as Node)) return;
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

  // Override Badge's compact defaults (h-5/px-2/text-[15px]/rounded-4xl) back to the larger
  // pill shape. No highlight inset, so the color fills the whole pill to its edge.
  const pillCls = "h-auto px-3 py-1 rounded-full text-sm whitespace-nowrap";

  return (
    <span className="inline-flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
      {tags.map((t) => (
        <span key={t} className="inline-flex items-center gap-0.5">
          {onTagClick ? (
            <Badge render={<button type="button" onClick={() => onTagClick(t)} title={`Filter by ${t}`} />} variant={tagBadgeVariant(t)} className={`${pillCls} cursor-pointer hover:opacity-90`}>{t}</Badge>
          ) : (
            <Badge variant={tagBadgeVariant(t)} className={pillCls}>{t}</Badge>
          )}
          {editable && (
            <button type="button" onClick={() => onChange?.([])} title="Remove tag" aria-label="Remove tag" className="p-0.5 text-gray-400 hover:text-red-600">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </span>
      ))}

      {editable && (
        <button
          ref={btnRef}
          onClick={() => setOpen((o) => !o)}
          className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[15px] border border-dashed border-gray-300 text-gray-500 hover:bg-gray-50"
        >
          <Plus className="w-3 h-3" />{tags.length === 0 && "Tag"}
        </button>
      )}

      {/* Editor dropdown */}
      {editable && open && pos && createPortal(
        <div
          ref={menuRef}
          onClick={(e) => e.stopPropagation()}
          style={{ position: "fixed", left: pos.left, top: pos.top, bottom: pos.bottom, width: pos.width, maxHeight: pos.maxHeight }}
          className="z-50 bg-white border border-border rounded-lg shadow-lg overflow-hidden flex flex-col"
        >
          <div className="bg-white p-1 border-b border-gray-100 flex items-center gap-1">
            <div className="relative flex-1">
              <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search tags…"
                className="w-full pl-7 pr-2 py-1 text-sm border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-gray-300"
              />
            </div>
            <button onClick={() => setOpen(false)} aria-label="Close" className="p-1 text-gray-400 hover:text-gray-700 shrink-0">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="p-1 overflow-y-auto">
            {TAG_CATEGORIES.map((cat) => {
              const opts = cat.tags.filter(match);
              if (!opts.length) return null;
              return (
                <div key={cat.name} className="mb-1 last:mb-0">
                  <p className="px-2 pt-1.5 pb-0.5 text-[13px] font-semibold tracking-wide uppercase text-gray-400">{cat.name}</p>
                  {opts.map((t) => (
                    <button key={t} onClick={() => select(t)} className="flex items-center justify-between w-full text-left px-2 py-1 rounded hover:bg-gray-50">
                      <Badge variant={tagBadgeVariant(t)}>{t}</Badge>
                      {tags.includes(t) && <Check className="w-4 h-4 text-gray-700" />}
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        </div>,
        document.body,
      )}
    </span>
  );
}
