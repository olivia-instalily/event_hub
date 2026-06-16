import { useState, useRef, useLayoutEffect, useEffect } from "react";
import { createPortal } from "react-dom";
import { Plus, Check, X, Search } from "lucide-react";
import { EVENT_TAGS, TAG_CATEGORIES, tagColor } from "../lib/tags";

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
 * Event tags as an overlapping stack. With `expandOnHover` (default) the stack fans
 * open on hover; without it the stack stays static (used in the chart/lines view).
 * The editor (＋) opens a searchable list in a portal.
 */
export function TagStack({
  tags,
  editable,
  onChange,
  expandOnHover = true,
  onTagClick,
}: {
  tags: string[];
  editable?: boolean;
  onChange?: (tags: string[]) => void;
  expandOnHover?: boolean;
  onTagClick?: (tag: string) => void; // click a pill to filter by that tag
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<Pos | null>(null);

  const select = (t: string) => {
    onChange?.(tags.includes(t) ? tags.filter((x) => x !== t) : [...tags, t]);
    setOpen(false);
    setQuery("");
  };

  const q = query.trim().toLowerCase();
  const match = (t: string) => t.toLowerCase().includes(q);
  // Applied tags outside the taxonomy (legacy) — still listed so they can be removed.
  const otherTags = tags.filter((t) => !EVENT_TAGS.includes(t)).filter(match);

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

  // Crisp white separator + soft highlight on each pill's left edge so the stack
  // reads as distinct layers even when clipped to slivers.
  const highlight = "shadow-[inset_2px_0_0_0_rgba(255,255,255,0.95),inset_7px_0_6px_-4px_rgba(255,255,255,0.85)]";

  return (
    <span className="inline-flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
      {tags.length > 0 && (
        <span className={`inline-flex items-center ${expandOnHover ? "group/stack" : ""}`}>
          {tags.map((t, i) => {
            const isLast = i === tags.length - 1;
            const first = i === 0;
            const marginCls = first ? "" : expandOnHover ? "-ml-9 group-hover/stack:ml-1.5" : "-ml-9";
            const widthCls = isLast
              ? "max-w-[16rem] overflow-visible"
              : expandOnHover
                ? "max-w-[2.5rem] overflow-hidden group-hover/stack:max-w-[16rem] group-hover/stack:overflow-visible"
                : "max-w-[2.5rem] overflow-hidden";
            const pillCls = `inline-block px-3 py-1 rounded-full text-sm whitespace-nowrap ${tagColor(t)} ${highlight}`;
            return (
              <span key={t} className={`inline-flex ${expandOnHover ? "transition-[max-width,margin] duration-200" : ""} ${marginCls} ${widthCls}`}>
                {onTagClick ? (
                  <button type="button" onClick={() => onTagClick(t)} title={`Filter by ${t}`} className={`${pillCls} cursor-pointer hover:brightness-95`}>{t}</button>
                ) : (
                  <span className={pillCls}>{t}</span>
                )}
              </span>
            );
          })}
        </span>
      )}

      {editable && (
        <button
          ref={btnRef}
          onClick={() => setOpen((o) => !o)}
          className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs border border-dashed border-gray-300 text-gray-500 hover:bg-gray-50"
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
          className="z-50 bg-white border border-black rounded-lg shadow-lg overflow-hidden flex flex-col"
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
                  <p className="px-2 pt-1.5 pb-0.5 text-[10px] font-semibold tracking-wide uppercase text-gray-400">{cat.name}</p>
                  {opts.map((t) => (
                    <button key={t} onClick={() => select(t)} className="flex items-center justify-between w-full text-left px-2 py-1 rounded hover:bg-gray-50">
                      <span className={`px-2 py-0.5 rounded-full text-xs ${tagColor(t)}`}>{t}</span>
                      {tags.includes(t) && <Check className="w-4 h-4 text-gray-700" />}
                    </button>
                  ))}
                </div>
              );
            })}
            {otherTags.length > 0 && (
              <div className="mb-1 border-t border-gray-100 pt-1">
                <p className="px-2 pt-1 pb-0.5 text-[10px] font-semibold tracking-wide uppercase text-gray-400">Other</p>
                {otherTags.map((t) => (
                  <button key={t} onClick={() => select(t)} className="flex items-center justify-between w-full text-left px-2 py-1 rounded hover:bg-gray-50">
                    <span className={`px-2 py-0.5 rounded-full text-xs ${tagColor(t)}`}>{t}</span>
                    <Check className="w-4 h-4 text-gray-700" />
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>,
        document.body,
      )}
    </span>
  );
}
