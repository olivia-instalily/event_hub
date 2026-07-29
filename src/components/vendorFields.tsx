import { useState, useRef, useEffect } from "react";
import { Pencil } from "lucide-react";

// Click-to-edit category "title". Typing filters `options` (categories used across events); pick one
// or create a new one. Commit on Enter or option click; Escape/blur cancels. Steers toward reusing an
// existing category so the same group stays together.
export function CategoryCombobox({ value, options, onCommit }: {
  value: string | null; options: string[]; onCommit: (category: string) => void | Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [q, setQ] = useState(value ?? "");
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (editing) setQ(value ?? ""); }, [editing, value]);
  useEffect(() => {
    if (!editing) return;
    const onDown = (e: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setEditing(false); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [editing]);

  const commit = async (c: string) => { const t = c.trim(); setEditing(false); if (t && t !== (value ?? "")) await onCommit(t); };
  const matches = options.filter((o) => o.toLowerCase().includes(q.trim().toLowerCase()));
  const exact = options.some((o) => o.toLowerCase() === q.trim().toLowerCase());

  if (!editing) {
    return (
      <button onClick={() => setEditing(true)} className="group inline-flex items-center gap-1.5 text-lg font-medium text-left hover:text-gray-700" title="Edit category">
        {value ?? "Uncategorized"}
        <Pencil className="w-3.5 h-3.5 text-gray-300 group-hover:text-gray-500" />
      </button>
    );
  }
  return (
    <div ref={boxRef} className="relative inline-block">
      <input
        autoFocus value={q} onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") void commit(q); if (e.key === "Escape") setEditing(false); }}
        placeholder="Category (e.g. Catering)"
        className="text-lg font-medium border border-gray-300 rounded-md px-2 py-0.5 focus:outline-none focus:ring-2 focus:ring-gray-300 w-56"
      />
      {(matches.length > 0 || (q.trim() && !exact)) && (
        <div className="absolute z-20 mt-1 w-64 bg-white border border-border rounded-lg shadow-lg overflow-hidden">
          {matches.map((o) => (
            <button key={o} onClick={() => void commit(o)} className="block w-full text-left px-3 py-1.5 text-sm hover:bg-gray-50">{o}</button>
          ))}
          {q.trim() && !exact && (
            <button onClick={() => void commit(q)} className="block w-full text-left px-3 py-1.5 text-sm text-violet-700 hover:bg-violet-50 border-t border-gray-100">+ Create "{q.trim()}"</button>
          )}
        </div>
      )}
    </div>
  );
}

// Optional per-vendor description. Empty → a subtle "+ add description"; present → click-to-edit text.
export function DescriptionLine({ value, onCommit }: { value: string | null; onCommit: (note: string | null) => void | Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value ?? "");
  useEffect(() => { if (editing) setText(value ?? ""); }, [editing, value]);
  const commit = async () => { setEditing(false); const t = text.trim(); if (t !== (value ?? "")) await onCommit(t || null); };
  if (editing) {
    return (
      <input
        autoFocus value={text} onChange={(e) => setText(e.target.value)} onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") void commit(); if (e.key === "Escape") setEditing(false); }}
        placeholder="Description (e.g. breakfast)"
        className="mt-0.5 w-full max-w-md text-sm text-gray-600 border border-gray-200 rounded-md px-2 py-0.5 focus:outline-none focus:ring-1 focus:ring-gray-300"
      />
    );
  }
  return value
    ? <button onClick={() => setEditing(true)} className="mt-0.5 block text-sm text-gray-500 hover:text-gray-700 text-left" title="Edit description">{value}</button>
    : <button onClick={() => setEditing(true)} className="mt-0.5 block text-[13px] text-gray-400 hover:text-gray-600 text-left">+ add description</button>;
}

// Inline-editable supplier name (the selected candidate).
export function SupplierName({ value, onCommit }: { value: string | null; onCommit: (name: string) => void | Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value ?? "");
  useEffect(() => { if (editing) setText(value ?? ""); }, [editing, value]);
  const commit = async () => { setEditing(false); const t = text.trim(); if (t && t !== (value ?? "")) await onCommit(t); };
  if (editing) {
    return (
      <input autoFocus value={text} onChange={(e) => setText(e.target.value)} onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") void commit(); if (e.key === "Escape") setEditing(false); }}
        className="text-sm border border-gray-200 rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-gray-300" />
    );
  }
  return <button onClick={() => setEditing(true)} className="text-sm font-medium hover:underline" title="Edit supplier">{value ?? "—"}</button>;
}
