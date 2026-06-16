import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon } from "lucide-react";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DOW = ["S", "M", "T", "W", "T", "F", "S"];

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const parse = (s: string) => new Date(s + "T00:00:00");
const todayIso = () => iso(new Date());

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
  const ref = useRef<HTMLDivElement>(null);

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
    <span className="relative inline-block" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className={`inline-flex items-center gap-1 text-xs rounded px-1.5 py-0.5 hover:bg-gray-100 transition-colors ${
          value ? (emphasize ? "text-red-600 font-medium" : "text-gray-600") : "text-gray-400"
        }`}
      >
        <CalendarIcon className="w-3 h-3" />
        {value ?? placeholder}
      </button>

      {open && (
        <div className="absolute z-50 mt-1 left-0 w-56 bg-white border border-black rounded-lg shadow-lg p-2">
          <div className="flex items-center justify-between mb-2">
            <button onClick={() => setView(new Date(y, m - 1, 1))} className="p-1 rounded hover:bg-gray-100 text-gray-500"><ChevronLeft className="w-4 h-4" /></button>
            <span className="text-sm font-medium">{MONTHS[m]} {y}</span>
            <button onClick={() => setView(new Date(y, m + 1, 1))} className="p-1 rounded hover:bg-gray-100 text-gray-500"><ChevronRight className="w-4 h-4" /></button>
          </div>
          <div className="grid grid-cols-7 gap-0.5 text-center">
            {DOW.map((d, i) => <span key={i} className="text-[10px] text-gray-400 py-1">{d}</span>)}
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
                  className={`text-xs h-7 rounded-full hover:bg-gray-100 transition-colors ${
                    isSel ? "bg-gray-900 text-white hover:bg-gray-900" : isToday ? "ring-1 ring-gray-300" : ""
                  }`}
                >
                  {day}
                </button>
              );
            })}
          </div>
          <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-100">
            <button onClick={() => pick(new Date())} className="text-xs text-gray-600 hover:text-gray-900">Today</button>
            {value && <button onClick={() => { onChange(null); setOpen(false); }} className="text-xs text-gray-400 hover:text-red-600">Clear</button>}
          </div>
        </div>
      )}
    </span>
  );
}
