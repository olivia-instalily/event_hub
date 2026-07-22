import { useEffect, useRef, useState } from "react";
import { ImagePlus, Loader2, RefreshCw, X, Move, Check } from "lucide-react";
import { uploadAttachment, updateEventCover, setActiveCover, updateEvent } from "../lib/db";

// objectPosition is stored as "x% y%"; parse it back to numbers (default centered).
const parsePos = (p?: string | null): { x: number; y: number } => {
  const m = /(-?\d+(?:\.\d+)?)%\s+(-?\d+(?:\.\d+)?)%/.exec(p ?? "");
  return m ? { x: +m[1], y: +m[2] } : { x: 50, y: 50 };
};
const clamp = (n: number) => Math.max(0, Math.min(100, n));

/**
 * Event cover with the image as the edit control — hover greys it + "Click to change
 * · or drop"; click opens a file picker, drop uploads. A "reposition" toggle turns the
 * image into a drag surface: grab-and-pan sets how it's cropped (objectPosition), which is
 * what every card/preview across the app renders. When the event has both a Luma cover and
 * a custom upload, a toggle switches which one is shown.
 */
export function CoverImage({ eventId, cover, lumaCover, customCover, position, onChange, onPosition }: {
  eventId: string;
  cover: string | null;        // active/displayed
  lumaCover: string | null;
  customCover: string | null;
  position?: string | null;
  onChange: (patch: { cover: string | null; custom?: string | null }) => void;
  onPosition?: (pos: string) => void;
}) {
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [repos, setRepos] = useState(false); // reposition mode: drag pans instead of opening the picker
  const [pos, setPos] = useState(() => parsePos(position));
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ sx: number; sy: number; px: number; py: number } | null>(null);
  const posRef = useRef(pos);
  posRef.current = pos;

  // Reseed from the prop when it changes (e.g. a different event), unless mid-drag.
  useEffect(() => { if (!drag.current) setPos(parsePos(position)); }, [position]);

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

  // Grab-and-pan: dragging the image reveals the content you drag toward (start − delta), so it
  // feels like moving the photo behind the frame. Persists the position on release.
  const onPointerDown = (e: React.PointerEvent) => {
    if (!repos || !cover) return;
    e.preventDefault(); e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { sx: e.clientX, sy: e.clientY, px: pos.x, py: pos.y };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current || !boxRef.current) return;
    const r = boxRef.current.getBoundingClientRect();
    const dxPct = ((e.clientX - drag.current.sx) / r.width) * 100;
    const dyPct = ((e.clientY - drag.current.sy) / r.height) * 100;
    setPos({ x: clamp(drag.current.px - dxPct), y: clamp(drag.current.py - dyPct) });
  };
  const onPointerUp = async () => {
    if (!drag.current) return;
    drag.current = null;
    const val = `${Math.round(posRef.current.x)}% ${Math.round(posRef.current.y)}%`;
    onPosition?.(val);
    try { await updateEvent(eventId, { coverPosition: val }); } catch { /* keep the on-screen position */ }
  };

  const canToggle = !!lumaCover && !!customCover && lumaCover !== customCover;
  const showingCustom = cover === customCover;
  const toggle = async () => {
    const next = showingCustom ? lumaCover : customCover;
    await setActiveCover(eventId, next);
    onChange({ cover: next });
  };

  return (
    <div className="w-[clamp(8rem,22vw,14rem)] shrink-0 self-start">
      <div
        ref={boxRef}
        onClick={(e) => { e.stopPropagation(); if (repos) return; inputRef.current?.click(); }}
        onDragOver={(e) => { if (repos) return; e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { if (repos) return; e.preventDefault(); setOver(false); void upload(e.dataTransfer.files?.[0]); }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        className={`group relative w-full aspect-[7/5] rounded-2xl overflow-hidden border border-border ${cover ? "" : "bg-gray-50"} ${repos ? "cursor-grab active:cursor-grabbing ring-2 ring-gray-900 touch-none" : "cursor-pointer"}`}
        title={repos ? "Drag to reposition" : "Click to change · or drop an image"}
      >
        {cover
          ? <img src={cover} alt="event cover" draggable={false} className="w-full h-full object-cover select-none" style={{ objectPosition: `${pos.x}% ${pos.y}%` }} />
          : <div className="w-full h-full flex flex-col items-center justify-center text-gray-400 gap-1"><ImagePlus className="w-6 h-6" /><span className="text-[15px]">Add cover</span></div>}
        {/* Change/drop hint — hidden while repositioning. */}
        {!repos && (
          <div className={`absolute inset-0 flex flex-col items-center justify-center gap-1 text-white text-[15px] font-medium bg-black/40 transition-opacity ${over || busy ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}>
            {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <ImagePlus className="w-5 h-5" />}
            {busy ? "Uploading…" : over ? "Drop to upload" : "Click to change · or drop"}
          </div>
        )}
        {repos && (
          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-full bg-black/60 text-white text-[11px] pointer-events-none">Drag to reposition</div>
        )}
        {/* Controls (hover): reposition toggle + remove. Reposition ✓ stays visible while active. */}
        {cover && (
          <div className={`absolute top-2 right-2 z-10 flex gap-1 transition-opacity ${repos ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}>
            <button
              onClick={(e) => { e.stopPropagation(); setRepos((r) => !r); }}
              title={repos ? "Done repositioning" : "Reposition image"}
              aria-label={repos ? "Done repositioning" : "Reposition image"}
              className={`p-1 rounded-full shadow-sm ${repos ? "bg-gray-900 text-white" : "bg-white/90 text-gray-600 hover:text-gray-900"}`}
            >
              {repos ? <Check className="w-4 h-4" /> : <Move className="w-4 h-4" />}
            </button>
            {!repos && (
              <button onClick={(e) => { e.stopPropagation(); void remove(); }} title="Remove cover" aria-label="Remove cover" className="p-1 rounded-full bg-white/90 text-gray-600 hover:text-red-600 shadow-sm">
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        )}
        <input ref={inputRef} type="file" accept="image/*" hidden onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = ""; }} />
      </div>
      {canToggle && !repos && (
        <button onClick={(e) => { e.stopPropagation(); void toggle(); }} className="mt-1.5 inline-flex items-center gap-1 text-[15px] text-gray-500 hover:text-gray-900">
          <RefreshCw className="w-3 h-3" /> Showing {showingCustom ? "custom" : "Luma"} cover · use {showingCustom ? "Luma" : "custom"}
        </button>
      )}
    </div>
  );
}
