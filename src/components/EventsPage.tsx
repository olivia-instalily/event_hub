import { Bookmark, Calendar, MapPin, LayoutGrid, List, Plus, ChevronDown, Link2, X, Search, Trash2, Check, Lightbulb } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { EventDetailPage } from "./EventDetailPage";
import { listEvents, attachLuma, updateEventTags, setEventFormat, generateTemplate, createPlanningEvent, backfillEvent, deleteEvent, previewCarriedLessons, type EventListItem, type EventStatus, type GeneratedTemplate, type CarriedLesson } from "../lib/db";
import { TagStack } from "./TagStack";
import { FormatPicker } from "./FormatPicker";
import { LocationInput } from "./LocationEdit";
import { canonicalCity } from "../lib/cities";
import { EventPlanningPage } from "./EventPlanningPage";
import { ConfirmModal } from "./Modal";
import { tagColor } from "../lib/tags";

const NOT_CAPTURED = "Not captured";

/**
 * A thin sliver of the event's dominant cover color in the lines view. On row hover
 * (group/row) it draws out into a small square of the actual Luma cover. Dominant
 * color is sampled from the image (downscaled to 1px); falls back to the tag color
 * if the image can't be read (e.g. CORS) or there's no cover.
 */
function LumaSwatch({ url, fallback }: { url: string | null; fallback: string }) {
  const [color, setColor] = useState<string | null>(null);
  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const c = document.createElement("canvas");
        c.width = 1; c.height = 1;
        const ctx = c.getContext("2d");
        if (!ctx) return;
        ctx.drawImage(img, 0, 0, 1, 1);
        const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
        if (!cancelled) setColor(`rgb(${r}, ${g}, ${b})`);
      } catch { /* tainted canvas (CORS) → keep the tag-color fallback */ }
    };
    img.src = url;
    return () => { cancelled = true; };
  }, [url]);

  return (
    <span
      className={`relative block h-7 w-1.5 group-hover/row:h-10 group-hover/row:w-10 rounded-[3px] overflow-hidden shrink-0 transition-all duration-200 ease-out ${color ? "" : fallback}`}
      style={color ? { backgroundColor: color } : undefined}
      aria-hidden
    >
      {url && (
        <img src={url} alt="" className="absolute inset-0 w-full h-full object-cover opacity-0 group-hover/row:opacity-100 transition-opacity duration-200" style={{ filter: "saturate(1.4) contrast(1.05)" }} />
      )}
    </span>
  );
}

interface EventsPageProps {
  selectedEventId: string | null;
  setSelectedEventId: (id: string | null) => void;
  onViewPeople: (filter: { id: string; name: string; tag?: string | null; status?: 'all' | 'registered' | 'checkedIn' | 'waitlisted' | 'speakers' }) => void;
  openCreate?: boolean; // open the Create Event modal on mount (set when navigated here via a Create button)
}

/** Create-event entry flow: choose ownership, describe, optionally start from a past event. */
/** Small editable chip list (vendor categories, progress workstreams). */
function ChipEditor({ items, onChange, placeholder }: { items: string[]; onChange: (v: string[]) => void; placeholder: string }) {
  const [draft, setDraft] = useState('');
  const add = () => { const v = draft.trim(); if (!v || items.includes(v)) { setDraft(''); return; } onChange([...items, v]); setDraft(''); };
  return (
    <div className="flex flex-wrap items-center gap-2">
      {items.map((it) => (
        <span key={it} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-sm bg-gray-100 text-gray-700">
          {it}
          <button onClick={() => onChange(items.filter((x) => x !== it))} className="text-gray-400 hover:text-gray-900"><X className="w-3 h-3" /></button>
        </span>
      ))}
      <span className="inline-flex gap-1">
        <input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') add(); }} placeholder={placeholder} className="px-2 py-1 w-36 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
        <button onClick={add} className="px-2 py-1 text-sm bg-gray-200 rounded hover:bg-gray-300">Add</button>
      </span>
    </div>
  );
}

/** Seed the "describe the event" box from a past event's specs, ending with a
 *  prompt for the user to fill in what's different this time. */
function templateDescription(e: EventListItem): string {
  const specs: string[] = [];
  if (e.format) specs.push(`Format: ${e.format}`);
  if (e.location) specs.push(`Location: ${e.location}`);
  const size = e.capacity ?? e.rsvp ?? e.attendeeCount;
  if (size != null) specs.push(`Size: ~${size} guests`);
  if (e.tags.length) specs.push(`Themes: ${e.tags.join(", ")}`);
  const heading = e.seriesName ? `Modeled on “${e.title}” (${e.seriesName}).` : `Modeled on “${e.title}”.`;
  return [heading, ...specs, "", "What’s different this time: "].join("\n");
}

/** Site-styled tag filter dropdown — tags render as colored pills, like on the cards. */
function TagFilter({ tags, value, onChange }: { tags: string[]; value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);
  const pick = (v: string) => { onChange(v); setOpen(false); };
  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 px-4 py-2 pr-3 bg-white border border-black rounded-lg text-sm hover:bg-gray-50 cursor-pointer"
      >
        {value === 'all'
          ? <span className="text-gray-700">All Tags</span>
          : <span className={`px-2 py-0.5 rounded-full text-xs ${tagColor(value)}`}>{value}</span>}
        <ChevronDown className="w-4 h-4 text-gray-400" />
      </button>
      {open && (
        <div className="absolute z-50 mt-1 left-0 min-w-[12rem] max-h-72 overflow-y-auto bg-white border border-black rounded-lg shadow-lg p-1">
          <button onClick={() => pick('all')} className={`flex items-center w-full text-left px-2 py-1.5 rounded text-sm hover:bg-gray-50 ${value === 'all' ? 'bg-gray-100' : ''}`}>
            All Tags
          </button>
          {tags.length === 0 && <p className="px-2 py-1.5 text-sm text-gray-400">No tags yet.</p>}
          {tags.map((t) => (
            <button key={t} onClick={() => pick(t)} className={`flex items-center justify-between gap-2 w-full text-left px-2 py-1.5 rounded hover:bg-gray-50 ${value === t ? 'bg-gray-100' : ''}`}>
              <span className={`px-2 py-0.5 rounded-full text-xs ${tagColor(t)}`}>{t}</span>
              {value === t && <Check className="w-4 h-4 text-gray-700 shrink-0" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function CreateEventModal({ events, onClose, onCreated }: { events: EventListItem[]; onClose: () => void; onCreated: (eventId: string) => void }) {
  const [mode, setMode] = useState<'choose' | 'planFork' | 'planning' | 'backfill'>('choose');
  // Set on the planning fork: solo (InstaLILY hosts alone) vs cohost (sharing hosting & cost).
  const [planKind, setPlanKind] = useState<'solo' | 'cohost'>('solo');
  const [description, setDescription] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  // The spec text we auto-filled from the selected template; lets us swap/clear it
  // when the selection changes without clobbering anything the user typed.
  const [autofilledDesc, setAutofilledDesc] = useState('');
  const [templateSearch, setTemplateSearch] = useState('');
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [draft, setDraft] = useState<GeneratedTemplate | null>(null);
  const [meta, setMeta] = useState({ name: '', date: '', location: '', lumaUrl: '', coHost: '' });
  const [bf, setBf] = useState({ name: '', date: '', location: '', description: '', lumaUrl: '' });
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const descRef = useRef<HTMLTextAreaElement>(null);

  // Auto-grow the describe box to fit its content (capped), so it expands as you type.
  useEffect(() => {
    const el = descRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 320)}px`;
  }, [description, mode]);
  // Once the description has real substance, give it room by shrinking the past-event grid.
  const descLong = description.trim().length > 140 || description.split('\n').length > 4;

  // Carried lessons preview — surfaced before the draft is generated, matched on the
  // start-from event and what's been described so far. Debounced; re-runs as inputs change.
  const [lessons, setLessons] = useState<CarriedLesson[] | null>(null);
  const [lessonsLoading, setLessonsLoading] = useState(false);
  useEffect(() => {
    if (mode !== 'planning') return;
    const seed = events.find((e) => e.id === selected);
    if (!selected && description.trim().length < 12) { setLessons(null); return; }
    let cancelled = false;
    setLessonsLoading(true);
    const h = setTimeout(() => {
      previewCarriedLessons({ name: description.trim() || seed?.title || '', format: seed?.format ?? null, tags: seed?.tags ?? [], modeledOnEventId: selected })
        .then((l) => { if (!cancelled) setLessons(l); })
        .catch(() => { if (!cancelled) setLessons([]); })
        .finally(() => { if (!cancelled) setLessonsLoading(false); });
    }, 600);
    return () => { cancelled = true; clearTimeout(h); };
  }, [mode, description, selected, events]);

  const createPlanned = async () => {
    if (!draft || !meta.name.trim()) return;
    setCreating(true); setCreateError(null);
    try {
      // Solo events skip the up-front budget estimate — seed no budget lines.
      const template = planKind === 'solo' ? { ...draft, budgetLines: [] } : draft;
      const id = await createPlanningEvent({ name: meta.name.trim(), date: meta.date || null, location: meta.location.trim() || null, tags: [], template, hosting: planKind, coHost: planKind === 'cohost' ? meta.coHost : null, modeledOnEventId: selected });
      if (meta.lumaUrl.trim()) { try { await attachLuma(id, meta.lumaUrl.trim()); } catch { /* event still created; attach later from the card */ } }
      onCreated(id);
    } catch (e: any) { setCreateError(e.message ?? String(e)); setCreating(false); }
  };
  const createBackfill = async () => {
    if (!bf.name.trim() || !bf.date) return;
    setCreating(true); setCreateError(null);
    try {
      const id = await backfillEvent({ name: bf.name.trim(), date: bf.date, location: bf.location.trim() || null, description: bf.description.trim() || null });
      if (bf.lumaUrl.trim()) { try { await attachLuma(id, bf.lumaUrl.trim()); } catch { /* event still created */ } }
      onCreated(id);
    } catch (e: any) { setCreateError(e.message ?? String(e)); setCreating(false); }
  };

  // Rank past events by how much they have filled out — richer events make better starting points.
  const infoScore = (e: EventListItem) =>
    (e.coverImageUrl ? 3 : 0) +
    (e.location ? 1 : 0) +
    (e.date ? 1 : 0) +
    (e.format ? 1 : 0) +
    (e.tags.length ? 1 : 0) +
    (e.attendeeCount != null ? 1 : 0) +
    (e.rsvp != null ? 1 : 0) +
    (e.capacity != null ? 1 : 0) +
    (e.owners.length ? 1 : 0) +
    (e.seriesName ? 1 : 0);
  const templateQuery = templateSearch.trim().toLowerCase();
  const templates = events
    .filter((e) => e.status === 'past')
    .filter((e) => !templateQuery || `${e.title} ${e.location ?? ''} ${e.seriesName ?? ''}`.toLowerCase().includes(templateQuery))
    .sort((a, b) => infoScore(b) - infoScore(a));

  // Whatever the user typed themselves — i.e. the text after our auto-filled spec
  // prefix (or the whole field, if no template is currently applied).
  const userDifferenceText = () =>
    autofilledDesc && description.startsWith(autofilledDesc) ? description.slice(autofilledDesc.length) : description;

  // Click a past event → prefill the description with its specs, then drop whatever
  // the user already typed into the "What's different this time" slot. Re-clicking
  // the same event strips the spec framing but keeps their text.
  const selectTemplate = (t: EventListItem) => {
    const userText = userDifferenceText();
    if (t.id === selected) {
      setSelected(null);
      setDescription(userText);
      setAutofilledDesc('');
      return;
    }
    setSelected(t.id);
    const prefix = templateDescription(t); // ends with "What's different this time: "
    setAutofilledDesc(prefix);
    setDescription(prefix + userText);
  };

  const generate = async () => {
    const desc = description.trim();
    const seed = templates.find((t) => t.id === selected);
    setGenerating(true);
    setGenError(null);
    try {
      const t = await generateTemplate(seed ? `${desc}\n\n(Model it loosely on a past event: ${seed.title})` : desc);
      setDraft(t);
      // Prefill event details parsed from the description — but never clobber what the user already typed.
      setMeta((m) => ({
        ...m,
        name: m.name.trim() || (t.name ?? ''),
        location: m.location.trim() || (t.location ? canonicalCity(t.location) : ''),
        date: m.date || (t.date ?? ''),
      }));
    } catch (e: any) {
      setGenError(e.message ?? String(e));
    } finally {
      setGenerating(false);
    }
  };
  const patch = (p: Partial<GeneratedTemplate>) => setDraft((d) => (d ? { ...d, ...p } : d));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl border border-black max-w-2xl w-full max-h-[85vh] overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-2xl">Create event</h2>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-900" aria-label="Close"><X className="w-5 h-5" /></button>
        </div>

        {mode === 'choose' ? (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <button onClick={() => setMode('planFork')} className="border border-black rounded-xl p-6 text-left hover:bg-gray-50 transition-colors">
              <p className="text-lg font-medium">We&apos;re planning</p>
              <p className="text-sm text-gray-500 mt-1">InstaLILY is running this event — alone or alongside a co-host.</p>
            </button>
            <button disabled className="border border-gray-200 rounded-xl p-6 text-left opacity-60 cursor-not-allowed">
              <p className="text-lg font-medium">I&apos;m attending</p>
              <p className="text-sm text-gray-500 mt-1">A third party owns it; we attend, exhibit, or sponsor. Coming soon.</p>
            </button>
            <button onClick={() => setMode('backfill')} className="border border-black rounded-xl p-6 text-left hover:bg-gray-50 transition-colors">
              <p className="text-lg font-medium">Backfill a past event</p>
              <p className="text-sm text-gray-500 mt-1">Log an event that already happened.</p>
            </button>
          </div>
        ) : mode === 'planFork' ? (
          <div>
            <p className="text-sm text-gray-600 mb-4">Are you planning this alone, or alongside someone else?</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <button onClick={() => { setPlanKind('solo'); setMode('planning'); }} className="border border-black rounded-xl p-6 text-left hover:bg-gray-50 transition-colors">
                <p className="text-lg font-medium">Just us</p>
                <p className="text-sm text-gray-500 mt-1">InstaLILY hosts and covers the cost alone.</p>
              </button>
              <button onClick={() => { setPlanKind('cohost'); setMode('planning'); }} className="border border-black rounded-xl p-6 text-left hover:bg-gray-50 transition-colors">
                <p className="text-lg font-medium">With a co-host</p>
                <p className="text-sm text-gray-500 mt-1">Sharing hosting &amp; cost with another organization.</p>
              </button>
            </div>
            <div className="mt-6 pt-4 border-t border-gray-100">
              <button onClick={() => setMode('choose')} className="text-sm text-gray-600 hover:text-gray-900">← Back</button>
            </div>
          </div>
        ) : mode === 'planning' ? (
          <div>
            <label className="text-sm font-medium block mb-1">Describe the event</label>
            <textarea
              ref={descRef}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Fireside chat & networking for ~120 in Toronto…"
              className="w-full px-3 py-2 border border-black rounded-lg text-sm mb-5 min-h-[5rem] resize-none overflow-hidden transition-[height] duration-150 focus:outline-none focus:ring-2 focus:ring-gray-300"
            />

            <h3 className="text-sm font-medium mb-3">Start from a past event <span className="text-gray-400 font-normal">(optional)</span></h3>
            <div className="relative mb-3">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                value={templateSearch}
                onChange={(e) => setTemplateSearch(e.target.value)}
                placeholder="Search past events…"
                className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-300"
              />
            </div>
            {templates.length === 0 ? (
              <p className="text-sm text-gray-400">{templateQuery ? 'No past events match your search.' : 'No past events to start from.'}</p>
            ) : (
              <div className={`grid grid-cols-2 sm:grid-cols-3 gap-3 overflow-y-auto pr-1 transition-[max-height] duration-300 ${descLong ? 'max-h-40' : 'max-h-72'}`}>
                {templates.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => selectTemplate(t)}
                    className={`relative rounded-xl overflow-hidden border text-left h-28 transition ${selected === t.id ? 'border-black ring-2 ring-black' : 'border-gray-200 hover:border-gray-400'}`}
                  >
                    {t.coverImageUrl ? (
                      <img src={t.coverImageUrl} alt="" className="absolute inset-0 w-full h-full object-cover" style={{ objectPosition: t.coverPosition ?? '50% 50%' }} />
                    ) : (
                      <span className="absolute inset-0 bg-gray-200" />
                    )}
                    <span className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/20 to-transparent" />
                    <span className="absolute bottom-2 left-2 right-2 text-white text-xs font-medium line-clamp-2">{t.title}</span>
                  </button>
                ))}
              </div>
            )}

            {(lessonsLoading || (lessons && lessons.length > 0)) && (
              <div className="mt-5">
                <h3 className="text-sm font-medium mb-2 flex items-center gap-1.5"><Lightbulb className="w-4 h-4 text-amber-500" /> Lessons from past events</h3>
                {lessonsLoading && !lessons ? (
                  <p className="text-sm text-gray-400">Finding comparable past events…</p>
                ) : (
                  <div className="rounded-lg border border-gray-200 divide-y divide-gray-100 max-h-44 overflow-y-auto">
                    {lessons!.map((l, i) => (
                      <div key={i} className="px-3 py-2 flex gap-2">
                        <Lightbulb className="w-3.5 h-3.5 text-amber-500 mt-0.5 shrink-0" />
                        <div>
                          <p className="text-sm text-gray-700">{l.body}</p>
                          <p className="text-xs text-gray-400 mt-0.5">from {l.sourceEventName}{l.why ? ` · ${l.why}` : ''}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {!draft ? (
              <div className="mt-6">
                {genError && <p className="text-red-600 text-sm mb-2">{genError}</p>}
                <button
                  onClick={generate}
                  disabled={!description.trim() || generating}
                  className="px-4 py-2 bg-gray-200 text-black rounded-lg text-sm hover:bg-gray-300 disabled:opacity-50 transition-colors"
                >
                  {generating ? 'Generating template…' : 'Generate draft template'}
                </button>
                <p className="text-xs text-gray-400 mt-2">Claude drafts vendor categories{planKind === 'cohost' ? ', a budget make-up,' : ''} and progress workstreams — all editable before you create.</p>
              </div>
            ) : (
              <div className="mt-6 space-y-6">
                <div>
                  <h3 className="text-sm font-medium mb-2">Event details</h3>
                  <input
                    value={meta.name}
                    onChange={(e) => setMeta({ ...meta, name: e.target.value })}
                    placeholder="Event name (required)"
                    className="w-full mb-2 px-3 py-2 border border-black rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-300"
                  />
                  <div className="flex flex-wrap gap-2">
                    <input type="date" value={meta.date} onChange={(e) => setMeta({ ...meta, date: e.target.value })} className="px-3 py-2 border border-black rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
                    <LocationInput value={meta.location} onChange={(v) => setMeta({ ...meta, location: v })} style={{ width: `${Math.max(10, meta.location.length + 2)}ch` }} className="px-3 py-2 border border-black rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
                  </div>
                  <input value={meta.lumaUrl} onChange={(e) => setMeta({ ...meta, lumaUrl: e.target.value })} placeholder="Luma link (optional) — add now or later" className="w-full mt-2 px-3 py-2 border border-black rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
                  {planKind === 'cohost' && (
                    <input value={meta.coHost} onChange={(e) => setMeta({ ...meta, coHost: e.target.value })} placeholder="Co-host organization (optional)" className="w-full mt-2 px-3 py-2 border border-black rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
                  )}
                </div>
                <div>
                  <h3 className="text-sm font-medium mb-2">Vendor categories</h3>
                  <ChipEditor items={draft.vendorCategories} onChange={(v) => patch({ vendorCategories: v })} placeholder="Add category" />
                </div>

                {/* Budget make-up — co-host only for now. Solo events skip the up-front
                    estimate; budget comes later as a more exact breakdown. */}
                {planKind === 'cohost' && (
                  <div>
                    <h3 className="text-sm font-medium mb-2">Budget make-up</h3>
                    <div className="space-y-2">
                      {draft.budgetLines.map((line, i) => (
                        <div key={i} className="flex gap-2">
                          <input
                            value={line.label}
                            onChange={(e) => patch({ budgetLines: draft.budgetLines.map((l, j) => (j === i ? { ...l, label: e.target.value } : l)) })}
                            className="flex-1 px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-gray-300"
                          />
                          <input
                            type="number"
                            value={line.estimate}
                            onChange={(e) => patch({ budgetLines: draft.budgetLines.map((l, j) => (j === i ? { ...l, estimate: Number(e.target.value) } : l)) })}
                            className="w-28 px-2 py-1 text-right border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-gray-300"
                          />
                          <button onClick={() => patch({ budgetLines: draft.budgetLines.filter((_, j) => j !== i) })} className="text-gray-400 hover:text-red-600"><X className="w-4 h-4" /></button>
                        </div>
                      ))}
                      <button onClick={() => patch({ budgetLines: [...draft.budgetLines, { label: 'New line', estimate: 0 }] })} className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900">
                        <Plus className="w-4 h-4" /> Add line
                      </button>
                    </div>
                    <p className="text-sm text-gray-500 mt-1">Est. total: ${draft.budgetLines.reduce((s, l) => s + (l.estimate || 0), 0).toLocaleString()}</p>
                  </div>
                )}

                <div>
                  <h3 className="text-sm font-medium mb-2">Progress workstreams</h3>
                  <ChipEditor items={draft.progressCategories} onChange={(v) => patch({ progressCategories: v })} placeholder="Add workstream" />
                </div>
              </div>
            )}

            {createError && <p className="text-red-600 text-sm mt-4">{createError}</p>}
            <div className="flex items-center justify-between mt-6 pt-4 border-t border-gray-100">
              <button onClick={() => (draft ? setDraft(null) : setMode('planFork'))} className="text-sm text-gray-600 hover:text-gray-900">← Back</button>
              <button
                onClick={createPlanned}
                disabled={!draft || !meta.name.trim() || creating}
                title={draft ? 'Creates the event and opens its planning dashboard' : 'Generate a template first'}
                className="px-4 py-2 bg-gray-200 text-black rounded-lg text-sm hover:bg-gray-300 disabled:opacity-50 transition-colors"
              >
                {creating ? 'Creating…' : 'Create event'}
              </button>
            </div>
          </div>
        ) : (
          <div>
            <h3 className="text-sm font-medium mb-3">Backfill a past event</h3>
            <div className="space-y-3">
              <input
                value={bf.name}
                onChange={(e) => setBf({ ...bf, name: e.target.value })}
                placeholder="Event name"
                className="w-full px-3 py-2 border border-black rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-300"
              />
              <div className="flex flex-wrap gap-3">
                <input
                  type="date"
                  value={bf.date}
                  onChange={(e) => setBf({ ...bf, date: e.target.value })}
                  className="px-3 py-2 border border-black rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-300"
                />
                <LocationInput
                  value={bf.location}
                  onChange={(v) => setBf({ ...bf, location: v })}
                  style={{ width: `${Math.max(10, bf.location.length + 2)}ch` }}
                  className="px-3 py-2 border border-black rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-300"
                />
              </div>
              <input
                value={bf.lumaUrl}
                onChange={(e) => setBf({ ...bf, lumaUrl: e.target.value })}
                placeholder="Luma link (optional) — add now or later"
                className="w-full px-3 py-2 border border-black rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-300"
              />
              <textarea
                rows={2}
                value={bf.description}
                onChange={(e) => setBf({ ...bf, description: e.target.value })}
                placeholder="What happened? (optional)"
                className="w-full px-3 py-2 border border-black rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-300"
              />
            </div>
            <p className="text-xs text-gray-400 mt-2">A past event you can attach a Luma link to later to pull its guest list.</p>
            {createError && <p className="text-red-600 text-sm mt-3">{createError}</p>}
            <div className="flex items-center justify-between mt-6 pt-4 border-t border-gray-100">
              <button onClick={() => setMode('choose')} className="text-sm text-gray-600 hover:text-gray-900">← Back</button>
              <button
                onClick={createBackfill}
                disabled={!bf.name.trim() || !bf.date || creating}
                className="px-4 py-2 bg-gray-200 text-black rounded-lg text-sm hover:bg-gray-300 disabled:opacity-50 transition-colors"
              >
                {creating ? 'Creating…' : 'Create event'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function EventsPage({ selectedEventId, setSelectedEventId, onViewPeople, openCreate = false }: EventsPageProps) {
  const [events, setEvents] = useState<EventListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [bookmarkedEvents, setBookmarkedEvents] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<'cards' | 'lines'>('cards');
  const [statusFilter, setStatusFilter] = useState<EventStatus | 'all'>('all');
  const [locationFilter, setLocationFilter] = useState<string>('all');
  const [ownerFilter, setOwnerFilter] = useState<string>('all');
  const [tagFilter, setTagFilter] = useState<string>('all');
  const [showBookmarkedOnly, setShowBookmarkedOnly] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [dateRange, setDateRange] = useState<'all' | 'week' | 'month' | '3months' | 'year' | 'custom'>('all');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [createOpen, setCreateOpen] = useState(openCreate);

  // Luma attach UI: which card's input is open, its value, busy/error state.
  const [lumaEditingId, setLumaEditingId] = useState<string | null>(null);
  const [lumaInput, setLumaInput] = useState('');
  const [lumaBusy, setLumaBusy] = useState(false);
  const [lumaError, setLumaError] = useState<string | null>(null);

  // Delete UI: the event awaiting a delete confirmation.
  const [deleteTarget, setDeleteTarget] = useState<EventListItem | null>(null);
  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const id = deleteTarget.id;
    setEvents((prev) => prev.filter((e) => e.id !== id)); // optimistic
    try {
      await deleteEvent(id);
    } catch (e: any) {
      setError(e.message ?? String(e));
      await load(); // revert to server truth on failure
    }
  };

  // Tag edit UI: which card's tag dropdown is open.
  const setTags = async (eventId: string, tags: string[]) => {
    // optimistic update, then persist
    setEvents((prev) => prev.map((e) => (e.id === eventId ? { ...e, tags } : e)));
    try {
      await updateEventTags(eventId, tags);
    } catch {
      await load(); // revert to server truth on failure
    }
  };

  const setFormatValue = async (eventId: string, format: string | null) => {
    setEvents((prev) => prev.map((e) => (e.id === eventId ? { ...e, format } : e)));
    try { await setEventFormat(eventId, format); } catch { await load(); }
  };

  const load = () =>
    listEvents()
      .then(setEvents)
      .catch((e) => setError(e.message ?? String(e)))
      .finally(() => setLoading(false));

  useEffect(() => { void load(); }, []);

  const submitLuma = async (eventId: string) => {
    setLumaBusy(true);
    setLumaError(null);
    try {
      await attachLuma(eventId, lumaInput.trim());
      setLumaEditingId(null);
      setLumaInput('');
      await load();
    } catch (e: any) {
      setLumaError(e.message ?? String(e));
    } finally {
      setLumaBusy(false);
    }
  };

  const toggleBookmark = (eventId: string) => {
    setBookmarkedEvents((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(eventId)) newSet.delete(eventId);
      else newSet.add(eventId);
      return newSet;
    });
  };

  const locations = Array.from(new Set(events.map(e => e.location).filter(Boolean))) as string[];
  // Distinct individual owners (not the joined string) so the filter lists each person once.
  const owners = Array.from(new Set(events.flatMap(e => e.owners.map(o => o.name)))).sort((a, b) => a.localeCompare(b));
  const tags = Array.from(new Set(events.flatMap(e => e.tags))).sort((a, b) => a.localeCompare(b));

  // Date filtering applies to Past / All only (not Future or In-Process).
  const showDateFilter = statusFilter === 'past' || statusFilter === 'all';
  let dateFrom: string | null = null;
  let dateTo: string | null = null;
  if (showDateFilter) {
    if (dateRange === 'custom') {
      dateFrom = customStart || null;
      dateTo = customEnd || null;
    } else if (dateRange !== 'all') {
      const days = { week: 7, month: 30, '3months': 90, year: 365 }[dateRange];
      const t = new Date();
      const c = new Date(t);
      c.setDate(c.getDate() - days);
      dateFrom = c.toISOString().slice(0, 10);
      dateTo = t.toISOString().slice(0, 10);
    }
  }

  const filteredEvents = events.filter(event => {
    if (statusFilter !== 'all' && event.status !== statusFilter) return false;
    if (locationFilter !== 'all' && event.location !== locationFilter) return false;
    if (ownerFilter !== 'all' && !event.owners.some(o => o.name === ownerFilter)) return false;
    if (tagFilter !== 'all' && !event.tags.includes(tagFilter)) return false;
    if (showBookmarkedOnly && !bookmarkedEvents.has(event.id)) return false;
    if (dateFrom && (!event.date || event.date < dateFrom)) return false;
    if (dateTo && (!event.date || event.date > dateTo)) return false;
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      const hay = `${event.title} ${event.seriesName ?? ''} ${event.tags.join(' ')} ${event.location ?? ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }).sort((a, b) => {
    // Future: soonest first. Past / All: most recent first. Undated last.
    const ad = a.date ?? '', bd = b.date ?? '';
    if (!ad && !bd) return 0;
    if (!ad) return 1;
    if (!bd) return -1;
    return statusFilter === 'future' ? ad.localeCompare(bd) : bd.localeCompare(ad);
  });

  if (selectedEventId !== null) {
    // Events we're actively planning (macro_stage set) open the planning view;
    // everything else opens the post-hoc recap view.
    const sel = events.find((e) => e.id === selectedEventId);
    const onBack = () => setSelectedEventId(null);
    return sel?.macroStage != null ? (
      <EventPlanningPage eventId={selectedEventId} onBack={onBack} onViewPeople={onViewPeople} />
    ) : (
      <EventDetailPage eventId={selectedEventId} onBack={onBack} onViewPeople={onViewPeople} />
    );
  }

  return (
    <div>
      {/* Status Tabs */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex gap-2">
          {(['future', 'in-process', 'past', 'all'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-2 py-1 rounded-lg transition-colors ${
                statusFilter === s
                  ? 'bg-gray-200 text-black'
                  : 'bg-white border border-black text-gray-700 hover:bg-gray-50'
              }`}
            >
              {s === 'future' ? 'Future' : s === 'in-process' ? 'In-Process' : s === 'past' ? 'Past' : 'All'}
            </button>
          ))}
        </div>

        <button
          onClick={() => setCreateOpen(true)}
          className="flex items-center gap-2 px-4 py-2 bg-gray-200 text-black rounded-lg hover:bg-gray-300 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Create Event
        </button>
      </div>

      {/* Filters and View Toggle */}
      <div className="flex items-start justify-between gap-3 mb-6">
        <div className="flex flex-wrap gap-3">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search events…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 pr-4 py-2 bg-white border border-black rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-300"
            />
          </div>

          <div className="relative">
            <select
              value={locationFilter}
              onChange={(e) => setLocationFilter(e.target.value)}
              className="appearance-none px-4 py-2 pr-10 bg-white border border-black rounded-lg text-sm hover:bg-gray-50 cursor-pointer"
            >
              <option value="all">All Locations</option>
              {locations.map(location => (
                <option key={location} value={location}>{location}</option>
              ))}
            </select>
            <ChevronDown className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          </div>

          <div className="relative">
            <select
              value={ownerFilter}
              onChange={(e) => setOwnerFilter(e.target.value)}
              className="appearance-none max-w-[11rem] truncate px-4 py-2 pr-10 bg-white border border-black rounded-lg text-sm hover:bg-gray-50 cursor-pointer"
            >
              <option value="all">All Owners</option>
              {owners.map(owner => (
                <option key={owner} value={owner}>{owner}</option>
              ))}
            </select>
            <ChevronDown className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          </div>

          <TagFilter tags={tags} value={tagFilter} onChange={setTagFilter} />

          {/* Date filter — Past / All only */}
          {showDateFilter && (
            <>
              <div className="relative">
                <select
                  value={dateRange}
                  onChange={(e) => setDateRange(e.target.value as typeof dateRange)}
                  className="appearance-none px-4 py-2 pr-10 bg-white border border-black rounded-lg text-sm hover:bg-gray-50 cursor-pointer"
                >
                  <option value="all">Any date</option>
                  <option value="week">Past week</option>
                  <option value="month">Past month</option>
                  <option value="3months">Past 3 months</option>
                  <option value="year">Past year</option>
                  <option value="custom">Custom range…</option>
                </select>
                <ChevronDown className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              </div>
              {dateRange === 'custom' && (
                <div className="flex items-center gap-2">
                  <input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} className="px-3 py-2 border border-black rounded-lg text-sm" />
                  <span className="text-gray-400 text-sm">→</span>
                  <input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} className="px-3 py-2 border border-black rounded-lg text-sm" />
                </div>
              )}
            </>
          )}

          <button
            onClick={() => setShowBookmarkedOnly(!showBookmarkedOnly)}
            className={`px-4 py-2 rounded-lg text-sm transition-colors flex items-center gap-2 ${
              showBookmarkedOnly ? 'bg-gray-100' : 'bg-white border border-black hover:bg-gray-50'
            }`}
          >
            <Bookmark className={`w-4 h-4 ${showBookmarkedOnly ? 'fill-current text-gray-900' : 'text-gray-600'}`} />
          </button>
        </div>

        <div className="flex items-center gap-2">
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

      {/* States */}
      {loading && <p className="text-gray-500 py-12 text-center">Loading events…</p>}
      {error && (
        <p className="text-red-600 bg-red-50 border border-red-200 rounded-lg p-4">
          Couldn’t load events: {error}
        </p>
      )}
      {!loading && !error && filteredEvents.length === 0 && (
        <p className="text-gray-500 py-12 text-center">No {statusFilter.replace('-', ' ')} events.</p>
      )}

      {/* Cards View */}
      {!loading && !error && viewMode === 'cards' && filteredEvents.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {filteredEvents.map((event) => (
            <div
              key={event.id}
              className="bg-white rounded-2xl border border-black p-6 hover:shadow-md transition-shadow cursor-pointer overflow-hidden flex flex-col"
              onClick={() => setSelectedEventId(event.id)}
            >
              {event.coverImageUrl && (
                <img
                  src={event.coverImageUrl}
                  alt=""
                  className="-mx-6 -mt-6 mb-4 h-36 w-[calc(100%+3rem)] max-w-none object-cover"
                  style={{ objectPosition: event.coverPosition ?? '50% 50%' }}
                />
              )}

              <div className="flex items-center justify-between gap-2 mb-3 min-h-[2rem]">
                <FormatPicker value={event.format} onChange={(f) => setFormatValue(event.id, f)} />
                <div className="flex items-center gap-2 shrink-0">
                  {event.attendeeCount != null && (
                    <>
                      <span className="text-gray-300">|</span>
                      <span className="text-gray-500 text-sm whitespace-nowrap">{event.attendeeCount} checked in</span>
                    </>
                  )}
                  <button
                    onClick={(e) => { e.stopPropagation(); toggleBookmark(event.id); }}
                    className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                    aria-label="Bookmark event"
                  >
                    <Bookmark className={`w-5 h-5 ${bookmarkedEvents.has(event.id) ? "fill-current text-gray-900" : "text-gray-400"}`} />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); setDeleteTarget(event); }}
                    className="p-2 text-gray-400 hover:text-red-600 hover:bg-gray-100 rounded-lg transition-colors"
                    aria-label="Delete event"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                </div>
              </div>

              <h2 className="text-xl mb-2">{event.title}</h2>
              {event.seriesName && <p className="text-gray-500 text-sm mb-4">{event.seriesName}</p>}

              <div className="flex flex-wrap items-center gap-2 mb-6">
                <span className="px-3 py-1 bg-gray-100 rounded-md text-sm flex items-center gap-1">
                  <Calendar className="w-3 h-3" />
                  {event.date ?? NOT_CAPTURED}
                </span>
                <span className="px-3 py-1 bg-gray-100 rounded-md text-sm flex items-center gap-1">
                  <MapPin className="w-3 h-3" />
                  {event.location ?? NOT_CAPTURED}
                </span>
                <TagStack tags={event.tags} editable onChange={(tags) => setTags(event.id, tags)} onTagClick={setTagFilter} />
              </div>

              {/* Luma attach / link —  pinned to the card's bottom edge */}
              <div className="mt-auto pt-4 border-t border-gray-100" onClick={(e) => e.stopPropagation()}>
                {event.lumaEventId ? (
                  <a
                    href={event.lumaUrl ?? undefined}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900 border border-gray-300 rounded-lg px-2.5 py-1 hover:bg-gray-50 transition-colors"
                  >
                    Luma
                    <Link2 className="w-4 h-4" />
                  </a>
                ) : lumaEditingId === event.id ? (
                  <div>
                    <div className="flex gap-2">
                      <input
                        type="url"
                        autoFocus
                        value={lumaInput}
                        onChange={(e) => setLumaInput(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter" && lumaInput.trim()) submitLuma(event.id); }}
                        placeholder="https://luma.com/…"
                        className="flex-1 px-3 py-1.5 border border-black rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-300"
                      />
                      <button
                        onClick={() => submitLuma(event.id)}
                        disabled={lumaBusy || !lumaInput.trim()}
                        className="px-3 py-1.5 bg-gray-200 text-black rounded-lg text-sm hover:bg-gray-300 disabled:opacity-50 transition-colors"
                      >
                        {lumaBusy ? "Attaching…" : "Attach"}
                      </button>
                      <button
                        onClick={() => { setLumaEditingId(null); setLumaError(null); }}
                        className="p-1.5 text-gray-500 hover:text-gray-900"
                        aria-label="Cancel"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                    {lumaError && <p className="text-red-600 text-xs mt-1">{lumaError}</p>}
                  </div>
                ) : (
                  <button
                    onClick={() => { setLumaEditingId(event.id); setLumaInput(""); setLumaError(null); }}
                    className="inline-flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900"
                  >
                    <Link2 className="w-4 h-4" />
                    Add Luma
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Lines View */}
      {!loading && !error && viewMode === 'lines' && filteredEvents.length > 0 && (
        <div className="bg-white rounded-2xl border border-black overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-black">
              <tr>
                <th className="text-left px-6 py-3 text-sm text-gray-600">Event</th>
                <th className="text-left px-6 py-3 text-sm text-gray-600">Tag</th>
                <th className="text-left px-6 py-3 text-sm text-gray-600">Date</th>
                <th className="text-left px-6 py-3 text-sm text-gray-600">Location</th>
                <th className="text-left px-6 py-3 text-sm text-gray-600">Owner</th>
                <th className="text-left px-6 py-3 text-sm text-gray-600">Checked in</th>
                <th className="text-left px-6 py-3 text-sm text-gray-600"></th>
              </tr>
            </thead>
            <tbody>
              {filteredEvents.map((event) => (
                <tr
                  key={event.id}
                  className="group/row border-b border-gray-100 hover:bg-gray-50 cursor-pointer"
                  onClick={() => setSelectedEventId(event.id)}
                >
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <LumaSwatch url={event.coverImageUrl} fallback={tagColor(event.tags[0])} />
                      <div>
                        <p className="font-medium">{event.title}</p>
                        {event.seriesName && <p className="text-sm text-gray-500">{event.seriesName}</p>}
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <TagStack tags={event.tags} editable expandOnHover={false} onChange={(tags) => setTags(event.id, tags)} onTagClick={setTagFilter} />
                  </td>
                  <td className="px-6 py-4 text-sm transition-opacity group-hover/row:opacity-40">{event.date ?? <span className="text-gray-400">{NOT_CAPTURED}</span>}</td>
                  <td className="px-6 py-4 text-sm transition-opacity group-hover/row:opacity-40">{event.location ?? <span className="text-gray-400">{NOT_CAPTURED}</span>}</td>
                  <td className="px-6 py-4 text-sm transition-opacity group-hover/row:opacity-40">{event.owner ?? <span className="text-gray-400">{NOT_CAPTURED}</span>}</td>
                  <td className="px-6 py-4 text-sm transition-opacity group-hover/row:opacity-40">{event.attendeeCount ?? <span className="text-gray-400">—</span>}</td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-1">
                      <button
                        onClick={(e) => { e.stopPropagation(); toggleBookmark(event.id); }}
                        className="p-2 hover:bg-gray-200 rounded-lg transition-colors"
                      >
                        <Bookmark className={`w-4 h-4 ${bookmarkedEvents.has(event.id) ? "fill-current text-gray-900" : "text-gray-400"}`} />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); setDeleteTarget(event); }}
                        className="p-2 text-gray-400 hover:text-red-600 hover:bg-gray-200 rounded-lg transition-colors opacity-0 group-hover/row:opacity-100"
                        aria-label="Delete event"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {createOpen && (
        <CreateEventModal
          events={events}
          onClose={() => setCreateOpen(false)}
          onCreated={async (id) => { await load(); setCreateOpen(false); setSelectedEventId(id); }}
        />
      )}

      {deleteTarget && (
        <ConfirmModal
          title="Delete event?"
          message={`Permanently delete “${deleteTarget.title}” and everything attached to it (budget, vendors, planning, attendee links). This can’t be undone.`}
          confirmLabel="Delete"
          danger
          onConfirm={confirmDelete}
          onClose={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
