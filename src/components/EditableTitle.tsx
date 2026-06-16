import { useState } from "react";

/** Click-to-edit heading. Enter / blur commits; Escape cancels. */
export function EditableTitle({ value, onChange, className = "" }: {
  value: string;
  onChange: (v: string) => void;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  const commit = () => {
    setEditing(false);
    const v = draft.trim();
    if (v && v !== value) onChange(v); else setDraft(value);
  };

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") commit(); else if (e.key === "Escape") { setDraft(value); setEditing(false); } }}
        className={`${className} w-full px-1 -mx-1 border border-black rounded focus:outline-none focus:ring-2 focus:ring-gray-300`}
      />
    );
  }
  return (
    <h1 onClick={() => { setDraft(value); setEditing(true); }} title="Click to edit" className={`${className} cursor-text rounded px-1 -mx-1 hover:bg-gray-50`}>{value}</h1>
  );
}
