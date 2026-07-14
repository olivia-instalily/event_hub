import { useState } from "react";
import { Plus } from "lucide-react";
import { filesFromDrop } from "../lib/drop";

// A visible "create a new event" affordance for the top of Home / the Events list. Drop a brief or
// folder on it (→ create/backfill flow) or click it (→ create modal). Marked data-new-event-drop so
// the app-level full-screen overlay hides while you're over it and shows its own highlight instead;
// the DROP stops propagation so it isn't also handled by the app.
export function NewEventDropZone({ onFiles, onClick, className = "" }: { onFiles: (files: File[]) => void; onClick?: () => void; className?: string }) {
  const [over, setOver] = useState(false);
  const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes("Files");
  return (
    <button
      type="button"
      data-new-event-drop=""
      onClick={onClick}
      onDragEnter={(e) => { if (!hasFiles(e)) return; e.preventDefault(); setOver(true); }}
      onDragOver={(e) => { if (!hasFiles(e)) return; e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { if (!hasFiles(e)) return; e.preventDefault(); e.stopPropagation(); setOver(false); void filesFromDrop(e.dataTransfer).then((fs) => { if (fs.length) onFiles(fs); }); }}
      className={`w-full flex items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-4 text-sm transition-colors ${over ? "border-gray-500 bg-gray-100 text-gray-800" : "border-gray-300 text-gray-500 hover:bg-gray-50"} ${className}`}
    >
      <Plus className="w-4 h-4 shrink-0" /> Drop a brief or folder to create a new event <span className="text-gray-300">· or click</span>
    </button>
  );
}
