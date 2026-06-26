import { Calendar, Users, ChevronLeft, AlertCircle, Pencil, Mic } from "lucide-react";
import { LocationEdit, LocationInput } from "./LocationEdit";
import { SourceMaterials } from "./SourceMaterials";
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
import { TagStack } from "./TagStack";
import { FormatPicker, parseFormats, joinFormats } from "./FormatPicker";
import { StatusControl } from "./StatusControl";
import { CoverImage } from "./CoverImage";
import { OwnerPicker } from "./OwnerPicker";
import { Trash2, Plus } from "lucide-react";
import { StatCard } from "./StatCard";

interface EventDetailPageProps {
  eventId: string;
  onBack: () => void;
  onViewPeople: (filter: { id: string; name: string; tag?: string | null; status?: 'all' | 'registered' | 'checkedIn' | 'waitlisted' | 'speakers' }) => void;
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
    <div className="bg-white rounded-2xl border border-border divide-y divide-gray-100">
      {items.length === 0 && <p className="px-6 py-4 text-sm text-gray-400">None yet.</p>}
      {items.map((r, i) => (
        <div key={r.id} className="px-6 py-4 text-sm text-gray-700 flex gap-3 group">
          <span className="text-gray-400">{i + 1}.</span>
          {editId === r.id ? (
            <div className="flex-1">
              <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={2} className="w-full px-2 py-1 border border-border rounded text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
              <div className="flex gap-2 mt-1">
                <button onClick={saveEdit} className="px-2 py-1 text-[15px] bg-gray-200 rounded hover:bg-gray-300">Save</button>
                <button onClick={() => setEditId(null)} className="px-2 py-1 text-[15px] text-gray-500 hover:text-gray-900">Cancel</button>
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
          <input value={adding} onChange={(e) => setAdding(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add(); }} placeholder="Add a reflection…" className="flex-1 px-2 py-1 border border-border rounded text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
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
    <div className="bg-white rounded-2xl border border-border p-6">
      <p className="text-sm text-gray-500 mb-4">
        Series-level budget for {seriesName ?? "this series"} — total spend is the sum of the lines below.
      </p>
      <div className="mb-6 pb-6 border-b border-border">
        <p className="text-gray-600 text-sm mb-1">Total spend</p>
        <p className="text-2xl">{money(total, budget.currency)}</p>
      </div>
      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full">
          <thead className="bg-gray-50 border-b border-border">
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
                    className="w-full px-2 py-1 rounded border border-transparent hover:border-gray-200 focus:border-border focus:outline-none text-sm"
                  />
                </td>
                <td className="px-4 py-2 text-right">
                  <input
                    type="number"
                    value={line.confirmedAmount ?? ""}
                    onChange={(e) => setLocal(line.id, { confirmedAmount: e.target.value === "" ? null : Number(e.target.value) })}
                    onBlur={() => persist(line.id)}
                    className="w-32 px-2 py-1 text-right rounded border border-transparent hover:border-gray-200 focus:border-border focus:outline-none text-sm"
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
  // Format is a separate spec (the multi-select format list), not the tag. Persists immediately.
  const saveFormat = (arr: string[]) => {
    const format = joinFormats(arr);
    setEvent((e) => (e ? { ...e, format } : e));
    if (event) void updateEvent(event.id, { format });
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

  // Sized/styled to match the Events status pills (Future/In-Process/Past) so the top-left
  // control stays in the same place and size when switching between the list and an event.
  const back = (
    <button
      onClick={onBack}
      className="inline-flex items-center gap-1 mb-6 px-2 py-1 rounded-lg bg-white border border-border text-gray-700 hover:bg-gray-50 transition-colors"
    >
      <ChevronLeft className="w-4 h-4" />
      Previous
    </button>
  );

  if (loading) return <div>{back}<p className="text-gray-500 py-12 text-center">Loading event…</p></div>;
  if (error) return <div>{back}<p className="text-red-600 bg-red-50 border border-red-200 rounded-lg p-4">Couldn’t load event: {error}</p></div>;
  if (!event) return <div>{back}<p className="text-gray-500 py-12 text-center">Event not found.</p></div>;

  const b = event.budget;

  return (
    <div>
      {back}

      <SourceMaterials items={event.sourceMaterials} className="mb-6" />

      {/* Event Header */}
      <div className="bg-white rounded-2xl border border-border p-8 mb-6">
        <div className="header-row flex gap-10">
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
                className="block w-full text-3xl mb-2 px-2 py-1 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-300"
              />
              <textarea
                value={descInput}
                onChange={(e) => setDescInput(e.target.value)}
                rows={3}
                placeholder="Description…"
                className="block w-full text-gray-700 px-2 py-1 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-300"
              />
              <div className="mt-2"><FormatPicker value={parseFormats(formatInput)} onChange={(arr) => setFormatInput(joinFormats(arr) ?? "")} /></div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
                <input value={audienceInput} onChange={(e) => setAudienceInput(e.target.value)} placeholder="Audience" className="px-2 py-1 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
                <LocationInput value={locationInput} onChange={setLocationInput} className="px-2 py-1 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
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
              <div className="mb-2"><FormatPicker value={parseFormats(event.format)} onChange={saveFormat} /></div>
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

        {/* Status */}
        <div className="mb-3">
          <StatusControl
            eventId={event.id}
            status={event.status}
            eventDate={event.date}
            onChange={(s) => setEvent((e) => (e ? { ...e, status: s } : e))}
          />
        </div>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 mb-2 text-gray-600">
          <div className="flex items-center gap-2">
            <Calendar className="w-5 h-5" />
            <span>{event.date ?? NOT_CAPTURED}</span>
          </div>
          <LocationEdit value={event.location} onChange={(location) => { setEvent({ ...event, location }); void updateEvent(event.id, { location }); }} />
          <button
            onClick={() => onViewPeople({ id: event.id, name: event.title, tag: event.tags[0] ?? null, status: 'checkedIn' })}
            className="flex items-center gap-2 hover:text-gray-900 transition-colors"
            title="View checked-in people for this event"
          >
            <Users className="w-5 h-5" />
            <span className="underline decoration-dotted underline-offset-4">
              {event.attendeeCount != null ? `${event.attendeeCount} checked in` : NOT_CAPTURED}
            </span>
          </button>
          <button
            onClick={() => onViewPeople({ id: event.id, name: event.title, tag: event.tags[0] ?? null, status: 'speakers' })}
            className="flex items-center gap-2 hover:text-gray-900 transition-colors"
          >
            <Mic className="w-5 h-5" />
            <span className="underline decoration-dotted underline-offset-4">Speakers</span>
          </button>
          <OwnerPicker eventId={event.id} owners={event.owners} onChange={(owners) => setEvent((ev) => (ev ? { ...ev, owners, owner: owners.map((o) => o.name).join(", ") || null } : ev))} />
        </div>

        {event.seriesStatus && (
          <p className="text-sm text-gray-500 mt-4">Macro stage: <span className="font-medium">{event.seriesStatus}</span></p>
        )}
        </div>
        <CoverImage
          eventId={event.id}
          cover={event.coverImageUrl}
          lumaCover={event.lumaCoverUrl}
          customCover={event.customCoverUrl}
          position={event.coverPosition}
          onChange={(patch) => setEvent((ev) => (ev ? { ...ev, coverImageUrl: patch.cover, ...(patch.custom !== undefined ? { customCoverUrl: patch.custom } : {}) } : ev))}
        />
        </div>
      </div>

      {/* Project Phases (left) + People stats (right, 2×2) */}
      <div className="flex gap-6 mb-6 items-start">
        <div className="flex-1">
          <h2 className="text-2xl mb-4">Project Phases</h2>
          <div className="bg-white rounded-2xl border border-border p-6 text-gray-500 flex items-start gap-2">
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
              <StatCard
                key={tile.label}
                label={tile.label}
                value={tile.value != null ? tile.value.toLocaleString() : "—"}
                onClick={() => onViewPeople({ id: event.id, name: event.title, tag: event.tags[0] ?? null, status: tile.status })}
              />
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
