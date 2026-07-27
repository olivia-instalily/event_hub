import { useState } from "react";
import { ExternalLink, X } from "lucide-react";
import { normalizeDocUrl } from "../lib/docLink";

/** Three-state single-link control: empty → Add; filled → open + edit; editing → input + Save/clear. */
export function DocLinkControl({ url, onSave, label, icon, placeholder = "Paste link…" }: {
  url: string | null;
  onSave: (url: string | null) => void;
  label: string;
  icon: React.ReactNode;
  placeholder?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [input, setInput] = useState("");
  const commit = () => { onSave(normalizeDocUrl(input)); setEditing(false); };

  if (editing) {
    return (
      <span className="inline-flex items-center gap-1">
        <input autoFocus value={input} onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(false); }}
          placeholder={placeholder}
          className="w-64 px-2 py-1 border border-border rounded text-[13px] focus:outline-none focus:ring-2 focus:ring-gray-300" />
        <button onClick={commit} className="text-[13px] text-gray-600 hover:text-gray-900">Save</button>
        <button onClick={() => setEditing(false)} className="text-gray-400 hover:text-gray-700"><X className="w-4 h-4" /></button>
      </span>
    );
  }
  if (url) {
    return (
      <span className="inline-flex items-center gap-2">
        <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-[13px] text-gray-700 hover:text-gray-900 border border-border rounded-lg px-2.5 py-1 hover:bg-gray-50 transition-colors">{icon} {label} <ExternalLink className="w-3.5 h-3.5 text-gray-400" /></a>
        <button onClick={() => { setInput(url); setEditing(true); }} className="text-[12px] text-gray-400 hover:text-gray-700">edit</button>
      </span>
    );
  }
  return (
    <button onClick={() => { setInput(""); setEditing(true); }} className="inline-flex items-center gap-1.5 text-[13px] text-gray-500 hover:text-gray-900 border border-dashed border-gray-300 rounded-lg px-2.5 py-1 hover:bg-gray-50 transition-colors">{icon} Add {label.toLowerCase()}</button>
  );
}
