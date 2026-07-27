import { useEffect, useState } from "react";
import { CalendarDays, Calendar, Plus, Pencil, Trash2, MapPin, X } from "lucide-react";
import { listEvents, listExternalConferences, deleteEvent, type EventListItem } from "../lib/db";
import { CalendarView } from "./EventsPage";
import { ExternalConferenceForm } from "./ExternalConferenceForm";
import { ExternalDetail, CAT_META, categoryOf, type CatKey } from "./externalEvents";
import { Modal, ConfirmModal } from "./Modal";
import { EXTERNAL_SUBTYPE_TAGS, EXTERNAL_TYPE_TAGS, externalTagOf, type ExternalType } from "../lib/tags";

// Compact detail popup for an INTERNAL event clicked in the calendar — real edits happen on the
// event page (Edit), plus a Delete affordance. External events use ExternalDetail instead.
function InternalEventPeek({ item, onClose, onEdit, onDelete }: { item: EventListItem; onClose: () => void; onEdit: () => void; onDelete: () => void }) {
  const fmt = (d: string) => new Date(d + "T12:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  const range = item.date ? (item.endDate && item.endDate !== item.date ? `${fmt(item.date)} – ${fmt(item.endDate)}` : fmt(item.date)) : "No date";
  return (
    <Modal title={item.title} onClose={onClose} maxWidth="max-w-md">
      <div className="space-y-3 text-sm text-gray-700">
        {item.tags?.length > 0 && <div className="flex flex-wrap gap-1.5">{item.tags.map((t) => <span key={t} className="text-[12px] rounded-full bg-gray-100 px-2 py-0.5 text-gray-600">{t}</span>)}</div>}
        <div className="flex items-center gap-2">
          {item.gcalEventId && item.gcalHtmlLink
            ? <a href={item.gcalHtmlLink} target="_blank" rel="noreferrer" title="View in Google Calendar" className="inline-flex shrink-0"><CalendarDays className="w-4 h-4 text-emerald-600 hover:text-emerald-700" /></a>
            : <CalendarDays className="w-4 h-4 text-gray-400 shrink-0" />}
          {range}
        </div>
        {item.location && <div className="flex items-center gap-2"><MapPin className="w-4 h-4 text-gray-400 shrink-0" /> {item.location}</div>}
      </div>
      <div className="flex items-center gap-2 mt-5">
        <button onClick={onDelete} className="inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg border border-red-300 text-red-600 hover:bg-red-50"><Trash2 className="w-4 h-4" /> Delete</button>
        <div className="ml-auto flex gap-2">
          <button onClick={onEdit} className="inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg bg-gray-900 text-white hover:bg-gray-700"><Pencil className="w-4 h-4" /> Edit event</button>
          <button onClick={onClose} className="inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg border border-gray-300 hover:bg-gray-50"><X className="w-4 h-4" /> Close</button>
        </div>
      </div>
    </Modal>
  );
}

// Clean, calendar-only view of everything on our radar: events we're running + external conferences
// we're attending. Future/In-Process/Past act as a color key AND jump to that category's first event
// (they don't filter). External is the only real filter (show/hide). The full Events page (cards/
// lines + all filters) is one click away.
export function CalendarPage({ onOpenEvent, onOpenEventsPage }: { onOpenEvent: (id: string) => void; onOpenEventsPage?: () => void }) {
  const [events, setEvents] = useState<EventListItem[]>([]);
  const [external, setExternal] = useState<EventListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [detail, setDetail] = useState<EventListItem | null>(null);
  const [editingExternal, setEditingExternal] = useState<EventListItem | null>(null); // external → inline edit form
  const [peek, setPeek] = useState<EventListItem | null>(null);                       // internal → detail popup
  const [deleteTarget, setDeleteTarget] = useState<EventListItem | null>(null);
  const [showExternal, setShowExternal] = useState(true); // the one real filter: show/hide external
  const [subtypes, setSubtypes] = useState<Set<string>>(new Set(EXTERNAL_SUBTYPE_TAGS)); // Industry/PE
  const toggleSub = (tag: string) => setSubtypes((prev) => { const n = new Set(prev); n.has(tag) ? n.delete(tag) : n.add(tag); return n; });
  const [jump, setJump] = useState<{ date: string; nonce: number } | null>(null);

  const load = () => {
    setLoading(true);
    Promise.all([listEvents(), listExternalConferences()])
      .then(([e, x]) => { setEvents(e); setExternal(x); })
      .catch(() => {})
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const merged = [...events, ...external];
  // Future/In-Process/Past never filter — only External + its Industry/PE subtypes. Legacy externals
  // with no Ext.* tag always show whenever External is on.
  const shown = showExternal
    ? merged.filter((e) => { if (!e.isExternal) return true; const t = externalTagOf(e.tags); return t ? subtypes.has(t) : true; })
    : events;
  // Click an event → external opens its detail; internal opens a peek popup (Edit → event page, Delete).
  const onOpen = (id: string) => {
    const x = external.find((e) => e.id === id);
    if (x) { setDetail(x); return; }
    const ev = events.find((e) => e.id === id);
    if (ev) setPeek(ev);
  };
  const doDelete = async () => { const t = deleteTarget; if (!t) return; setDeleteTarget(null); try { await deleteEvent(t.id); } catch { /* ignore */ } load(); };

  // Jump the calendar to a category's first event: soonest upcoming for future/in-process, most
  // recent for past. Dated events only.
  const firstOf = (cat: CatKey): string | null => {
    const dated = merged.filter((e) => e.date && categoryOf(e) === cat).map((e) => e.date as string).sort();
    if (!dated.length) return null;
    return cat === "past" ? dated[dated.length - 1] : dated[0];
  };
  const jumpTo = (cat: CatKey) => { const d = firstOf(cat); if (d) setJump((j) => ({ date: d, nonce: (j?.nonce ?? 0) + 1 })); };

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <CalendarDays className="w-6 h-6 text-gray-700" />
        <h1 className="text-2xl">Calendar</h1>
      </div>

      {/* Future / In-Process / Past — a color key that also jumps to that category's first event
          (no filtering). External is the only real filter (show/hide). */}
      <div className="flex flex-wrap items-center gap-2 mb-5">
        {(["future", "in-process", "past"] as CatKey[]).map((k) => {
          const meta = CAT_META.find((m) => m.key === k)!;
          const has = merged.some((e) => e.date && categoryOf(e) === k);
          return (
            <button
              key={k}
              onClick={() => jumpTo(k)}
              disabled={!has}
              title={has ? `Jump to first ${meta.label} event` : `No ${meta.label} events`}
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-white px-2.5 py-1 text-[12px] text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-40 disabled:cursor-default"
            >
              <span className={`w-2 h-2 rounded-full ${meta.dot}`} /> {meta.label}
            </button>
          );
        })}
        <button
          onClick={() => setShowExternal((v) => !v)}
          aria-pressed={showExternal}
          title="Show or hide external events we're attending"
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] transition-colors ${showExternal ? "bg-gray-200 text-gray-900" : "text-gray-500 hover:bg-gray-100"}`}
        >
          <span className="w-2 h-2 rounded-full bg-purple-500" /> External
        </button>
        {showExternal && (["Industry", "PE", "Other"] as ExternalType[]).map((t) => {
          const tag = EXTERNAL_TYPE_TAGS[t];
          const on = subtypes.has(tag);
          return (
            <button
              key={t}
              onClick={() => toggleSub(tag)}
              aria-pressed={on}
              title={`Toggle ${t} external events`}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] transition-colors ${on ? "border-purple-400 bg-purple-50 text-purple-800" : "border-border bg-white text-gray-400 hover:bg-gray-50"}`}
            >
              <span className={`w-2 h-2 rounded-full ${on ? "bg-purple-500" : "bg-purple-200"}`} /> {t}
            </button>
          );
        })}
        <button onClick={() => setAddOpen(true)} title="Add external event" aria-label="Add external event" className="inline-flex items-center gap-1 rounded-full border border-border bg-white px-2 py-1 text-gray-600 hover:bg-gray-50 transition-colors">
          <span className="w-2 h-2 rounded-full bg-purple-500" /><Plus className="w-3 h-3" />
        </button>
      </div>

      {loading ? (
        <p className="text-gray-400 py-12 text-center">Loading…</p>
      ) : (
        <CalendarView
          events={shown}
          onOpen={onOpen}
          jump={jump ?? undefined}
          footerRight={onOpenEventsPage && (
            <button onClick={onOpenEventsPage} className="inline-flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900 border border-border rounded-lg px-3 py-1.5 hover:bg-gray-50 transition-colors">
              <Calendar className="w-4 h-4" /> Events
            </button>
          )}
        />
      )}

      {addOpen && <ExternalConferenceForm onClose={() => setAddOpen(false)} onCreated={() => { setAddOpen(false); load(); }} />}
      {editingExternal && <ExternalConferenceForm existing={editingExternal} onClose={() => setEditingExternal(null)} onCreated={() => { setEditingExternal(null); load(); }} />}
      {detail && (
        <ExternalDetail
          item={detail}
          onClose={() => setDetail(null)}
          onEdit={() => { setEditingExternal(detail); setDetail(null); }}
          onDelete={() => { setDeleteTarget(detail); setDetail(null); }}
        />
      )}
      {peek && (
        <InternalEventPeek
          item={peek}
          onClose={() => setPeek(null)}
          onEdit={() => { const id = peek.id; setPeek(null); onOpenEvent(id); }}
          onDelete={() => { setDeleteTarget(peek); setPeek(null); }}
        />
      )}
      {deleteTarget && (
        <ConfirmModal
          title="Delete event?"
          message={`Permanently delete “${deleteTarget.title}” and everything attached to it. This can’t be undone.`}
          confirmLabel="Delete"
          danger
          onConfirm={() => void doDelete()}
          onClose={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
