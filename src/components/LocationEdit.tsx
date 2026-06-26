import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { MapPin } from "lucide-react";
import { CITIES, canonicalCity } from "../lib/cities";

/**
 * Text input with a city autocomplete that locks to a canonical city on commit (Enter / blur).
 * The suggestion list is rendered in a portal positioned from the input's rect, so it stays
 * glued to the field even inside modals/overflow containers (a native <datalist> mis-anchored).
 */
export function LocationInput({
  value,
  onChange,
  placeholder = "Location",
  className,
  style,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  style?: CSSProperties;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number; width: number } | null>(null);

  const lock = () => { const v = value.trim() ? canonicalCity(value) : ""; if (v !== value) onChange(v); };
  const q = value.trim().toLowerCase();
  const matches = (q ? CITIES.filter((c) => c.toLowerCase().includes(q)) : CITIES).slice(0, 8);

  const place = () => {
    const el = inputRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ left: r.left, top: r.bottom + 4, width: r.width });
  };
  useLayoutEffect(() => { if (open) place(); }, [open, value]);
  useEffect(() => {
    if (!open) return;
    const reposition = () => place();
    const onDown = (e: MouseEvent) => {
      if (inputRef.current?.contains(e.target as Node) || menuRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    document.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  const pick = (c: string) => { onChange(c); setOpen(false); };

  return (
    <>
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={lock}
        onKeyDown={(e) => { if (e.key === "Enter") { lock(); setOpen(false); } else if (e.key === "Escape") setOpen(false); }}
        placeholder={placeholder}
        className={className}
        style={style}
        autoComplete="off"
      />
      {open && pos && matches.length > 0 && createPortal(
        <div
          ref={menuRef}
          onMouseDown={(e) => e.preventDefault()}
          style={{ position: "fixed", left: pos.left, top: pos.top, width: Math.max(pos.width, 176) }}
          className="z-[60] max-h-56 overflow-y-auto bg-white border border-border rounded-lg shadow-lg p-1"
        >
          {matches.map((c) => (
            <button key={c} type="button" onClick={() => pick(c)} className="flex w-full items-center gap-2 text-left px-2 py-1.5 rounded text-sm hover:bg-gray-50">
              <MapPin className="w-3.5 h-3.5 text-gray-400 shrink-0" /> {c}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}

/**
 * Inline-editable event location. Click to edit; a city datalist autocompletes and the
 * value "locks" to a known city on commit (Enter / blur). Escape cancels.
 */
export function LocationEdit({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");

  const commit = () => {
    setEditing(false);
    const v = draft.trim() ? canonicalCity(draft) : null;
    if (v !== value) onChange(v);
  };

  if (editing) {
    return (
      <span className="inline-flex items-center gap-2">
        <MapPin className="w-5 h-5" />
        <input
          list="city-options"
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === "Enter") commit(); else if (e.key === "Escape") setEditing(false); }}
          placeholder="City"
          className="px-2 py-0.5 border border-border rounded text-sm focus:outline-none focus:ring-2 focus:ring-gray-300"
        />
        <datalist id="city-options">{CITIES.map((c) => <option key={c} value={c} />)}</datalist>
      </span>
    );
  }
  return (
    <button onClick={() => { setDraft(value ?? ""); setEditing(true); }} className="inline-flex items-center gap-2 hover:text-gray-900 text-left">
      <MapPin className="w-5 h-5" />
      <span className="underline decoration-dotted underline-offset-4">{value ?? "Add location"}</span>
    </button>
  );
}
