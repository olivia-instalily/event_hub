import { useEffect, useState } from "react";
import { CalendarDays, MapPin, ExternalLink, Users, X } from "lucide-react";
import { Modal } from "./Modal";
import { listAttendeesForEvent, type EventListItem, type PersonView } from "../lib/db";

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
  if (e.macroStage === "Wrapped" || e.status === "past") return "past";
  return e.status === "in-process" ? "in-process" : "future";
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

// Read-only detail card for an external conference (we're attending it) — no workspace affordances.
export function ExternalDetail({ item, onClose }: { item: EventListItem; onClose: () => void }) {
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
      <div className="flex justify-end mt-5"><button onClick={onClose} className="inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg border border-gray-300 hover:bg-gray-50"><X className="w-4 h-4" /> Close</button></div>
    </Modal>
  );
}
