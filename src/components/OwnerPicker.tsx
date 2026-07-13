import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Plus, Search, Check, Users } from "lucide-react";
import { useProfile, initials } from "../lib/profile";
import { addEventOwner, removeEventOwner } from "../lib/db";

// Profiles store color as a Tailwind class ("bg-blue-500") or a hex ("#3b82f6", SSO-created). A hex
// isn't a valid class, so render it via inline style — otherwise the avatar circle is invisible.
function avatarColor(color: string | null): { cls: string; style?: { backgroundColor: string } } {
  const raw = color?.trim();
  if (raw?.startsWith("#")) return { cls: "", style: { backgroundColor: raw } };
  return { cls: raw || "bg-gray-400" };
}

type Owner = { id: string; name: string; color: string | null };
type Pos = { left: number; top?: number; bottom?: number; maxHeight: number; width: number };

function computePos(el: HTMLElement | null, width: number, desired: number): Pos | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const left = Math.min(Math.max(8, r.left), window.innerWidth - width - 8);
  const below = window.innerHeight - r.bottom - 8;
  const above = r.top - 8;
  if (below < desired && above > below) return { left, bottom: window.innerHeight - r.top + 4, maxHeight: Math.min(desired, above), width };
  return { left, top: r.bottom + 4, maxHeight: Math.min(desired, below), width };
}

/** Multiple event owners as stacked avatars (icon-only, fan out + name on hover). The
 *  picker opens in a portal so it floats over the page instead of being clipped by a card. */
export function OwnerPicker({ eventId, owners, onChange }: {
  eventId: string;
  owners: Owner[];
  onChange: (owners: Owner[]) => void;
}) {
  const { profiles, refresh } = useProfile();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<Pos | null>(null);

  const has = (id: string) => owners.some((o) => o.id === id);
  const toggle = async (p: { id: string; name: string; color: string | null }) => {
    if (has(p.id)) { onChange(owners.filter((o) => o.id !== p.id)); await removeEventOwner(eventId, p.id); }
    else { onChange([...owners, { id: p.id, name: p.name, color: p.color }]); await addEventOwner(eventId, p.id); }
  };
  const q = query.trim().toLowerCase();
  const filtered = profiles.filter((p) => !q || p.name.toLowerCase().includes(q) || (p.email ?? "").toLowerCase().includes(q));

  useLayoutEffect(() => { if (open) setPos(computePos(btnRef.current, 224, 320)); }, [open]);
  // Re-pull profiles each time the picker opens so a teammate who signed in (SSO auto-creates their
  // profile) shows up without a full page reload.
  useEffect(() => { if (open) void refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [open]);
  useEffect(() => {
    if (!open) return;
    const reposition = () => setPos(computePos(btnRef.current, 224, 320));
    const onDown = (e: MouseEvent) => {
      if (menuRef.current?.contains(e.target as Node) || btnRef.current?.contains(e.target as Node)) return;
      setOpen(false); setQuery("");
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); setQuery(""); } };
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="owner-stack relative inline-flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
      <span className="font-medium">Owners:</span>
      {owners.length > 0 ? (
        <span className="group/own inline-flex items-center">
          {owners.map((o, i) => (
            <span key={o.id} className={`inline-flex transition-[margin] duration-200 ${i ? "-ml-2 group-hover/own:ml-0.5" : ""}`}>
              {(() => { const { cls, style } = avatarColor(o.color); return <span title={o.name} style={style} className={`w-7 h-7 rounded-full ring-2 ring-white text-white text-[13px] font-medium flex items-center justify-center ${cls}`}>{initials(o.name)}</span>; })()}
            </span>
          ))}
        </span>
      ) : <span className="text-gray-400 text-sm">Unassigned</span>}
      <button ref={btnRef} onClick={() => setOpen((v) => !v)} className="w-6 h-6 rounded-full border border-dashed border-gray-300 text-gray-400 hover:bg-gray-50 flex items-center justify-center" aria-label="Add owner"><Plus className="w-3.5 h-3.5" /></button>

      {open && pos && createPortal(
        <div
          ref={menuRef}
          onClick={(e) => e.stopPropagation()}
          style={{ position: "fixed", left: pos.left, top: pos.top, bottom: pos.bottom, width: pos.width, maxHeight: pos.maxHeight }}
          className="z-50 bg-white border border-border rounded-lg shadow-lg overflow-hidden flex flex-col"
        >
          <div className="p-1 border-b border-gray-100 relative shrink-0">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search profiles…" className="w-full pl-7 pr-2 py-1 text-sm border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-gray-300" />
          </div>
          <div className="overflow-y-auto p-1 flex-1 min-h-0">
            {profiles.length === 0 && <p className="px-2 py-2 text-sm text-gray-400 inline-flex items-center gap-1"><Users className="w-4 h-4" /> No profiles — create one in the header.</p>}
            {filtered.map((p) => (
              <button key={p.id} onClick={() => toggle(p)} className="flex items-center gap-2 w-full text-left px-2 py-1 rounded hover:bg-gray-50 text-sm">
                {(() => { const { cls, style } = avatarColor(p.color); return <span style={style} className={`w-5 h-5 rounded-full text-white text-[13px] font-medium flex items-center justify-center ${cls}`}>{initials(p.name)}</span>; })()}
                <span className="flex-1 truncate">{p.name}</span>
                {has(p.id) && <Check className="w-4 h-4 text-gray-700" />}
              </button>
            ))}
            {filtered.length === 0 && profiles.length > 0 && <p className="px-2 py-2 text-[15px] text-gray-400">No match.</p>}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
