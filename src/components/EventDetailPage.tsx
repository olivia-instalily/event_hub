import { Calendar, MapPin, Users, ArrowLeft, AlertCircle, Pencil } from "lucide-react";
import { useEffect, useState } from "react";
import {
  getEventDetail,
  getEventPeopleStats,
  updateEvent,
  updateEventTags,
  addReflection,
  updateReflection,
  deleteReflection,
  addBudgetLine,
  updateBudgetLine,
  deleteBudgetLine,
  type EventDetail,
  type PeopleStats,
  type Reflection,
  type BudgetView,
} from "../lib/db";
import { LabelPicker } from "./LabelPicker";
import { TagStack } from "./TagStack";
import { StatusControl } from "./StatusControl";
import { Trash2, Plus } from "lucide-react";

interface EventDetailPageProps {
  eventId: string;
  onBack: () => void;
  onViewPeople: (filter: { id: string; name: string; tag?: string | null; status?: 'all' | 'registered' | 'checkedIn' | 'waitlisted' }) => void;
}

const NOT_CAPTURED = "Not captured";

function money(n: number | null, currency = "USD"): string {
  if (n == null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format(n);
}

/** Editable carry-forward reflections (series-level). */
function ReflectionsSection({ seriesId, initial }: { seriesId: string | null; initial: Reflection[] }) {
  const [items, setItems] = useState<Reflection[]>(initial);
  const [editId, setEditId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState("");

  const saveEdit = async () => {
    const body = draft.trim();
    if (!editId) return;
    if (!body) { setEditId(null); return; }
    await updateReflection(editId, body);
    setItems((p) => p.map((r) => (r.id === editId ? { ...r, body } : r)));
    setEditId(null);
  };
  const remove = async (id: string) => {
    await deleteReflection(id);
    setItems((p) => p.filter((r) => r.id !== id));
  };
  const add = async () => {
    const body = adding.trim();
    if (!body || !seriesId) return;
    const r = await addReflection(seriesId, body);
    setItems((p) => [...p, r]);
    setAdding("");
  };

  return (
    <div className="bg-white rounded-2xl border border-black divide-y divide-gray-100">
      {items.length === 0 && <p className="px-6 py-4 text-sm text-gray-400">None yet.</p>}
      {items.map((r, i) => (
        <div key={r.id} className="px-6 py-4 text-sm text-gray-700 flex gap-3 group">
          <span className="text-gray-400">{i + 1}.</span>
          {editId === r.id ? (
            <div className="flex-1">
              <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={2} className="w-full px-2 py-1 border border-black rounded text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
              <div className="flex gap-2 mt-1">
                <button onClick={saveEdit} className="px-2 py-1 text-xs bg-gray-200 rounded hover:bg-gray-300">Save</button>
                <button onClick={() => setEditId(null)} className="px-2 py-1 text-xs text-gray-500 hover:text-gray-900">Cancel</button>
              </div>
            </div>
          ) : (
            <>
              <span className="flex-1">{r.body}</span>
              <div className="flex gap-2 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                <button onClick={() => { setEditId(r.id); setDraft(r.body); }} className="text-gray-400 hover:text-gray-900" aria-label="Edit"><Pencil className="w-4 h-4" /></button>
                <button onClick={() => remove(r.id)} className="text-gray-400 hover:text-red-600" aria-label="Delete"><Trash2 className="w-4 h-4" /></button>
              </div>
            </>
          )}
        </div>
      ))}
      {seriesId && (
        <div className="px-6 py-3 flex gap-2">
          <input value={adding} onChange={(e) => setAdding(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add(); }} placeholder="Add a reflection…" className="flex-1 px-2 py-1 border border-black rounded text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
          <button onClick={add} disabled={!adding.trim()} className="px-3 py-1 text-sm bg-gray-200 rounded hover:bg-gray-300 disabled:opacity-50">Add</button>
        </div>
      )}
    </div>
  );
}

/** Editable budget lines; total spend is the live sum of the lines. */
function BudgetSection({ budget, seriesName }: { budget: BudgetView; seriesName: string | null }) {
  const [lines, setLines] = useState(budget.lines);
  const total = lines.reduce((s, l) => s + (l.confirmedAmount ?? 0), 0);

  const setLocal = (id: string, f: Partial<typeof lines[number]>) => setLines((p) => p.map((l) => (l.id === id ? { ...l, ...f } : l)));
  const persist = async (id: string) => {
    const l = lines.find((x) => x.id === id);
    if (!l) return;
    await updateBudgetLine(id, { label: l.label ?? "", amount: l.confirmedAmount });
  };
  const remove = async (id: string) => {
    await deleteBudgetLine(id);
    setLines((p) => p.filter((l) => l.id !== id));
  };
  const add = async () => {
    const nl = await addBudgetLine(budget.id, "New line", 0);
    setLines((p) => [...p, nl]);
  };

  return (
    <div className="bg-white rounded-2xl border border-black p-6">
      <p className="text-sm text-gray-500 mb-4">
        Series-level budget for {seriesName ?? "this series"} — total spend is the sum of the lines below.
      </p>
      <div className="mb-6 pb-6 border-b border-black">
        <p className="text-gray-600 text-sm mb-1">Total spend</p>
        <p className="text-2xl">{money(total, budget.currency)}</p>
      </div>
      <div className="overflow-hidden rounded-lg border border-black">
        <table className="w-full">
          <thead className="bg-gray-50 border-b border-black">
            <tr>
              <th className="text-left px-4 py-3 text-sm text-gray-600">Line</th>
              <th className="text-right px-4 py-3 text-sm text-gray-600">Amount</th>
              <th className="px-4 py-3 w-10"></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <tr key={line.id} className="border-b border-gray-100">
                <td className="px-4 py-2">
                  <input
                    value={line.label ?? ""}
                    onChange={(e) => setLocal(line.id, { label: e.target.value })}
                    onBlur={() => persist(line.id)}
                    className="w-full px-2 py-1 rounded border border-transparent hover:border-gray-200 focus:border-black focus:outline-none text-sm"
                  />
                </td>
                <td className="px-4 py-2 text-right">
                  <input
                    type="number"
                    value={line.confirmedAmount ?? ""}
                    onChange={(e) => setLocal(line.id, { confirmedAmount: e.target.value === "" ? null : Number(e.target.value) })}
                    onBlur={() => persist(line.id)}
                    className="w-32 px-2 py-1 text-right rounded border border-transparent hover:border-gray-200 focus:border-black focus:outline-none text-sm"
                  />
                </td>
                <td className="px-4 py-2 text-center">
                  <button onClick={() => remove(line.id)} className="text-gray-400 hover:text-red-600" aria-label="Delete line"><Trash2 className="w-4 h-4" /></button>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-gray-50 border-t-2 border-gray-300">
            <tr>
              <td className="px-4 py-3 font-bold">Total</td>
              <td className="px-4 py-3 text-right font-bold">{money(total, budget.currency)}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>
      <button onClick={add} className="mt-3 inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900">
        <Plus className="w-4 h-4" /> Add line
      </button>
    </div>
  );
}

export function EventDetailPage({ eventId, onBack, onViewPeople }: EventDetailPageProps) {
  const [event, setEvent] = useState<EventDetail | null>(null);
  const [stats, setStats] = useState<PeopleStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editing, setEditing] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [descInput, setDescInput] = useState("");
  const [formatInput, setFormatInput] = useState("");
  const [audienceInput, setAudienceInput] = useState("");
  const [locationInput, setLocationInput] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  const saveTags = (tags: string[]) => {
    setEvent((e) => (e ? { ...e, tags } : e));
    if (event) void updateEventTags(event.id, tags);
  };

  const startEdit = (e: EventDetail) => {
    setNameInput(e.title);
    setDescInput(e.description ?? "");
    setFormatInput(e.format ?? "");
    setAudienceInput(e.audience ?? "");
    setLocationInput(e.location ?? "");
    setEditing(true);
  };
  const saveEdit = async () => {
    if (!event) return;
    setSavingEdit(true);
    try {
      const name = nameInput.trim() || event.title;
      const description = descInput.trim() || null;
      const format = formatInput.trim() || null;
      const audience = audienceInput.trim() || null;
      const location = locationInput.trim() || null;
      await updateEvent(event.id, { name, description, format, audience, location });
      setEvent({ ...event, title: name, description, format, audience, location });
      setEditing(false);
    } finally {
      setSavingEdit(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([getEventDetail(eventId), getEventPeopleStats(eventId)])
      .then(([e, s]) => { if (!cancelled) { setEvent(e); setStats(s); } })
      .catch((e) => { if (!cancelled) setError(e.message ?? String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [eventId]);

  const back = (
    <button
      onClick={onBack}
      className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-6 transition-colors"
    >
      <ArrowLeft className="w-5 h-5" />
      Back to Events
    </button>
  );

  if (loading) return <div>{back}<p className="text-gray-500 py-12 text-center">Loading event…</p></div>;
  if (error) return <div>{back}<p className="text-red-600 bg-red-50 border border-red-200 rounded-lg p-4">Couldn’t load event: {error}</p></div>;
  if (!event) return <div>{back}<p className="text-gray-500 py-12 text-center">Event not found.</p></div>;

  const b = event.budget;

  return (
    <div>
      {back}

      {/* Event Header */}
      <div className="bg-white rounded-2xl border border-black p-8 mb-6">
        <div className="flex gap-6">
        <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between mb-4">
          {editing ? (
            <div className="flex-1 mr-4">
              <div className="mb-3">
                <TagStack tags={event.tags} editable onChange={saveTags} />
              </div>
              <input
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                className="block w-full text-3xl mb-2 px-2 py-1 border border-black rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-300"
              />
              <textarea
                value={descInput}
                onChange={(e) => setDescInput(e.target.value)}
                rows={3}
                placeholder="Description…"
                className="block w-full text-gray-700 px-2 py-1 border border-black rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-300"
              />
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-2">
                <input value={formatInput} onChange={(e) => setFormatInput(e.target.value)} placeholder="Format" className="px-2 py-1 border border-black rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
                <input value={audienceInput} onChange={(e) => setAudienceInput(e.target.value)} placeholder="Audience" className="px-2 py-1 border border-black rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
                <input value={locationInput} onChange={(e) => setLocationInput(e.target.value)} placeholder="Location" className="px-2 py-1 border border-black rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
              </div>
              <div className="flex items-center gap-2 mt-2">
                <button onClick={saveEdit} disabled={savingEdit} className="px-4 py-1.5 bg-gray-200 text-black rounded-lg text-sm hover:bg-gray-300 disabled:opacity-50">
                  {savingEdit ? "Saving…" : "Save"}
                </button>
                <button onClick={() => setEditing(false)} className="px-4 py-1.5 text-sm text-gray-600 hover:text-gray-900">Cancel</button>
              </div>
            </div>
          ) : (
            <div className="flex-1">
              <div className="mb-3">
                <TagStack tags={event.tags} editable onChange={saveTags} />
              </div>
              <h1 className="text-3xl mb-1">{event.title}</h1>
              {event.seriesName && <p className="text-gray-500 mb-2">part of {event.seriesName}</p>}
              {event.description && <p className="text-gray-700 mb-2 whitespace-pre-wrap">{event.description}</p>}
              {event.format && <p className="text-gray-600 mb-2">{event.format}</p>}
              {event.audience && <p className="text-gray-600 mb-4">{event.audience}</p>}
            </div>
          )}
          {!editing && (
            <button
              onClick={() => startEdit(event)}
              className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900 shrink-0"
            >
              <Pencil className="w-4 h-4" /> Edit
            </button>
          )}
        </div>

        {/* Status + Labels */}
        <div className="mb-3">
          <StatusControl
            eventId={event.id}
            status={event.status}
            eventDate={event.date}
            onChange={(s) => setEvent((e) => (e ? { ...e, status: s } : e))}
          />
        </div>
        <div className="mb-2">
          <LabelPicker
            scope="event"
            itemId={event.id}
            initialLabelIds={event.labelIds}
            onChange={(ids) => setEvent((e) => (e ? { ...e, labelIds: ids } : e))}
          />
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mb-2">
          <div className="flex items-center gap-2 text-gray-600">
            <Calendar className="w-5 h-5" />
            <span>{event.date ?? NOT_CAPTURED}</span>
          </div>
          <div className="flex items-center gap-2 text-gray-600">
            <MapPin className="w-5 h-5" />
            <span>{event.location ?? NOT_CAPTURED}</span>
          </div>
          <button
            onClick={() => onViewPeople({ id: event.id, name: event.title, tag: event.tags[0] ?? null, status: 'checkedIn' })}
            className="flex items-center gap-2 text-gray-600 hover:text-gray-900 transition-colors"
            title="View checked-in people for this event"
          >
            <Users className="w-5 h-5" />
            <span className="underline decoration-dotted underline-offset-4">
              {event.attendeeCount != null ? `${event.attendeeCount} checked in` : NOT_CAPTURED}
            </span>
          </button>
          <div className="text-gray-600">
            <span className="font-medium">Owner:</span> {event.owner ?? NOT_CAPTURED}
          </div>
        </div>

        {event.seriesStatus && (
          <p className="text-sm text-gray-500 mt-4">Macro stage: <span className="font-medium">{event.seriesStatus}</span></p>
        )}
        </div>
        {event.coverImageUrl && (
          <div className="w-56 h-40 shrink-0 self-start rounded-2xl overflow-hidden border border-black">
            <img
              src={event.coverImageUrl}
              alt="event cover"
              className="w-full h-full object-cover"
              style={{ objectPosition: event.coverPosition ?? "50% 50%" }}
            />
          </div>
        )}
        </div>
      </div>

      {/* Project Phases (left) + People stats (right, 2×2) */}
      <div className="flex gap-6 mb-6 items-start">
        <div className="flex-1">
          <h2 className="text-2xl mb-4">Project Phases</h2>
          <div className="bg-white rounded-2xl border border-black p-6 text-gray-500 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 mt-0.5" />
            <span>Pre-event deliverables weren’t itemized — TTW 2026 is a post-hoc recap, so no phase/checkpoint data was captured.</span>
          </div>
        </div>

        <div className="w-96 shrink-0">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-2xl">People</h2>
            <button
              onClick={() => onViewPeople({ id: event.id, name: event.title, tag: event.tags[0] ?? null, status: 'all' })}
              className="text-sm text-gray-600 hover:text-gray-900 underline decoration-dotted underline-offset-4"
            >
              View all →
            </button>
          </div>
          <div className="grid grid-cols-2 gap-4">
            {[
              { label: "Registered", value: stats ? stats.registered : event.rsvp, ring: "ring-blue-400", status: 'registered' as const },
              { label: "Checked in", value: stats ? stats.checkedIn : event.checkedIn, ring: "ring-green-400", status: 'checkedIn' as const },
              { label: "Waitlisted", value: stats ? stats.waitlisted : event.waitlistAdmitted, ring: "ring-amber-400", status: 'waitlisted' as const },
              { label: "Total guests", value: stats ? stats.total : null, ring: "ring-gray-300", status: 'all' as const },
            ].map((tile) => (
              <button
                key={tile.label}
                onClick={() => onViewPeople({ id: event.id, name: event.title, tag: event.tags[0] ?? null, status: tile.status })}
                className={`bg-white rounded-2xl ring-2 ring-inset ${tile.ring} p-5 text-left hover:shadow-md transition-shadow`}
              >
                <p className="text-gray-500 text-sm mb-1">{tile.label}</p>
                <p className="text-2xl">{tile.value != null ? tile.value.toLocaleString() : "—"}</p>
              </button>
            ))}
          </div>
          {event.actualAttendanceNote && (
            <p className="text-sm text-gray-500 mt-3 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 mt-0.5" />
              {event.actualAttendanceNote}
            </p>
          )}
        </div>
      </div>

      {/* Reflections (carry-forward lessons) — editable */}
      <div className="mb-6">
        <h2 className="text-2xl mb-4">Reflections</h2>
        <ReflectionsSection seriesId={event.seriesId} initial={event.reflections} />
      </div>

      {/* Budget — series-level, editable; total derived from lines */}
      {b && (
        <div>
          <h2 className="text-2xl mb-4">Budget &amp; Expenses</h2>
          <BudgetSection budget={b} seriesName={event.seriesName} />
        </div>
      )}
    </div>
  );
}
