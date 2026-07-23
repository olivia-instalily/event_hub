import { useEffect, useState } from "react";
import { CalendarDays, MapPin, ExternalLink, Users, X, Pencil } from "lucide-react";
import { Modal } from "./Modal";
import { listAttendeesForEvent, type EventListItem, type PersonView, type EventStatus } from "../lib/db";

const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

// The status an event effectively HAS right now — date wins over the stored flag: once an event's
// (end) date is before today it is Past, no matter what status was saved. Externals (no stored
// status) derive future/in-process/past from their dates. Used for all bucketing + status chips so
// a past-dated event can never sit in "Upcoming".
export function effectiveStatus(e: EventListItem): EventStatus {
  const end = e.endDate ?? e.date;
  if (end && end < todayIso()) return "past";
  if (e.isExternal) return e.date && e.date > todayIso() ? "future" : "in-process";
  if (e.macroStage === "Wrapped") return "past";
  return e.status;
}

// Shared event-category model used by both the Events page and the Calendar page, so the two stay
// aligned. External conferences are their own category (we're attending, not running).
export type CatKey = "future" | "in-process" | "past" | "external";

export const CAT_META: { key: CatKey; label: string; dot: string }[] = [
  { key: "future", label: "Future", dot: "bg-blue-500" },
  { key: "in-process", label: "In-Process", dot: "bg-amber-500" },
  { key: "past", label: "Past", dot: "bg-gray-400" },
  { key: "external", label: "External", dot: "bg-purple-500" },
];
export const ALL_CATS: CatKey[] = CAT_META.map((c) => c.key);

export function categoryOf(e: EventListItem): CatKey {
  if (e.isExternal) return "external";
  const s = effectiveStatus(e); // date-aware: a past-dated event is Past regardless of stored status
  return s === "past" ? "past" : s === "in-process" ? "in-process" : "future";
}

// Colored-dot category filter (multi-select — toggle each category in/out). Default: all on.
export function CategoryDots({ selected, onToggle, className = "" }: { selected: Set<CatKey>; onToggle: (k: CatKey) => void; className?: string }) {
  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className}`}>
      {CAT_META.map(({ key, label, dot }) => {
        const on = selected.has(key);
        return (
          <button
            key={key}
            onClick={() => onToggle(key)}
            aria-pressed={on}
            title={`Toggle ${label}`}
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] transition-colors ${on ? "border-gray-900 bg-gray-900 text-white" : "border-border bg-white text-gray-500 hover:bg-gray-50"}`}
          >
            <span className={`w-2 h-2 rounded-full ${dot}`} /> {label}
          </button>
        );
      })}
    </div>
  );
}

// Detail card for an external conference (we're attending it). View-only body + an Edit affordance.
export function ExternalDetail({ item, onClose, onEdit }: { item: EventListItem; onClose: () => void; onEdit?: () => void }) {
  const [people, setPeople] = useState<PersonView[] | null>(null);
  useEffect(() => { listAttendeesForEvent(item.id).then(setPeople).catch(() => setPeople([])); }, [item.id]);

  const fmt = (d: string) => new Date(d + "T12:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  const range = item.date ? (item.endDate && item.endDate !== item.date ? `${fmt(item.date)} – ${fmt(item.endDate)}` : fmt(item.date)) : "No date";

  return (
    <Modal title={item.title} onClose={onClose} maxWidth="max-w-md">
      <div className="space-y-3">
        <span className="inline-flex items-center gap-1 text-[12px] font-medium text-purple-700 bg-purple-50 border border-purple-200 rounded-full px-2 py-0.5">
          External{item.quarter ? ` · ${item.quarter}` : ""}
        </span>
        {item.why && <p className="text-sm text-gray-700">{item.why}</p>}
        <div className="text-sm text-gray-700 space-y-1.5">
          <div className="flex items-center gap-2"><CalendarDays className="w-4 h-4 text-gray-400 shrink-0" /> {range}</div>
          {item.location && <div className="flex items-center gap-2"><MapPin className="w-4 h-4 text-gray-400 shrink-0" /> {item.location}</div>}
          {item.infoUrl && <div className="flex items-center gap-2"><ExternalLink className="w-4 h-4 text-gray-400 shrink-0" /> <a href={item.infoUrl} target="_blank" rel="noreferrer" className="text-blue-600 underline decoration-dotted underline-offset-2 hover:text-blue-800 truncate">{item.infoUrl}</a></div>}
        </div>
        <div>
          <div className="flex items-center gap-2 text-[13px] text-gray-500 mb-1"><Users className="w-4 h-4" /> Attending{people ? ` (${people.length})` : ""}</div>
          {people === null ? (
            <p className="text-[13px] text-gray-400">Loading…</p>
          ) : people.length === 0 ? (
            <p className="text-[13px] text-gray-400">No one tagged yet.</p>
          ) : (
            <ul className="flex flex-wrap gap-1.5">
              {people.map((p) => (
                <li key={p.id} className="inline-flex items-center bg-gray-100 rounded-full px-2.5 py-0.5 text-[13px] text-gray-800">{p.name ?? "Unnamed"}{p.org ? ` · ${p.org}` : ""}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <div className="flex justify-end gap-2 mt-5">
        {onEdit && <button onClick={onEdit} className="inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg border border-gray-300 hover:bg-gray-50"><Pencil className="w-4 h-4" /> Edit</button>}
        <button onClick={onClose} className="inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg border border-gray-300 hover:bg-gray-50"><X className="w-4 h-4" /> Close</button>
      </div>
    </Modal>
  );
}
