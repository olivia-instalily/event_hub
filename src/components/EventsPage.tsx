import { Bookmark, Calendar, MapPin, LayoutGrid, List, Plus, ChevronDown, Link2, X, Search, Trash2, Check } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { EventDetailPage } from "./EventDetailPage";
import { listEvents, attachLuma, updateEventTags, setEventFormat, generateTemplate, createPlanningEvent, backfillEvent, deleteEvent, type EventListItem, type EventStatus, type GeneratedTemplate } from "../lib/db";
import { TagStack } from "./TagStack";
import { FormatPicker, parseFormats, joinFormats } from "./FormatPicker";
import { LocationInput } from "./LocationEdit";
import { canonicalCity } from "../lib/cities";
import { EventPlanningPage } from "./EventPlanningPage";
import { ConfirmModal } from "./Modal";
import { EVENT_TAGS, TAG_CATEGORIES, tagColor } from "../lib/tags";

const NOT_CAPTURED = "Not captured";

// Solo "Just us" events get tagged by audience: internal events draw from the
// Internal taxonomy category, external from the Hosted one.
const INTERNAL_TAGS = TAG_CATEGORIES.find((c) => c.name === "Internal")?.tags ?? [];
const EXTERNAL_TAGS = TAG_CATEGORIES.find((c) => c.name === "Hosted")?.tags ?? [];

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

/** Site-styled select dropdown — replaces the native <select> so the menu matches the
 *  rest of the UI (white panel, black border, rounded) instead of the OS picker. */
function SelectMenu({ value, options, onChange, className = "" }: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
  className?: string;
}) {
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
  const current = options.find((o) => o.value === value) ?? options[0];
  return (
    <div className={`relative ${className}`} ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 w-full px-4 py-2 pr-3 bg-white border border-black rounded-lg text-sm hover:bg-gray-50 cursor-pointer"
      >
        <span className="truncate text-gray-700">{current?.label}</span>
        <ChevronDown className="w-4 h-4 text-gray-400 shrink-0 ml-auto" />
      </button>
      {open && (
        <div className="absolute z-50 mt-1 left-0 min-w-full max-h-72 overflow-y-auto bg-white border border-black rounded-lg shadow-lg p-1">
          {options.map((o) => (
            <button
              key={o.value}
              onClick={() => { onChange(o.value); setOpen(false); }}
              className={`flex items-center justify-between gap-2 w-full text-left px-2 py-1.5 rounded text-sm hover:bg-gray-50 ${value === o.value ? 'bg-gray-100' : ''}`}
            >
              <span className="truncate">{o.label}</span>
              {value === o.value && <Check className="w-4 h-4 text-gray-700 shrink-0" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
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
          {/* Grouped by the tag taxonomy — same category headers + colors as the ＋ add-tag
              dropdown. The full taxonomy is always shown so it matches the ＋ dropdown exactly. */}
          {TAG_CATEGORIES.map((cat) => {
            return (
              <div key={cat.name} className="mt-1">
                <p className="px-2 pt-1.5 pb-0.5 text-[10px] font-semibold tracking-wide uppercase text-gray-400">{cat.name}</p>
                {cat.tags.map((t) => (
                  <button key={t} onClick={() => pick(t)} className={`flex items-center justify-between gap-2 w-full text-left px-2 py-1 rounded hover:bg-gray-50 ${value === t ? 'bg-gray-100' : ''}`}>
                    <span className={`px-2 py-0.5 rounded-full text-xs ${tagColor(t)}`}>{t}</span>
                    {value === t && <Check className="w-4 h-4 text-gray-700 shrink-0" />}
                  </button>
                ))}
              </div>
            );
          })}
          {/* Custom/legacy tags outside the taxonomy. */}
          {tags.filter((t) => !EVENT_TAGS.includes(t)).length > 0 && (
            <div className="mt-1 border-t border-gray-100 pt-1">
              <p className="px-2 pt-1 pb-0.5 text-[10px] font-semibold tracking-wide uppercase text-gray-400">Other</p>
              {tags.filter((t) => !EVENT_TAGS.includes(t)).map((t) => (
                <button key={t} onClick={() => pick(t)} className={`flex items-center justify-between gap-2 w-full text-left px-2 py-1 rounded hover:bg-gray-50 ${value === t ? 'bg-gray-100' : ''}`}>
                  <span className={`px-2 py-0.5 rounded-full text-xs ${tagColor(t)}`}>{t}</span>
                  {value === t && <Check className="w-4 h-4 text-gray-700 shrink-0" />}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CreateEventModal({ events, onClose, onCreated }: { events: EventListItem[]; onClose: () => void; onCreated: (eventId: string) => void }) {
  const [mode, setMode] = useState<'choose' | 'planFork' | 'audience' | 'planning' | 'backfill'>('choose');
  // Set on the planning fork: solo (InstaLILY hosts alone) vs cohost (sharing hosting & cost).
  const [planKind, setPlanKind] = useState<'solo' | 'cohost'>('solo');
  // Solo path only: internal vs external audience, then the specific taxonomy tag to apply.
  const [audience, setAudience] = useState<'internal' | 'external' | null>(null);
  const [eventTag, setEventTag] = useState<string | null>(null);
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

  const createPlanned = async () => {
    if (!draft || !meta.name.trim()) return;
    setCreating(true); setCreateError(null);
    try {
      // Budget make-up isn't set during create — it's populated later on the dashboard.
      const template = { ...draft, budgetLines: [] };
      const id = await createPlanningEvent({ name: meta.name.trim(), date: meta.date || null, location: meta.location.trim() || null, tags: eventTag ? [eventTag] : [], template, hosting: planKind, coHost: planKind === 'cohost' ? meta.coHost : null, modeledOnEventId: selected });
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
    // Only suggest past events sharing the tag chosen for this event, so the starting
    // point matches its kind. No tag chosen yet → no constraint.
    .filter((e) => !eventTag || e.tags.includes(eventTag))
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
      // Internal events (team socials, company milestones) don't need a marketing/promotion
      // workstream by default — drop it from the drafted workstreams. Still re-addable below.
      const isInternal = audience === 'internal' || (!!eventTag && INTERNAL_TAGS.includes(eventTag));
      if (isInternal) {
        t.progressCategories = t.progressCategories.filter(
          (p) => !/market|promo|advertis|publicity|press|\bPR\b|\bcomms\b/i.test(p),
        );
      }
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
              <button onClick={() => { setPlanKind('solo'); setMode('audience'); }} className="border border-black rounded-xl p-6 text-left hover:bg-gray-50 transition-colors">
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
        ) : mode === 'audience' ? (
          <div>
            <p className="text-sm text-gray-600 mb-4">Is this an internal or external event?</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <button onClick={() => { setAudience('internal'); setEventTag(null); }} className={`border rounded-xl p-6 text-left transition-colors ${audience === 'internal' ? 'border-black ring-2 ring-black' : 'border-black hover:bg-gray-50'}`}>
                <p className="text-lg font-medium">Internal</p>
                <p className="text-sm text-gray-500 mt-1">For our own team — team socials and company milestones.</p>
              </button>
              <button onClick={() => { setAudience('external'); setEventTag(null); }} className={`border rounded-xl p-6 text-left transition-colors ${audience === 'external' ? 'border-black ring-2 ring-black' : 'border-black hover:bg-gray-50'}`}>
                <p className="text-lg font-medium">External</p>
                <p className="text-sm text-gray-500 mt-1">For clients, partners, or the wider community.</p>
              </button>
            </div>

            {audience && (
              <div className="mt-6">
                <h3 className="text-sm font-medium mb-3">Pick a tag</h3>
                <div className="flex flex-wrap gap-2">
                  {(audience === 'internal' ? INTERNAL_TAGS : EXTERNAL_TAGS).map((t) => (
                    <button
                      key={t}
                      onClick={() => { setEventTag(t); setMode('planning'); }}
                      className={`px-3 py-1.5 rounded-full text-sm transition ${tagColor(t)} ${eventTag === t ? 'ring-2 ring-black' : 'hover:brightness-95'}`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-6 pt-4 border-t border-gray-100">
              <button onClick={() => { setAudience(null); setEventTag(null); setMode('planFork'); }} className="text-sm text-gray-600 hover:text-gray-900">← Back</button>
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

                {/* Budget make-up is set up later on the planning dashboard (Review budget /
                    Budget tab), where it can be dropped in as an exact breakdown. */}

                <div>
                  <h3 className="text-sm font-medium mb-2">Progress workstreams</h3>
                  <ChipEditor items={draft.progressCategories} onChange={(v) => patch({ progressCategories: v })} placeholder="Add workstream" />
                </div>
              </div>
            )}

            {createError && <p className="text-red-600 text-sm mt-4">{createError}</p>}
            <div className="flex items-center justify-between mt-6 pt-4 border-t border-gray-100">
              <button onClick={() => (draft ? setDraft(null) : setMode(planKind === 'solo' ? 'audience' : 'planFork'))} className="text-sm text-gray-600 hover:text-gray-900">← Back</button>
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

  // Reload on mount and whenever we return from an event view, so edits made inside an
  // event (e.g. formats) are reflected on its card.
  useEffect(() => { void load(); }, [selectedEventId]);

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

          <SelectMenu
            value={locationFilter}
            onChange={setLocationFilter}
            options={[{ value: 'all', label: 'All Locations' }, ...locations.map((l) => ({ value: l, label: l }))]}
          />

          <SelectMenu
            value={ownerFilter}
            onChange={setOwnerFilter}
            className="max-w-[11rem]"
            options={[{ value: 'all', label: 'All Owners' }, ...owners.map((o) => ({ value: o, label: o }))]}
          />

          <TagFilter tags={tags} value={tagFilter} onChange={setTagFilter} />

          {/* Date filter — Past / All only */}
          {showDateFilter && (
            <>
              <SelectMenu
                value={dateRange}
                onChange={(v) => setDateRange(v as typeof dateRange)}
                options={[
                  { value: 'all', label: 'Any date' },
                  { value: 'week', label: 'Past week' },
                  { value: 'month', label: 'Past month' },
                  { value: '3months', label: 'Past 3 months' },
                  { value: 'year', label: 'Past year' },
                  { value: 'custom', label: 'Custom range…' },
                ]}
              />
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
                <TagStack tags={event.tags} editable onChange={(tags) => setTags(event.id, tags)} onTagClick={setTagFilter} />
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
                <FormatPicker value={parseFormats(event.format)} onChange={(arr) => setFormatValue(event.id, joinFormats(arr))} />
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
