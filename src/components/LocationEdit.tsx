import { useState, type CSSProperties } from "react";
import { MapPin } from "lucide-react";
import { CITIES, canonicalCity } from "../lib/cities";

/**
 * Plain text input that locks to a canonical city on commit (Enter / blur). Use anywhere
 * a location is typed into a form so every location snaps to the same city scale.
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
  const lock = () => { const v = value.trim() ? canonicalCity(value) : ""; if (v !== value) onChange(v); };
  return (
    <>
      <input
        list="city-options"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={lock}
        onKeyDown={(e) => { if (e.key === "Enter") lock(); }}
        placeholder={placeholder}
        className={className}
        style={style}
      />
      <datalist id="city-options">{CITIES.map((c) => <option key={c} value={c} />)}</datalist>
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
          className="px-2 py-0.5 border border-black rounded text-sm focus:outline-none focus:ring-2 focus:ring-gray-300"
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
