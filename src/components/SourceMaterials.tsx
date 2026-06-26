import { useEffect, useState } from "react";
import { FileText, Image as ImageIcon, Table, Paperclip, ExternalLink, X, Eye } from "lucide-react";
import { type SourceMaterial } from "../lib/db";

type Kind = "image" | "pdf" | "text" | "other";
function kindOf(m: SourceMaterial): Kind {
  const t = (m.type || "").toLowerCase();
  if (t.startsWith("image") || /\.(png|jpe?g|gif|webp|svg)$/i.test(m.name)) return "image";
  if (t.includes("pdf") || /\.pdf$/i.test(m.name)) return "pdf";
  if (t.startsWith("text") || /(csv|tsv|markdown|json|plain)/.test(t) || /\.(md|markdown|txt|csv|tsv|json|log|ya?ml)$/i.test(m.name)) return "text";
  return "other";
}
function iconFor(m: SourceMaterial) {
  const k = kindOf(m);
  if (k === "image") return ImageIcon;
  if (m.type?.includes("csv") || /\.(csv|tsv|xlsx?)$/i.test(m.name)) return Table;
  return FileText;
}

/** The original files dropped to create this event/template — shown at the top for reference,
 *  previewable in place (image / text / PDF render inline; anything else opens out). */
export function SourceMaterials({ items, className = "" }: { items: SourceMaterial[]; className?: string }) {
  const [preview, setPreview] = useState<SourceMaterial | null>(null);
  if (!items.length) return null;
  return (
    <div className={`bg-white rounded-2xl border border-gray-200 p-4 ${className}`}>
      <div className="flex items-center gap-2 mb-3 text-sm text-gray-500">
        <Paperclip className="w-4 h-4" /> Source materials <span className="text-gray-300">· dropped to create this</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {items.map((m, i) => {
          const Icon = iconFor(m);
          return (
            <button key={i} onClick={() => setPreview(m)} title={`Preview ${m.name}`}
              className="group inline-flex items-center gap-2 max-w-[16rem] px-3 py-1.5 border border-gray-200 rounded-lg text-sm text-gray-800 hover:bg-gray-50 transition-colors">
              <Icon className="w-4 h-4 text-gray-400 shrink-0" />
              <span className="truncate">{m.name}</span>
              <Eye className="w-3.5 h-3.5 text-gray-300 shrink-0 group-hover:text-gray-500" />
            </button>
          );
        })}
      </div>
      {preview && <MaterialPreview item={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}

function MaterialPreview({ item, onClose }: { item: SourceMaterial; onClose: () => void }) {
  const kind = kindOf(item);
  const [text, setText] = useState<string | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    if (kind !== "text") return;
    let cancelled = false;
    fetch(item.url).then((r) => r.text()).then((t) => { if (!cancelled) setText(t); }).catch(() => { if (!cancelled) setErr(true); });
    return () => { cancelled = true; };
  }, [item.url, kind]);

  // Close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl border border-gray-200 w-full max-w-3xl max-h-[85vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-gray-200 shrink-0">
          <span className="font-medium text-gray-900 truncate">{item.name}</span>
          <div className="flex items-center gap-3 shrink-0">
            <a href={item.url} target="_blank" rel="noreferrer" className="text-sm text-gray-500 hover:text-gray-900 inline-flex items-center gap-1"><ExternalLink className="w-4 h-4" /> Open</a>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-700" aria-label="Close"><X className="w-5 h-5" /></button>
          </div>
        </div>
        <div className="flex-1 min-h-0 overflow-auto bg-gray-50">
          {kind === "image" && <img src={item.url} alt={item.name} className="max-w-full mx-auto" />}
          {kind === "pdf" && <iframe src={item.url} title={item.name} className="w-full h-[70vh] bg-white" />}
          {kind === "text" && (
            err ? <p className="p-4 text-sm text-gray-500">Couldn’t load a preview. <a href={item.url} target="_blank" rel="noreferrer" className="underline">Open it instead.</a></p>
              : text == null ? <p className="p-4 text-sm text-gray-400">Loading…</p>
              : <pre className="p-4 text-sm text-gray-800 whitespace-pre-wrap font-mono leading-relaxed">{text}</pre>
          )}
          {kind === "other" && (
            <div className="p-8 text-center text-sm text-gray-500">
              No inline preview for this file type. <a href={item.url} target="_blank" rel="noreferrer" className="underline">Open it in a new tab.</a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
