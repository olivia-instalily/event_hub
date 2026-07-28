import { useEffect, useRef, useState } from "react";
import { Mic, X, Plus, Search } from "lucide-react";
import { listEventSpeakers, listAttendeesForEvent, setSpeakerRole, addAttendee, type Speaker2, type PersonView } from "../lib/db";

// The event header's "Speakers" field. The single source of truth is the per-event speaker flag
// (attendee_event.role_at_event='speaker') — the SAME store the People tab writes — so the title and
// the people list can't diverge. Click to tag an existing attendee or type a new name (external
// speakers who aren't contacts yet); typing adds them to the people list, marked speaker. Reloads
// each time the editor opens so cross-tab edits (People tab) show up.
export function SpeakerField({ eventId }: { eventId: string }) {
  const [speakers, setSpeakers] = useState<Speaker2[]>([]);
  const [open, setOpen] = useState(false);
  const [roster, setRoster] = useState<PersonView[]>([]);
  const [query, setQuery] = useState("");
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const load = () => listEventSpeakers(eventId).then(setSpeakers).catch(() => setSpeakers([]));
  const loadRoster = () => listAttendeesForEvent(eventId).then(setRoster).catch(() => setRoster([]));
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [eventId]);
  useEffect(() => {
    if (!open) return;
    load(); loadRoster();
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const speakerIds = new Set(speakers.map((s) => s.attendeeId));
  const tag = async (id: string) => { setBusy(true); try { await setSpeakerRole(eventId, id, true); await load(); setQuery(""); } finally { setBusy(false); } };
  const untag = async (id: string) => { setBusy(true); try { await setSpeakerRole(eventId, id, false); await load(); } finally { setBusy(false); } };
  const addNew = async () => {
    const n = newName.trim();
    if (!n) return;
    setBusy(true);
    try { await addAttendee(eventId, { name: n, isSpeaker: true }); setNewName(""); await load(); await loadRoster(); }
    finally { setBusy(false); }
  };

  const q = query.trim().toLowerCase();
  const matches = q
    ? roster.filter((p) => !speakerIds.has(p.id) && `${p.name ?? ""} ${p.org ?? ""} ${p.email ?? ""}`.toLowerCase().includes(q)).slice(0, 6)
    : [];
  const names = speakers.map((s) => s.name ?? "Unnamed");
  const label = names.length === 0 ? "Add speakers"
    : names.length <= 2 ? names.join(", ")
    : `${names.slice(0, 2).join(", ")} +${names.length - 2}`;

  return (
    <div className="relative inline-flex" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-1.5 hover:text-gray-900 text-left" title="Speakers for this event">
        <Mic className="w-4 h-4 shrink-0" />
        <span className={names.length ? "" : "text-gray-400"}>{label}</span>
      </button>
      {open && (
        <div className="absolute z-50 top-full left-0 mt-1 w-72 rounded-xl border border-border bg-white shadow-lg p-3 text-sm text-gray-800">
          <p className="text-[12px] font-medium text-gray-500 mb-2">Speakers</p>
          {speakers.length > 0 && (
            <ul className="space-y-1 mb-2">
              {speakers.map((s) => (
                <li key={s.attendeeId} className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate">{s.name ?? "Unnamed"}{s.org && <span className="text-gray-400"> · {s.org}</span>}</span>
                  <button onClick={() => untag(s.attendeeId)} disabled={busy} className="text-gray-300 hover:text-red-600 shrink-0" aria-label="Remove speaker"><X className="w-3.5 h-3.5" /></button>
                </li>
              ))}
            </ul>
          )}
          <div className="relative">
            <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Tag someone on this event…" className="w-full pl-8 pr-2 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
          </div>
          {q && (
            <ul className="mt-1 border border-gray-200 rounded-lg divide-y divide-gray-100 overflow-hidden">
              {matches.length === 0 ? (
                <li className="px-2.5 py-1.5 text-[13px] text-gray-400">No match — add a new name below.</li>
              ) : matches.map((p) => (
                <li key={p.id}>
                  <button onClick={() => tag(p.id)} disabled={busy} className="w-full text-left px-2.5 py-1.5 hover:bg-gray-50">{p.name ?? "Unnamed"}{p.org && <span className="text-gray-400"> · {p.org}</span>}</button>
                </li>
              ))}
            </ul>
          )}
          {/* Free-text speaker (external / not a contact yet) — added to the people list, marked speaker. */}
          <div className="flex gap-1.5 mt-2">
            <input value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void addNew(); }} placeholder="Or type a new speaker…" className="flex-1 min-w-0 px-2 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
            <button onClick={() => void addNew()} disabled={busy || !newName.trim()} className="px-2 rounded-lg bg-gray-900 text-white disabled:opacity-40" aria-label="Add speaker"><Plus className="w-4 h-4" /></button>
          </div>
        </div>
      )}
    </div>
  );
}
