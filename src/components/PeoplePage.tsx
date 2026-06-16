import { useEffect, useState } from "react";
import { ChevronLeft, Search, ChevronDown, Users, LayoutGrid, List, X, ExternalLink, Download, User, Mic, Plus } from "lucide-react";
import {
  listAllAttendees,
  listAttendeesForEvent,
  getPersonEvents,
  updateAttendee,
  addAttendee,
  setAttendeePhoto,
  setSpeakerRole,
  removeAttendeeFromEvent,
  listNotes,
  addNote,
  tallyStats,
  listLabels,
  createLabel,
  exportPeople,
  type PersonView,
  type PersonEvent,
  type Note,
  type Label,
} from "../lib/db";
import { tagColor } from "../lib/tags";
import { downloadCsv } from "../lib/csv";
import { LabelPicker } from "./LabelPicker";
import { FileDrop } from "./FileDrop";
import { Modal, PromptModal, ConfirmModal } from "./Modal";
import { useProfile } from "../lib/profile";

type TileFilter = 'all' | 'registered' | 'checkedIn' | 'waitlisted' | 'speakers';

interface PeoplePageProps {
  eventFilter?: { id: string; name: string; tag?: string | null; status?: TileFilter } | null;
  onBack?: () => void;
}

const PERSON_TYPES = ["Hire", "Partner", "ICP", "Unknown", "Client", "Investor"] as const;

function typeColor(type: string | null): string {
  switch (type) {
    case "Partner": return "bg-orange-100 text-orange-700";
    case "Hire": return "bg-green-100 text-green-700";
    case "Client": return "bg-blue-100 text-blue-700";
    case "Investor": return "bg-purple-100 text-purple-700";
    case "ICP": return "bg-teal-100 text-teal-700";
    default: return "bg-gray-100 text-gray-600"; // Unknown — light gray
  }
}

function statusBadge(status: string | null | undefined, checkedIn: boolean | undefined) {
  if (checkedIn) return <span className="inline-block px-2 py-1 rounded text-xs bg-green-100 text-green-700">Checked in</span>;
  switch ((status ?? "").toLowerCase()) {
    case "approved": return <span className="inline-block px-2 py-1 rounded text-xs bg-blue-100 text-blue-700">Registered</span>;
    case "waitlist": return <span className="inline-block px-2 py-1 rounded text-xs bg-amber-100 text-amber-700">Waitlisted</span>;
    case "pending":
    case "pending_approval": return <span className="inline-block px-2 py-1 rounded text-xs bg-gray-100 text-gray-600">Pending</span>;
    case "invited": return <span className="inline-block px-2 py-1 rounded text-xs bg-gray-100 text-gray-600">Invited</span>;
    case "declined": return <span className="inline-block px-2 py-1 rounded text-xs bg-red-100 text-red-700">Declined</span>;
    default: return <span className="inline-block px-2 py-1 rounded text-xs bg-gray-100 text-gray-500">—</span>;
  }
}

function displayName(p: PersonView): string {
  if (p.isAggregate) return `~${p.countEst ?? "?"} candidates (aggregate)`;
  return p.name ?? "Unknown";
}

/** Repeat-attendee badge — same everywhere (global + event-filtered lists). */
function MultiEventBadge({ count }: { count: number }) {
  if (count < 2) return null;
  return <span className="px-1.5 py-0.5 rounded-full text-xs bg-gray-900 text-white" title={`Attended ${count} events`}>{count}×</span>;
}

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000), h = Math.floor(m / 60), d = Math.floor(h / 24);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  if (h < 24) return `${h}h ago`;
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

function Field({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div>
      <dt className="text-xs text-gray-500">{label}</dt>
      <dd className="text-sm text-gray-800">{value}</dd>
    </div>
  );
}

/** Slide-over with a person's profile, cross-event history, and editable context. */
function PersonDetail({
  person,
  eventId,
  onClose,
  onSaved,
  onRemoved,
  onLabelsChange,
}: {
  person: PersonView;
  eventId: string | null;
  onClose: () => void;
  onSaved: (patch: Partial<PersonView>) => void;
  onRemoved: () => void;
  onLabelsChange: (labelIds: string[]) => void;
}) {
  const { current: currentProfile } = useProfile();
  const [events, setEvents] = useState<PersonEvent[] | null>(null);
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [newNote, setNewNote] = useState("");
  const [posting, setPosting] = useState(false);
  const [linkedin, setLinkedin] = useState(person.linkedinUrl ?? "");
  const [photo, setPhoto] = useState(person.photoUrl);
  const [isSpeaker, setIsSpeaker] = useState(person.role === "speaker");
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const uploadPhoto = async (url: string) => { setPhoto(url); await setAttendeePhoto(person.id, url); onSaved({ photoUrl: url }); };
  const toggleSpeaker = async () => {
    if (!eventId) return;
    const next = !isSpeaker;
    setIsSpeaker(next);
    await setSpeakerRole(eventId, person.id, next);
    onSaved({ role: next ? "speaker" : "attendee" });
  };
  const doRemove = async () => {
    if (!eventId) return;
    await removeAttendeeFromEvent(eventId, person.id);
    onRemoved();
  };

  useEffect(() => {
    let cancelled = false;
    getPersonEvents(person.id).then((e) => { if (!cancelled) setEvents(e); }).catch(() => { if (!cancelled) setEvents([]); });
    listNotes(person.id).then((n) => { if (!cancelled) setNotes(n); }).catch(() => { if (!cancelled) setNotes([]); });
    return () => { cancelled = true; };
  }, [person.id]);

  const linkedinDirty = linkedin !== (person.linkedinUrl ?? "");

  const save = async () => {
    setSaving(true);
    try {
      const linkedinUrl = linkedin.trim() || null;
      await updateAttendee(person.id, { linkedinUrl });
      onSaved({ linkedinUrl });
      setSavedAt(true);
      setTimeout(() => setSavedAt(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  const postNote = async () => {
    const body = newNote.trim();
    if (!body) return;
    setPosting(true);
    try {
      // Attributed to the current profile (the pre-auth "current user").
      const created = await addNote(person.id, body, currentProfile?.name ?? null);
      setNotes((prev) => [...(prev ?? []), created]);
      setNewNote("");
    } finally {
      setPosting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <div className="w-full max-w-md h-full bg-white shadow-xl overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="p-6">
          <div className="flex items-start justify-between mb-4">
            <div className="flex items-start gap-3 min-w-0">
              <div className="shrink-0">
                {photo
                  ? <img src={photo} alt="" className="w-14 h-14 rounded-full object-cover" />
                  : <div className="w-14 h-14 rounded-full bg-gray-100 flex items-center justify-center text-gray-400"><User className="w-6 h-6" /></div>}
              </div>
              <div className="min-w-0">
                {person.type && person.type !== "Unknown" && (
                  <span className={`inline-block px-3 py-1 rounded-full text-sm ${typeColor(person.type)}`}>{person.type}</span>
                )}
                <h2 className="text-2xl mt-2">{displayName(person)}</h2>
                {person.title && <p className="text-gray-600">{person.title}{person.org ? ` · ${person.org}` : ""}</p>}
                <div className="mt-2 flex items-center gap-2 flex-wrap">
                  <FileDrop compact label="photo" onUploaded={(url) => uploadPhoto(url)} />
                  {eventId && (
                    <button onClick={toggleSpeaker} className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs border transition-colors ${isSpeaker ? "bg-gray-900 text-white border-gray-900" : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"}`}>
                      <Mic className="w-3 h-3" /> {isSpeaker ? "Speaker for this event" : "Mark as speaker"}
                    </button>
                  )}
                  {eventId && (
                    <button onClick={() => setConfirmRemove(true)} title="Remove from event" aria-label="Remove from event" className="w-6 h-6 rounded-full border border-red-300 text-red-500 hover:bg-red-50 flex items-center justify-center shrink-0">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            </div>
            <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-900 shrink-0" aria-label="Close">
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Profile */}
          <dl className="grid grid-cols-2 gap-3 mb-6">
            <Field label="Email" value={person.email} />
            <Field label="School" value={person.school} />
            <Field label="City" value={person.city} />
            <Field label="Industry" value={person.industry} />
          </dl>

          {/* LinkedIn */}
          <div className="mb-6">
            <label className="text-xs text-gray-500 block mb-1">LinkedIn</label>
            {linkedin && (
              <a href={linkedin} target="_blank" rel="noreferrer" className="text-sm text-blue-600 hover:underline inline-flex items-center gap-1 mb-1">
                {linkedin} <ExternalLink className="w-3 h-3" />
              </a>
            )}
            <div className="flex gap-2">
              <input
                type="url"
                placeholder="https://linkedin.com/in/…"
                value={linkedin}
                onChange={(e) => setLinkedin(e.target.value)}
                className="flex-1 min-w-0 px-3 py-2 border border-black rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-300"
              />
              <button
                onClick={save}
                disabled={!linkedinDirty || saving}
                className="shrink-0 px-3 py-2 bg-gray-200 text-black rounded-lg text-sm hover:bg-gray-300 disabled:opacity-50"
              >
                {saving ? "…" : "Save"}
              </button>
            </div>
            {savedAt && <span className="text-xs text-green-600">Saved</span>}
          </div>

          {/* Labels */}
          <div className="mb-6">
            <h3 className="text-sm font-medium text-gray-700 mb-2">Labels</h3>
            <LabelPicker scope="person" itemId={person.id} initialLabelIds={person.labelIds} onChange={onLabelsChange} />
          </div>

          {/* Events attended */}
          <div className="mb-6">
            <h3 className="text-sm font-medium text-gray-700 mb-2">Events attended</h3>
            {events === null ? (
              <p className="text-sm text-gray-400">Loading…</p>
            ) : events.length === 0 ? (
              <p className="text-sm text-gray-400">None.</p>
            ) : (
              <div className="space-y-2">
                {events.map((e) => (
                  <div key={e.eventId} className="border border-black rounded-lg p-3">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-sm">{e.eventName}</span>
                      {e.tag && <span className={`px-2 py-0.5 rounded-full text-xs ${tagColor(e.tag)}`}>{e.tag}</span>}
                    </div>
                    <div className="flex items-center gap-2 mt-1 text-xs text-gray-500">
                      {e.role !== "attendee" && <span className="capitalize">{e.role}</span>}
                      {statusBadge(e.registrationStatus, e.checkedIn)}
                      {e.date && <span>{e.date}</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Notes / context — append-only thread */}
          <div>
            <h3 className="text-sm font-medium text-gray-700 mb-3">Notes &amp; context</h3>
            {notes === null ? (
              <p className="text-sm text-gray-400 mb-3">Loading…</p>
            ) : notes.length === 0 ? (
              <p className="text-sm text-gray-400 mb-3">No notes yet.</p>
            ) : (
              <div className="mb-3">
                {notes.map((n, i) => (
                  <div key={n.id} className="relative flex gap-3 pb-4">
                    {i < notes.length - 1 && (
                      <span className="absolute left-3 top-7 -bottom-0 w-px bg-gray-200" aria-hidden />
                    )}
                    <span
                      title={n.contributor ?? "Unknown contributor"}
                      className="relative z-10 shrink-0 w-6 h-6 rounded-full bg-gray-200 text-gray-600 text-[10px] font-medium flex items-center justify-center"
                    >
                      {n.contributor ? n.contributor.slice(0, 1).toUpperCase() : <User className="w-3 h-3" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs text-gray-500">
                        <span className="font-medium text-gray-700">{n.contributor ?? "Unknown"}</span> · {relTime(n.createdAt)}
                      </div>
                      <p className="text-sm text-gray-800 whitespace-pre-wrap break-words">{n.body}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <textarea
              rows={2}
              placeholder="Add a note…"
              value={newNote}
              onChange={(e) => setNewNote(e.target.value)}
              className="w-full px-3 py-2 border border-black rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-300"
            />
            <div className="flex justify-end mt-2">
              <button
                onClick={postNote}
                disabled={!newNote.trim() || posting}
                className="px-4 py-2 bg-gray-200 text-black rounded-lg text-sm hover:bg-gray-300 disabled:opacity-50 transition-colors"
              >
                {posting ? "Adding…" : "Add note"}
              </button>
            </div>
          </div>
        </div>
      </div>
      {confirmRemove && (
        <ConfirmModal
          title="Remove from event"
          message={`Remove ${displayName(person)} from this event?`}
          confirmLabel="Remove"
          danger
          onConfirm={() => void doRemove()}
          onClose={() => setConfirmRemove(false)}
        />
      )}
    </div>
  );
}

// App-styled "add person" dialog. Only adds to an event (people live under an event).
function AddPersonModal({ eventFilter, onClose, onAdded }: {
  eventFilter: { id: string; name: string } | null;
  onClose: () => void;
  onAdded: (p: PersonView) => void;
}) {
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [org, setOrg] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);

  if (!eventFilter) {
    return (
      <Modal title="Add person" onClose={onClose} maxWidth="max-w-sm">
        <p className="text-sm text-gray-600">Open an event's People view to add a person to it.</p>
        <div className="flex justify-end mt-5"><button onClick={onClose} className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 hover:bg-gray-50">Close</button></div>
      </Modal>
    );
  }

  const submit = async () => {
    const n = name.trim();
    if (!n) return;
    setBusy(true);
    try {
      const p = await addAttendee(eventFilter.id, { name: n, title: title.trim() || null, org: org.trim() || null, email: email.trim() || null });
      onAdded(p);
      onClose();
    } finally { setBusy(false); }
  };

  const field = "w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-300";
  return (
    <Modal title={`Add person to ${eventFilter.name}`} onClose={onClose}>
      <div className="space-y-2">
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void submit(); }} placeholder="Name (required)" className={field} />
        <div className="flex gap-2">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" className={field} />
          <input value={org} onChange={(e) => setOrg(e.target.value)} placeholder="Organization" className={field} />
        </div>
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" className={field} />
      </div>
      <div className="flex justify-end gap-2 mt-5">
        <button onClick={onClose} className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 hover:bg-gray-50">Cancel</button>
        <button onClick={() => void submit()} disabled={busy || !name.trim()} className="px-3 py-1.5 text-sm rounded-lg bg-gray-900 text-white hover:bg-gray-800 disabled:opacity-50">{busy ? "Adding…" : "Add person"}</button>
      </div>
    </Modal>
  );
}

export function PeoplePage({ eventFilter, onBack }: PeoplePageProps) {
  const [people, setPeople] = useState<PersonView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [multiOnly, setMultiOnly] = useState(false);
  const [dateRange, setDateRange] = useState<'all' | 'week' | 'month' | '3months' | 'year'>('all');
  const [viewMode, setViewMode] = useState<'cards' | 'lines'>('cards');
  const [tileFilter, setTileFilter] = useState<TileFilter>(eventFilter?.status ?? 'all');

  // Re-apply the incoming status when navigating in from a different event/tile.
  useEffect(() => { setTileFilter(eventFilter?.status ?? 'all'); }, [eventFilter?.id, eventFilter?.status]);
  const [selectedPerson, setSelectedPerson] = useState<PersonView | null>(null);
  const [labels, setLabels] = useState<Label[]>([]);
  const [labelFilter, setLabelFilter] = useState<string>("all");
  const [addOpen, setAddOpen] = useState(false);
  const [newLabelOpen, setNewLabelOpen] = useState(false);

  useEffect(() => { listLabels("person").then(setLabels).catch(() => {}); }, []);

  const createNewLabel = async (name: string) => {
    const lbl = await createLabel(name, 'person');
    setLabels((prev) => [...prev, lbl].sort((a, b) => a.name.localeCompare(b.name)));
    setLabelFilter(lbl.id);
  };

  const exportLabel = async () => {
    const label = labels.find((l) => l.id === labelFilter);
    if (!label) return;
    downloadCsv(`${label.name}-people.csv`, await exportPeople(label.id));
  };

  const applyPatch = (patch: Partial<PersonView>) => {
    if (!selectedPerson) return;
    const id = selectedPerson.id;
    setPeople((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
    setSelectedPerson((prev) => (prev ? { ...prev, ...patch } : prev));
  };

  const onPersonAdded = (p: PersonView) => { setPeople((prev) => [p, ...prev]); setSelectedPerson(p); };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const work = eventFilter
      ? listAttendeesForEvent(eventFilter.id).then((ppl) => { if (!cancelled) setPeople(ppl); })
      : listAllAttendees().then((ppl) => { if (!cancelled) setPeople(ppl); });
    work.catch((e) => { if (!cancelled) setError(e.message ?? String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [eventFilter?.id]);

  // Aggregate placeholder records never show in the people list.
  const visiblePeople = people.filter((p) => !p.isAggregate);

  // Date-range cutoff (all-people view only).
  const todayStr = new Date().toISOString().slice(0, 10);
  const cutoffStr = (() => {
    const days = { week: 7, month: 30, '3months': 90, year: 365 }[dateRange as Exclude<typeof dateRange, 'all'>];
    if (!days) return null;
    const d = new Date();
    d.setDate(d.getDate() - days);
    return d.toISOString().slice(0, 10);
  })();

  const filtered = visiblePeople.filter((p) => {
    const q = searchQuery.toLowerCase();
    const matches = !q ||
      (p.name ?? "").toLowerCase().includes(q) ||
      (p.org ?? "").toLowerCase().includes(q) ||
      (p.title ?? "").toLowerCase().includes(q);
    if (!matches) return false;
    if (typeFilter !== "all" && p.type !== typeFilter) return false;
    if (labelFilter !== "all" && !p.labelIds.includes(labelFilter)) return false;
    if (multiOnly && p.eventsCount < 2) return false;
    if (cutoffStr && !p.eventDates.some((d) => d >= cutoffStr && d <= todayStr)) return false;
    // Status tile filter (event-scoped only).
    if (eventFilter && tileFilter !== "all") {
      const s = (p.registrationStatus ?? "").toLowerCase();
      if (tileFilter === "speakers" && p.role !== "speaker") return false;
      if (tileFilter === "checkedIn" && !p.checkedIn) return false;
      if (tileFilter === "registered" && s !== "approved") return false;
      if (tileFilter === "waitlisted" && s !== "waitlist") return false;
    }
    return true;
  });

  // Tiles reflect the LIVE Luma counts (computed from the full event list, not the search subset).
  const stats = eventFilter ? tallyStats(visiblePeople) : null;
  const tiles: { label: string; value: number; filter: TileFilter; ring: string }[] | null = stats && [
    { label: "Registered", value: stats.registered, filter: "registered", ring: "ring-blue-400" },
    { label: "Checked in", value: stats.checkedIn, filter: "checkedIn", ring: "ring-green-400" },
    { label: "Waitlisted", value: stats.waitlisted, filter: "waitlisted", ring: "ring-amber-400" },
    { label: "Total guests", value: stats.total, filter: "all", ring: "ring-gray-300" },
  ];

  return (
    <div>
      {/* Header */}
      {eventFilter ? (
        <div className="mb-6">
          {onBack && (
            <button
              onClick={onBack}
              className="inline-flex items-center gap-1 mb-4 px-3 py-1.5 bg-white border border-black rounded-lg text-black hover:bg-gray-50 transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
              Previous
            </button>
          )}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Users className="w-6 h-6 text-gray-500" />
              <h2 className="text-2xl">People · {eventFilter.name}</h2>
            </div>
            <button onClick={() => setAddOpen(true)} className="inline-flex items-center gap-1 px-3 py-1.5 bg-gray-200 rounded-lg text-sm hover:bg-gray-300"><Plus className="w-4 h-4" /> Add person</button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2 mb-6">
          <Users className="w-6 h-6 text-gray-500" />
          <h2 className="text-2xl">People</h2>
        </div>
      )}

      {/* Stat tiles (event-filtered only) — click to filter the list by status.
          Inner outline is colored to match the event's tag. */}
      {tiles && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          {tiles.map((t) => {
            const active = tileFilter === t.filter;
            return (
              <button
                key={t.label}
                onClick={() => setTileFilter(active && t.filter !== "all" ? "all" : t.filter)}
                className={`bg-white rounded-2xl p-5 text-left transition-shadow ring-2 ring-inset ${t.ring} ${active ? "shadow-md bg-gray-50" : "hover:shadow-md"}`}
              >
                <p className="text-gray-500 text-sm mb-1">{t.label}</p>
                <p className="text-2xl">{t.value != null ? t.value.toLocaleString() : "—"}</p>
              </button>
            );
          })}
        </div>
      )}

      {/* Search + type filter + view toggle */}
      <div className="flex items-center justify-between gap-3 mb-6">
        <div className="flex flex-wrap gap-3">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search people…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 pr-4 py-2 bg-white border border-black rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-300"
            />
          </div>
          <div className="relative">
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="appearance-none px-4 py-2 pr-10 bg-white border border-black rounded-lg text-sm hover:bg-gray-50 cursor-pointer"
            >
              <option value="all">All Types</option>
              {PERSON_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <ChevronDown className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          </div>
          <div className="relative">
            <select
              value={labelFilter}
              onChange={(e) => {
                if (e.target.value === '__create__') { setNewLabelOpen(true); return; }
                setLabelFilter(e.target.value);
              }}
              className="appearance-none px-4 py-2 pr-10 bg-white border border-black rounded-lg text-sm hover:bg-gray-50 cursor-pointer"
            >
              <option value="all">All Labels</option>
              {labels.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              <option value="__create__">+ Create label…</option>
            </select>
            <ChevronDown className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          </div>
          <button
            onClick={() => setMultiOnly((v) => !v)}
            title="Only people who attended 2+ events"
            className={`px-3 py-2 rounded-lg text-sm border border-black transition-colors ${multiOnly ? 'bg-gray-200 text-black' : 'bg-white text-gray-700 hover:bg-gray-50'}`}
          >
            Multiple events
          </button>
          {!eventFilter && (
            <div className="relative">
              <select
                value={dateRange}
                onChange={(e) => setDateRange(e.target.value as typeof dateRange)}
                className="appearance-none px-4 py-2 pr-10 bg-white border border-black rounded-lg text-sm hover:bg-gray-50 cursor-pointer"
              >
                <option value="all">Any time</option>
                <option value="week">Past week</option>
                <option value="month">Past month</option>
                <option value="3months">Past 3 months</option>
                <option value="year">Past year</option>
              </select>
              <ChevronDown className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          {labelFilter !== "all" && (
            <button
              onClick={exportLabel}
              className="flex items-center gap-2 px-3 py-2 bg-white border border-black rounded-lg text-sm hover:bg-gray-50"
            >
              <Download className="w-4 h-4" /> Export
            </button>
          )}
        <div className="flex gap-2 bg-white border border-black rounded-lg p-1">
          <button
            onClick={() => setViewMode('cards')}
            className={`p-2 rounded transition-colors ${viewMode === 'cards' ? 'bg-gray-100' : 'hover:bg-gray-50'}`}
          >
            <LayoutGrid className="w-4 h-4" />
          </button>
          <button
            onClick={() => setViewMode('lines')}
            className={`p-2 rounded transition-colors ${viewMode === 'lines' ? 'bg-gray-100' : 'hover:bg-gray-50'}`}
          >
            <List className="w-4 h-4" />
          </button>
        </div>
        </div>
      </div>

      {/* Result count */}
      {!loading && !error && (
        <p className="text-sm text-gray-500 mb-3">{filtered.length.toLocaleString()} {filtered.length === 1 ? 'person' : 'people'}</p>
      )}

      {/* States */}
      {loading && <p className="text-gray-500 py-12 text-center">Loading people…</p>}
      {error && (
        <p className="text-red-600 bg-red-50 border border-red-200 rounded-lg p-4">Couldn’t load people: {error}</p>
      )}
      {!loading && !error && filtered.length === 0 && (
        <p className="text-gray-500 py-12 text-center">
          {eventFilter ? "No attendees linked to this event yet. Run the Luma sync to populate." : "No people yet."}
        </p>
      )}

      {/* Cards — narrower, 3–4 per row */}
      {!loading && !error && filtered.length > 0 && viewMode === 'cards' && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
          {filtered.map((p) => (
            <div
              key={p.id}
              onClick={() => setSelectedPerson(p)}
              className="bg-white rounded-xl border border-black p-4 flex flex-col cursor-pointer hover:shadow-md transition-shadow"
            >
              <div className="flex items-center justify-between mb-2">
                {p.type && p.type !== "Unknown"
                  ? <span className={`inline-block px-2 py-0.5 rounded-full text-xs ${typeColor(p.type)}`}>{p.type}</span>
                  : <span />}
                <div className="flex items-center gap-1">
                  <MultiEventBadge count={p.eventsCount} />
                  {eventFilter && statusBadge(p.registrationStatus, p.checkedIn)}
                </div>
              </div>

              <h3 className="text-base font-medium leading-tight">{displayName(p)}</h3>
              {p.role && p.role !== "attendee" && (
                <p className="text-xs text-gray-500 capitalize">{p.role}</p>
              )}
              {p.title && <p className="text-sm text-gray-600 mt-1 truncate">{p.title}</p>}
              {p.org && <p className="text-sm text-gray-500 truncate">{p.org}</p>}
              {p.email && <p className="text-xs text-gray-400 mt-1 truncate">{p.email}</p>}
              {p.note && <p className="text-xs text-gray-500 mt-2 line-clamp-3">{p.note}</p>}
            </div>
          ))}
        </div>
      )}

      {/* Lines / table view */}
      {!loading && !error && filtered.length > 0 && viewMode === 'lines' && (
        <div className="bg-white rounded-2xl border border-black overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-black">
              <tr>
                <th className="text-left px-6 py-3 text-sm text-gray-600">Name</th>
                <th className="text-left px-6 py-3 text-sm text-gray-600">Type</th>
                <th className="text-left px-6 py-3 text-sm text-gray-600">{eventFilter ? "Status" : "Events"}</th>
                <th className="text-left px-6 py-3 text-sm text-gray-600">Title</th>
                <th className="text-left px-6 py-3 text-sm text-gray-600">Org</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p.id} onClick={() => setSelectedPerson(p)} className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer">
                  <td className="px-6 py-3">
                    <p className="font-medium">{displayName(p)}</p>
                    {p.role && p.role !== "attendee" && <p className="text-xs text-gray-500 capitalize">{p.role}</p>}
                  </td>
                  <td className="px-6 py-3">
                    {p.type && p.type !== "Unknown" && <span className={`inline-block px-2 py-0.5 rounded-full text-xs ${typeColor(p.type)}`}>{p.type}</span>}
                  </td>
                  <td className="px-6 py-3 text-sm">
                    <span className="inline-flex items-center gap-1.5">
                      {eventFilter && statusBadge(p.registrationStatus, p.checkedIn)}
                      <MultiEventBadge count={p.eventsCount} />
                      {!eventFilter && p.eventsCount < 2 && <span className="text-gray-600">{p.eventsCount}</span>}
                    </span>
                  </td>
                  <td className="px-6 py-3 text-sm text-gray-600">{p.title ?? "—"}</td>
                  <td className="px-6 py-3 text-sm text-gray-600">{p.org ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selectedPerson && (
        <PersonDetail
          person={selectedPerson}
          eventId={eventFilter?.id ?? null}
          onClose={() => setSelectedPerson(null)}
          onSaved={applyPatch}
          onRemoved={() => { const id = selectedPerson.id; setPeople((prev) => prev.filter((p) => p.id !== id)); setSelectedPerson(null); }}
          onLabelsChange={(labelIds) => {
            const id = selectedPerson.id;
            setPeople((prev) => prev.map((p) => (p.id === id ? { ...p, labelIds } : p)));
            setSelectedPerson((prev) => (prev ? { ...prev, labelIds } : prev));
          }}
        />
      )}

      {addOpen && (
        <AddPersonModal eventFilter={eventFilter ? { id: eventFilter.id, name: eventFilter.name } : null} onClose={() => setAddOpen(false)} onAdded={onPersonAdded} />
      )}
      {newLabelOpen && (
        <PromptModal title="New label" label="Label name" placeholder="e.g. VIPs" submitLabel="Create" onClose={() => setNewLabelOpen(false)} onSubmit={(v) => void createNewLabel(v)} />
      )}
    </div>
  );
}
