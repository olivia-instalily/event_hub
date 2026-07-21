import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon } from "lucide-react";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DOW = ["S", "M", "T", "W", "T", "F", "S"];

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const parse = (s: string) => new Date(s + "T00:00:00");
const todayIso = () => iso(new Date());

/** Parse a hand-typed date into YYYY-MM-DD, or null if unparseable. Accepts YYYY-MM-DD, M/D/YYYY,
 *  M/D/YY (and `.`/`-` separators), plus anything Date can parse (e.g. "Jul 4 2026"). */
export function parseTypedDate(s: string): string | null {
  const t = s.trim();
  if (!t) return null;
  let y: number, mo: number, d: number;
  let m = t.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; }
  else if ((m = t.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/))) { mo = +m[1]; d = +m[2]; y = +m[3]; if (y < 100) y += 2000; }
  else { const dt = new Date(t); if (isNaN(dt.getTime())) return null; y = dt.getFullYear(); mo = dt.getMonth() + 1; d = dt.getDate(); }
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = new Date(y, mo - 1, d);
  if (dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null; // rejects e.g. Feb 30
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** A compact, site-styled date field: shows the date as a button; clicking opens a small
 *  month calendar popover. Selecting a day commits; "Clear" removes the date. */
export function DateEdit({
  value,
  onChange,
  placeholder = "Set date",
  emphasize = false, // red styling when overdue
}: {
  value: string | null;
  onChange: (iso: string | null) => void;
  placeholder?: string;
  emphasize?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(() => (value ? parse(value) : new Date()));
  const [draft, setDraft] = useState(value ?? ""); // what's typed in the field
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => { setDraft(value ?? ""); }, [value]);
  // Commit a hand-typed date: blank clears, valid sets, invalid reverts to the current value.
  const commitTyped = () => {
    const s = draft.trim();
    if (!s) { if (value !== null) onChange(null); return; }
    const p = parseTypedDate(s);
    if (p) { if (p !== value) onChange(p); setDraft(p); } else setDraft(value ?? "");
  };

  useEffect(() => {
    if (!open) return;
    setView(value ? parse(value) : new Date());
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (d: Date) => { onChange(iso(d)); setOpen(false); };

  const y = view.getFullYear();
  const m = view.getMonth();
  const firstDow = new Date(y, m, 1).getDay();
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const cells: (number | null)[] = [...Array(firstDow).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
  const t = todayIso();

  return (
    <span className="relative inline-flex items-center gap-1" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="p-0.5 rounded hover:bg-gray-100 text-gray-400 shrink-0"
        aria-label="Open calendar"
      >
        <CalendarIcon className="w-3.5 h-3.5" />
      </button>
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={() => { if (!value) setOpen(true); }}
        onKeyDown={(e) => { if (e.key === "Enter") { commitTyped(); setOpen(false); } else if (e.key === "Escape") { setDraft(value ?? ""); setOpen(false); } }}
        onBlur={commitTyped}
        placeholder={placeholder}
        className={`bg-transparent outline-none text-[15px] w-[6.5rem] rounded px-1 py-0.5 hover:bg-gray-100 focus:bg-gray-50 ${
          value ? (emphasize ? "text-red-600 font-medium" : "text-gray-600") : "text-gray-400"
        }`}
      />

      {open && (
        <div className="absolute z-50 mt-1 left-0 w-56 bg-white border border-border rounded-lg shadow-lg p-2">
          {/* Live suggestion while typing a fresh date — click (or Enter) to lock it in. */}
          {(() => {
            const p = parseTypedDate(draft);
            if (!p || p === value) return null;
            const nice = new Date(p + "T12:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
            return (
              <button
                onMouseDown={(e) => { e.preventDefault(); onChange(p); setDraft(p); setView(parse(p)); setOpen(false); }}
                className="w-full mb-2 flex items-center gap-1.5 rounded-md bg-gray-900 text-white text-[13px] px-2 py-1.5 hover:bg-black"
              >
                <CalendarIcon className="w-3.5 h-3.5" /> Use {nice}
              </button>
            );
          })()}
          <div className="flex items-center justify-between mb-2">
            <button onClick={() => setView(new Date(y, m - 1, 1))} className="p-1 rounded hover:bg-gray-100 text-gray-500"><ChevronLeft className="w-4 h-4" /></button>
            <span className="text-sm font-medium">{MONTHS[m]} {y}</span>
            <button onClick={() => setView(new Date(y, m + 1, 1))} className="p-1 rounded hover:bg-gray-100 text-gray-500"><ChevronRight className="w-4 h-4" /></button>
          </div>
          <div className="grid grid-cols-7 gap-0.5 text-center">
            {DOW.map((d, i) => <span key={i} className="text-[13px] text-gray-400 py-1">{d}</span>)}
            {cells.map((day, i) => {
              if (day == null) return <span key={i} />;
              const d = new Date(y, m, day);
              const di = iso(d);
              const isSel = di === value;
              const isToday = di === t;
              return (
                <button
                  key={i}
                  onClick={() => pick(d)}
                  className={`text-[15px] h-7 rounded-full hover:bg-gray-100 transition-colors ${
                    isSel ? "bg-gray-900 text-white hover:bg-gray-900" : isToday ? "ring-1 ring-gray-300" : ""
                  }`}
                >
                  {day}
                </button>
              );
            })}
          </div>
          <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-100">
            <button onClick={() => pick(new Date())} className="text-[15px] text-gray-600 hover:text-gray-900">Today</button>
            {value && <button onClick={() => { onChange(null); setOpen(false); }} className="text-[15px] text-gray-400 hover:text-red-600">Clear</button>}
          </div>
        </div>
      )}
    </span>
  );
}
