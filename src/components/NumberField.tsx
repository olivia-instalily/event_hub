import { useEffect, useRef, useState } from "react";

// A number input you can actually edit: it holds a local draft so you can CLEAR it and type a new
// value, instead of snapping back to a fallback on the first delete. Empty is allowed while editing;
// on blur it clamps to [min,max] (falling back to min when left blank). Use wherever a required
// numeric value is edited in place. For optional/nullable numbers, a plain `empty ? null : Number`
// input is fine.
export function NumberField({
  value, onChange, min, max, step, className, placeholder, ariaLabel,
}: {
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  step?: number;
  className?: string;
  placeholder?: string;
  ariaLabel?: string;
}) {
  const [draft, setDraft] = useState(String(value));
  const focused = useRef(false);
  // Sync external value in — but never while the user is mid-edit (would clobber their keystrokes).
  useEffect(() => { if (!focused.current) setDraft(String(value)); }, [value]);

  const clamp = (n: number) => {
    let v = n;
    if (min != null) v = Math.max(min, v);
    if (max != null) v = Math.min(max, v);
    return v;
  };

  return (
    <input
      type="number"
      inputMode="numeric"
      value={draft}
      min={min}
      max={max}
      step={step}
      placeholder={placeholder}
      aria-label={ariaLabel}
      className={className}
      onFocus={() => { focused.current = true; }}
      onChange={(e) => {
        const raw = e.target.value;
        setDraft(raw);                       // allow "" and partial input to persist visually
        if (raw.trim() === "") return;       // don't commit an empty field mid-edit
        const n = Number(raw);
        if (!Number.isNaN(n)) onChange(clamp(n));
      }}
      onBlur={() => {
        focused.current = false;
        const n = Number(draft);
        const v = draft.trim() === "" || Number.isNaN(n) ? (min ?? 0) : clamp(n);
        onChange(v);
        setDraft(String(v));
      }}
    />
  );
}
