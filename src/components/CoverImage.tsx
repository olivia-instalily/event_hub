import { useRef, useState } from "react";
import { ImagePlus, Loader2, RefreshCw, X } from "lucide-react";
import { uploadAttachment, updateEventCover, setActiveCover } from "../lib/db";

/**
 * Event cover with the image as the edit control — hover greys it + "Click to change
 * · or drop"; click opens a file picker, drop uploads. When the event has both a Luma
 * cover and a custom upload, a toggle switches which one is shown.
 */
export function CoverImage({ eventId, cover, lumaCover, customCover, position, onChange }: {
  eventId: string;
  cover: string | null;        // active/displayed
  lumaCover: string | null;
  customCover: string | null;
  position?: string | null;
  onChange: (patch: { cover: string | null; custom?: string | null }) => void;
}) {
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const upload = async (file?: File | null) => {
    if (!file) return;
    setBusy(true);
    try {
      const url = await uploadAttachment(file);
      await updateEventCover(eventId, url);
      onChange({ cover: url, custom: url });
    } finally { setBusy(false); }
  };

  const remove = async () => {
    setBusy(true);
    try { await updateEventCover(eventId, null); onChange({ cover: null, custom: null }); }
    finally { setBusy(false); }
  };

  const canToggle = !!lumaCover && !!customCover && lumaCover !== customCover;
  const showingCustom = cover === customCover;
  const toggle = async () => {
    const next = showingCustom ? lumaCover : customCover;
    await setActiveCover(eventId, next);
    onChange({ cover: next });
  };

  return (
    // Fluid width: full size on wide screens, shrinks as the page narrows (floor 8rem) so the
    // text column keeps its size and stays readable — the image yields the space.
    <div className="w-[clamp(8rem,22vw,14rem)] shrink-0 self-start">
      <div
        onClick={(e) => { e.stopPropagation(); inputRef.current?.click(); }}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); void upload(e.dataTransfer.files?.[0]); }}
        className={`group relative w-full aspect-[7/5] rounded-2xl overflow-hidden border border-border cursor-pointer ${cover ? "" : "bg-gray-50"}`}
        title="Click to change · or drop an image"
      >
        {cover
          ? <img src={cover} alt="event cover" className="w-full h-full object-cover" style={{ objectPosition: position ?? "50% 50%" }} />
          : <div className="w-full h-full flex flex-col items-center justify-center text-gray-400 gap-1"><ImagePlus className="w-6 h-6" /><span className="text-[15px]">Add cover</span></div>}
        <div className={`absolute inset-0 flex flex-col items-center justify-center gap-1 text-white text-[15px] font-medium bg-black/40 transition-opacity ${over || busy ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}>
          {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <ImagePlus className="w-5 h-5" />}
          {busy ? "Uploading…" : over ? "Drop to upload" : "Click to change · or drop"}
        </div>
        {cover && (
          <button onClick={(e) => { e.stopPropagation(); void remove(); }} title="Remove cover" aria-label="Remove cover" className="absolute top-2 right-2 z-10 p-1 rounded-full bg-white/90 text-gray-600 hover:text-red-600 shadow-sm opacity-0 group-hover:opacity-100 transition-opacity">
            <X className="w-4 h-4" />
          </button>
        )}
        <input ref={inputRef} type="file" accept="image/*" hidden onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = ""; }} />
      </div>
      {canToggle && (
        <button onClick={(e) => { e.stopPropagation(); void toggle(); }} className="mt-1.5 inline-flex items-center gap-1 text-[15px] text-gray-500 hover:text-gray-900">
          <RefreshCw className="w-3 h-3" /> Showing {showingCustom ? "custom" : "Luma"} cover · use {showingCustom ? "Luma" : "custom"}
        </button>
      )}
    </div>
  );
}
