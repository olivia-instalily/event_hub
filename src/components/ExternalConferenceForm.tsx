import { useEffect, useMemo, useState } from "react";
import { Plus, X, Loader2, Search, UserPlus, Calendar as CalendarIcon, ChevronLeft, ChevronRight, ChevronDown } from "lucide-react";
import { Modal } from "./Modal";
import { Button } from "@instalily/ui/button";
import { parseTypedDate } from "./DateEdit";
import { LocationInput } from "./LocationEdit";
import { addExternalConference, addAttendee, linkAttendeeToEvent, listAllAttendees, type PersonView } from "../lib/db";
import { EXTERNAL_TYPE_TAGS, type ExternalType } from "../lib/tags";

const pad2 = (n: number) => String(n).padStart(2, "0");
const isoOf = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

// A compact month-grid calendar, styled to match the app. Value/selection are YYYY-MM-DD strings.
function MiniCalendar({ value, min, onPick }: { value: string; min?: string; onPick: (v: string) => void }) {
  const sel = value ? new Date(value + "T12:00:00") : null;
  const today = new Date();
  const [cur, setCur] = useState(() => (sel ? { y: sel.getFullYear(), m: sel.getMonth() } : { y: today.getFullYear(), m: today.getMonth() }));
  const first = new Date(cur.y, cur.m, 1);
  const startDow = first.getDay();
  const daysInMonth = new Date(cur.y, cur.m + 1, 0).getDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  const shift = (delta: number) => setCur((c) => { const d = new Date(c.y, c.m + delta, 1); return { y: d.getFullYear(), m: d.getMonth() }; });

  return (
    <div className="mt-1 rounded-lg border border-gray-200 bg-white p-2 shadow-sm">
      <div className="flex items-center justify-between mb-1.5 px-1">
        <button type="button" onClick={() => shift(-1)} className="p-1 rounded hover:bg-gray-100" aria-label="Previous month"><ChevronLeft className="w-4 h-4" /></button>
        <span className="text-sm font-medium">{first.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</span>
        <button type="button" onClick={() => shift(1)} className="p-1 rounded hover:bg-gray-100" aria-label="Next month"><ChevronRight className="w-4 h-4" /></button>
      </div>
      <div className="grid grid-cols-7 gap-0.5">
        {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => <div key={i} className="text-[11px] text-gray-400 text-center py-1">{d}</div>)}
        {cells.map((d, i) => {
          if (!d) return <div key={i} />;
          const iso = `${cur.y}-${pad2(cur.m + 1)}-${pad2(d)}`;
          const selected = iso === value;
          const isToday = iso === isoOf(today);
          const disabled = !!min && iso < min;
          return (
            <button
              key={i}
              type="button"
              disabled={disabled}
              onClick={() => onPick(iso)}
              className={`h-8 text-[13px] rounded-md transition-colors ${selected ? "bg-gray-900 text-white" : disabled ? "text-gray-300 cursor-not-allowed" : isToday ? "bg-gray-100 text-gray-900 hover:bg-gray-200" : "text-gray-700 hover:bg-gray-100"}`}
            >
              {d}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Date-only field: a trigger button that reveals an INLINE calendar right below it. Inline (not a
// portaled popover) so it can't glitch against the modal's focus trap / z-index / scroll clipping.
// Value is a YYYY-MM-DD string; `min` disables earlier days.
function DateField({ value, onChange, placeholder, min }: { value: string; onChange: (v: string) => void; placeholder?: string; min?: string }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  useEffect(() => { setDraft(value); }, [value]);
  // Commit a hand-typed date: blank clears, valid sets, invalid reverts.
  const commit = () => { const s = draft.trim(); if (!s) { onChange(""); return; } const p = parseTypedDate(s); if (p) { onChange(p); setDraft(p); } else setDraft(value); };
  return (
    <div>
      <div className="w-full flex items-center gap-1.5 px-3 py-2 border border-gray-300 rounded-lg text-sm focus-within:ring-2 focus-within:ring-gray-300">
        <CalendarIcon className="w-4 h-4 text-gray-400 shrink-0" />
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { commit(); setOpen(false); } else if (e.key === "Escape") { setDraft(value); setOpen(false); } }}
          onBlur={commit}
          placeholder={placeholder ?? "YYYY-MM-DD"}
          className="flex-1 min-w-0 bg-transparent outline-none"
        />
        <button type="button" onClick={() => setOpen((o) => !o)} aria-label="Open calendar" className="shrink-0 text-gray-400 hover:text-gray-700"><ChevronDown className={`w-4 h-4 transition-transform ${open ? "rotate-180" : ""}`} /></button>
      </div>
      {open && <MiniCalendar value={value} min={min} onPick={(v) => { onChange(v); setOpen(false); }} />}
    </div>
  );
}

// Derive Q1–Q4 from a YYYY-MM-DD (Jan–Mar = Q1…). A manual override is always allowed — quarter is a
// planning tag, not auto-locked to the date.
function quarterFromDate(dateStr: string): string {
  const m = Number(dateStr.slice(5, 7));
  return m ? `Q${Math.floor((m - 1) / 3) + 1}` : "";
}

// A person to tag: either an EXISTING attendee (reused person record) or a NEW one (name + optional email).
type Picked = { kind: "existing"; id: string; label: string } | { kind: "new"; name: string; email: string };

// Add an EXTERNAL conference (something we're attending, not running) as a lightweight calendar
// instance. Fields match the brief exactly; only name + start are required. Attendees reuse the
// events-page mechanism: tag an existing person (ideal) or add a new name/email.
export function ExternalConferenceForm({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [type, setType] = useState<ExternalType | null>(null);
  const [why, setWhy] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [quarter, setQuarter] = useState("");
  const [quarterTouched, setQuarterTouched] = useState(false);
  const [location, setLocation] = useState("");
  const [infoUrl, setInfoUrl] = useState("");
  const [picked, setPicked] = useState<Picked[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Existing roster for tagging.
  const [roster, setRoster] = useState<PersonView[]>([]);
  const [query, setQuery] = useState("");
  const [addingNew, setAddingNew] = useState(false);
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  useEffect(() => { listAllAttendees().then(setRoster).catch(() => setRoster([])); }, []);

  // Quarter auto-fills from the start date until the user picks one (then their choice sticks).
  const effectiveQuarter = quarterTouched ? quarter : (start ? quarterFromDate(start) : quarter);
  const badRange = !!end && !!start && end < start;

  const pickedExistingIds = new Set(picked.filter((p): p is Extract<Picked, { kind: "existing" }> => p.kind === "existing").map((p) => p.id));
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [] as PersonView[];
    return roster.filter((p) => !pickedExistingIds.has(p.id) && `${p.name ?? ""} ${p.org ?? ""} ${p.email ?? ""}`.toLowerCase().includes(q)).slice(0, 6);
  }, [query, roster, picked]);

  const tagExisting = (p: PersonView) => { setPicked((prev) => [...prev, { kind: "existing", id: p.id, label: `${p.name ?? "Unnamed"}${p.org ? ` · ${p.org}` : ""}` }]); setQuery(""); };
  const addNew = () => { const n = newName.trim(); if (!n) return; setPicked((prev) => [...prev, { kind: "new", name: n, email: newEmail.trim() }]); setNewName(""); setNewEmail(""); setAddingNew(false); };

  const save = async () => {
    if (!name.trim()) { setErr("Name is required."); return; }
    if (!type) { setErr("Pick a type — Industry or PE."); return; }
    if (!start) { setErr("Start date is required."); return; }
    if (badRange) { setErr("End date must be on or after the start date."); return; }
    setBusy(true); setErr(null);
    try {
      const id = await addExternalConference({ name, startDate: start, endDate: end || null, why, quarter: effectiveQuarter || null, location, infoUrl, tag: EXTERNAL_TYPE_TAGS[type] });
      for (const p of picked) {
        try {
          if (p.kind === "existing") await linkAttendeeToEvent(id, p.id);
          else await addAttendee(id, { name: p.name, email: p.email || null });
        } catch { /* skip one bad attendee */ }
      }
      onCreated();
    } catch (e: any) { setErr(e?.message ?? String(e)); setBusy(false); }
  };

  const field = "w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-300";
  return (
    <Modal title="Add external event" onClose={onClose} maxWidth="max-w-lg">
      <div className="space-y-3 max-h-[65vh] overflow-y-auto pr-1 -mr-1">
        <div>
          <span className="text-[13px] text-gray-500">Type<span className="text-red-500">*</span></span>
          <div className="mt-1 flex gap-2">
            {(["Industry", "PE"] as ExternalType[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setType(t)}
                className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${type === t ? "border-purple-500 bg-purple-50 text-purple-800" : "border-gray-300 text-gray-600 hover:bg-gray-50"}`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
        <label className="block"><span className="text-[13px] text-gray-500">Name<span className="text-red-500">*</span></span>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Conference name" className={field} /></label>

        <label className="block"><span className="text-[13px] text-gray-500">Why relevant</span>
          <input value={why} onChange={(e) => setWhy(e.target.value)} placeholder="Pipeline / partners / vertical / recruiting…" className={field} /></label>

        <div className="grid grid-cols-2 gap-3">
          <div><span className="text-[13px] text-gray-500">Start date<span className="text-red-500">*</span></span>
            <div className="mt-1"><DateField value={start} onChange={setStart} placeholder="Pick a date" /></div></div>
          <div><span className="text-[13px] text-gray-500">End date <span className="text-gray-400">(single-day if blank)</span></span>
            <div className="mt-1"><DateField value={end} onChange={setEnd} placeholder="Optional" min={start || undefined} /></div></div>
        </div>
        {badRange && <p className="text-[12px] text-red-600">End date must be on or after the start date.</p>}

        {/* Quarter — pills matching the app's status-filter style; click the active one to clear.
            Auto-set from the start date until you pick one. */}
        <div>
          <span className="text-[13px] text-gray-500">Quarter</span>
          <div className="mt-1 flex gap-1.5">
            {["Q1", "Q2", "Q3", "Q4"].map((q) => {
              const active = effectiveQuarter === q;
              return (
                <button
                  key={q}
                  type="button"
                  onClick={() => { setQuarterTouched(true); setQuarter(active ? "" : q); }}
                  aria-pressed={active}
                  className={`px-3 py-1 text-sm rounded-lg border transition-all ${active ? "bg-gray-900 border-gray-900 text-white shadow-sm" : "bg-white border-border text-gray-700 hover:bg-gray-50"}`}
                >
                  {q}
                </button>
              );
            })}
          </div>
        </div>

        <label className="block"><span className="text-[13px] text-gray-500">Location</span>
          <LocationInput value={location} onChange={setLocation} placeholder="City / venue" className={field} /></label>

        <label className="block"><span className="text-[13px] text-gray-500">Info link</span>
          <input value={infoUrl} onChange={(e) => setInfoUrl(e.target.value)} placeholder="https://…" className={field} /></label>

        {/* Who's going — tag an existing person (search the roster) or add a new one. */}
        <div>
          <span className="text-[13px] text-gray-500">Who's going</span>
          {picked.length > 0 && (
            <ul className="flex flex-wrap gap-1.5 my-1.5">
              {picked.map((p, i) => (
                <li key={i} className="inline-flex items-center gap-1 bg-gray-100 rounded-full pl-2.5 pr-1 py-0.5 text-[13px]">
                  <span>{p.kind === "existing" ? p.label : `${p.name}${p.email ? ` · ${p.email}` : ""}`}</span>
                  <button onClick={() => setPicked((prev) => prev.filter((_, j) => j !== i))} className="text-gray-400 hover:text-red-600" aria-label="Remove"><X className="w-3.5 h-3.5" /></button>
                </li>
              ))}
            </ul>
          )}
          <div className="relative mt-1">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search people to tag…" className={`${field} pl-9`} />
          </div>
          {/* Results render in-flow (not a floating dropdown) so they never clip inside the modal. */}
          {query.trim() && (
            <ul className="mt-1 border border-gray-200 rounded-lg divide-y divide-gray-100 overflow-hidden">
              {matches.length === 0 ? (
                <li className="px-3 py-2 text-[13px] text-gray-400">No match — use "Add someone not on the list" below.</li>
              ) : matches.map((p) => (
                <li key={p.id}>
                  <button onClick={() => tagExisting(p)} className="w-full text-left px-3 py-1.5 text-sm hover:bg-gray-50">
                    {p.name ?? "Unnamed"}{p.org ? <span className="text-gray-400"> · {p.org}</span> : null}{p.email ? <span className="text-gray-400"> · {p.email}</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {/* Add-new fallback (optional). */}
          {addingNew ? (
            <div className="flex gap-2 mt-2">
              <input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addNew(); } }} placeholder="Name" className={`${field} flex-1`} />
              <input value={newEmail} onChange={(e) => setNewEmail(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addNew(); } }} placeholder="Email (optional)" className={`${field} flex-1`} />
              <button onClick={addNew} disabled={!newName.trim()} className="inline-flex items-center gap-1 px-2.5 rounded-lg border border-gray-300 text-sm hover:bg-gray-50 disabled:opacity-40 shrink-0"><Plus className="w-4 h-4" /></button>
            </div>
          ) : (
            <button onClick={() => setAddingNew(true)} className="mt-2 inline-flex items-center gap-1 text-[13px] text-gray-500 hover:text-gray-900"><UserPlus className="w-3.5 h-3.5" /> Add someone not on the list</button>
          )}
        </div>

        {err && <p className="text-[13px] text-red-600">{err}</p>}
      </div>
      <div className="flex justify-end gap-2 mt-5">
        <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
        <Button size="sm" onClick={() => void save()} disabled={busy || !name.trim() || !start || badRange}>
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null} Add conference
        </Button>
      </div>
    </Modal>
  );
}
