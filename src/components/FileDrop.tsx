import { useRef, useState } from "react";
import { Paperclip, Loader2 } from "lucide-react";
import { uploadAttachment } from "../lib/db";

/**
 * Small attach control: click to pick or drag-and-drop a file. Uploads to the
 * attachments bucket and calls onUploaded with the public URL + filename.
 */
export function FileDrop({ onUploaded, label = "Attach / drop file", compact }: {
  onUploaded: (url: string, name: string) => void;
  label?: string;
  compact?: boolean;
}) {
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handle = async (file?: File | null) => {
    if (!file) return;
    setBusy(true); setErr(null);
    try { onUploaded(await uploadAttachment(file), file.name); }
    catch (e: any) { setErr(e?.message ?? String(e)); }
    finally { setBusy(false); }
  };

  return (
    <span
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); void handle(e.dataTransfer.files?.[0]); }}
      onClick={(e) => { e.stopPropagation(); inputRef.current?.click(); }}
      className={`inline-flex items-center gap-1 rounded-md border border-dashed cursor-pointer transition-colors ${compact ? "px-2 py-0.5 text-[15px]" : "px-2.5 py-1 text-sm"} ${over ? "border-gray-800 bg-gray-100 text-gray-900" : "border-gray-300 text-gray-500 hover:bg-gray-50"}`}
    >
      {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Paperclip className="w-3.5 h-3.5" />}
      {busy ? "Uploading…" : over ? "Drop to upload" : label}
      <input ref={inputRef} type="file" hidden onChange={(e) => { void handle(e.target.files?.[0]); e.target.value = ""; }} />
      {err && <span className="text-red-600 ml-1">{err}</span>}
    </span>
  );
}
