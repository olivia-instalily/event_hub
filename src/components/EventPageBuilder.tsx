import { useEffect, useRef, useState } from "react";
import {
  Calendar, MapPin, Monitor, Smartphone, Sparkles, Trash2, Eye, EyeOff,
  ChevronUp, ChevronDown, Maximize2, X, Plus, Linkedin,
} from "lucide-react";
import {
  savePageDraft, generatePageDraft, defaultPageDraft, listEventSpeakers, reorderSpeakers,
  type EventPlanning, type PageDraft, type AgendaItem, type Speaker2, type PageFont,
} from "../lib/db";
import { FileDrop } from "./FileDrop";
import { tagColor } from "../lib/tags";

const SECTION_LABELS: Record<string, string> = {
  hero: "Hero", about: "About", agenda: "Agenda", speakers: "Speakers", details: "Details & RSVP", gallery: "Gallery", logos: "Logos", closing: "Closing CTA",
};
const FONT_CLASS: Record<PageFont, string> = { inter: "font-sans", serif: "font-serif", grotesk: "font-mono" };
const FONT_LABEL: Record<PageFont, string> = { inter: "Sans", serif: "Serif", grotesk: "Mono" };

function normalize(d: PageDraft): PageDraft {
  const def = defaultPageDraft();
  return {
    theme: { ...def.theme, ...(d.theme ?? {}) },
    hero: { ...def.hero, ...(d.hero ?? {}) },
    about: { ...def.about, ...(d.about ?? {}) },
    agenda: { ...def.agenda, ...(d.agenda ?? {}) },
    speakers: { ...def.speakers, ...(d.speakers ?? {}) },
    details: { ...def.details, ...(d.details ?? {}) },
    gallery: { ...def.gallery, ...(d.gallery ?? {}) },
    logos: { ...def.logos, ...(d.logos ?? {}) },
    closing: { ...def.closing, ...(d.closing ?? {}) },
    order: (d.order ?? def.order).filter((k) => def.order.includes(k)),
    visible: { ...def.visible, ...(d.visible ?? {}) },
  };
}
const move = <T,>(arr: T[], i: number, dir: -1 | 1): T[] => {
  const j = i + dir;
  if (j < 0 || j >= arr.length) return arr;
  const next = arr.slice();
  [next[i], next[j]] = [next[j], next[i]];
  return next;
};

// Fade/slide-in on scroll (gated by the scrollAnim theme flag).
function Reveal({ animate, children }: { animate: boolean; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(!animate);
  useEffect(() => {
    if (!animate) { setShown(true); return; }
    const el = ref.current; if (!el) return;
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setShown(true); io.disconnect(); } }, { threshold: 0.12 });
    io.observe(el);
    return () => io.disconnect();
  }, [animate]);
  return <div ref={ref} className={`transition-all duration-700 ease-out ${shown ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"}`}>{children}</div>;
}

// ── Live preview ──────────────────────────────────────────────────────────────
function EventPagePreview({ plan, draft, speakers, full, animate }: { plan: EventPlanning; draft: PageDraft; speakers: Speaker2[]; full: boolean; animate: boolean }) {
  const accent = draft.theme.accent;
  const heroBg = draft.theme.bgImageUrl ?? draft.hero.coverUrl ?? plan.coverImageUrl;
  const btn = (label: string) => plan.lumaUrl
    ? <a href={plan.lumaUrl} target="_blank" rel="noreferrer" className="inline-block px-5 py-2.5 rounded-lg text-sm text-white" style={{ backgroundColor: accent }}>{label}</a>
    : <span className="inline-block px-5 py-2.5 rounded-lg text-sm text-white/90" style={{ backgroundColor: accent }}>{label}</span>;

  const renderSection = (key: string) => {
    if (!draft.visible[key]) return null;
    switch (key) {
      case "about":
        return draft.about.body ? <section className="max-w-3xl mx-auto px-6"><h2 className="text-2xl font-medium mb-3">About</h2><p className="text-gray-700 whitespace-pre-wrap leading-relaxed">{draft.about.body}</p></section> : null;
      case "agenda":
        return draft.agenda.items.length ? (
          <section className="max-w-3xl mx-auto px-6">
            <h2 className="text-2xl font-medium mb-4">{draft.agenda.title}</h2>
            <div className="divide-y divide-gray-100">
              {draft.agenda.items.map((it, i) => (
                <div key={i} className="py-3 flex gap-4">
                  <div className="w-24 shrink-0 font-medium" style={{ color: accent }}>{it.time}</div>
                  <div><p className="font-medium">{it.title}</p>{it.desc && <p className="text-sm text-gray-600 mt-0.5">{it.desc}</p>}</div>
                </div>
              ))}
            </div>
          </section>
        ) : null;
      case "speakers":
        return speakers.length ? (
          <section className="max-w-5xl mx-auto px-6">
            <h2 className="text-2xl font-medium mb-5 text-center">{draft.speakers.title}</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-5">
              {speakers.map((s) => (
                <div key={s.attendeeId} className="text-center">
                  {s.photoUrl ? <img src={s.photoUrl} alt="" className="w-24 h-24 rounded-full object-cover mx-auto" /> : <div className="w-24 h-24 rounded-full bg-gray-100 mx-auto" />}
                  <p className="font-medium mt-2 leading-tight">{s.name}</p>
                  {(s.title || s.org) && <p className="text-xs text-gray-500">{[s.title, s.org].filter(Boolean).join(" · ")}</p>}
                  {s.linkedinUrl && <a href={s.linkedinUrl} target="_blank" rel="noreferrer" className="inline-block mt-1 text-gray-400 hover:text-gray-700"><Linkedin className="w-4 h-4 mx-auto" /></a>}
                </div>
              ))}
            </div>
          </section>
        ) : null;
      case "details":
        return (
          <section className="max-w-3xl mx-auto px-6">
            <div className="rounded-xl border border-gray-200 p-5">
              <div className="flex flex-wrap gap-x-8 gap-y-2 text-gray-700">
                <span className="inline-flex items-center gap-2"><Calendar className="w-4 h-4 text-gray-400" />{plan.date ?? "Date TBD"}</span>
                <span className="inline-flex items-center gap-2"><MapPin className="w-4 h-4 text-gray-400" />{plan.location ?? "Location TBD"}</span>
              </div>
              <div className="mt-4">{btn(draft.details.rsvpLabel || "RSVP")}</div>
            </div>
          </section>
        );
      case "gallery":
        return draft.gallery.images.length ? (
          <section className="max-w-5xl mx-auto px-6">
            <h2 className="text-2xl font-medium mb-3">Gallery</h2>
            <div className={`grid gap-2 ${full ? "grid-cols-3" : "grid-cols-2"}`}>{draft.gallery.images.map((src, i) => <img key={i} src={src} alt="" className="w-full h-40 object-cover rounded-lg" />)}</div>
          </section>
        ) : null;
      case "logos":
        return draft.logos.images.length ? (
          <section className="max-w-4xl mx-auto px-6">
            <div className="flex flex-wrap items-center justify-center gap-8">{draft.logos.images.map((src, i) => <img key={i} src={src} alt="" className="h-12 object-contain grayscale opacity-80" />)}</div>
          </section>
        ) : null;
      case "closing":
        return (
          <section className="text-center px-6 py-12" style={{ backgroundColor: `${accent}0d` }}>
            <p className="text-gray-500 mb-1">{[plan.date, plan.location].filter(Boolean).join(" · ")}</p>
            <h2 className="text-2xl font-medium">{draft.closing.headline}</h2>
            {draft.closing.body && <p className="text-gray-600 mt-1 mb-4">{draft.closing.body}</p>}
            {btn(draft.closing.rsvpLabel || "RSVP")}
          </section>
        );
      default: return null;
    }
  };

  return (
    <div className={`bg-white text-gray-900 ${FONT_CLASS[draft.theme.font]}`} style={draft.theme.bgColor ? { backgroundColor: draft.theme.bgColor } : undefined}>
      {draft.visible.hero && (
        <div className={`relative flex items-end overflow-hidden ${full ? "min-h-screen" : "h-[26rem]"}`}>
          {heroBg && <img src={heroBg} alt="" className="absolute inset-0 w-full h-full object-cover" />}
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent" />
          <div className="relative p-8 text-white max-w-4xl">
            <div className="flex gap-1.5 mb-2">{plan.tags.map((t) => <span key={t} className={`px-2 py-0.5 rounded-full text-xs ${tagColor(t)}`}>{t}</span>)}</div>
            <h1 className="text-4xl font-semibold leading-tight">{draft.hero.headline || plan.title}</h1>
            {draft.hero.subhead && <p className="text-white/85 mt-2 text-lg">{draft.hero.subhead}</p>}
            <p className="text-white/75 mt-3 text-sm">{[plan.date, plan.location].filter(Boolean).join(" · ")}</p>
            <div className="mt-4">{btn(draft.details.rsvpLabel || "RSVP")}</div>
          </div>
        </div>
      )}
      <div className="py-10 space-y-12">
        {draft.order.map((key) => {
          const node = renderSection(key);
          return node ? <Reveal key={key} animate={animate}>{node}</Reveal> : null;
        })}
      </div>
      <footer className="border-t border-gray-100 py-6 text-center text-xs text-gray-400">© {new Date().getFullYear()} {plan.title}</footer>
    </div>
  );
}

// ── Builder ────────────────────────────────────────────────────────────────────
export function EventPageBuilder({ plan }: { plan: EventPlanning }) {
  const eventId = plan.id;
  const [draft, setDraft] = useState<PageDraft | null>(plan.pageDraft ? normalize(plan.pageDraft) : null);
  const [speakers, setSpeakers] = useState<Speaker2[]>([]);
  const [mobile, setMobile] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(false);

  useEffect(() => { listEventSpeakers(eventId).then(setSpeakers).catch(() => {}); }, [eventId]);

  const set = (patch: (d: PageDraft) => PageDraft) => setDraft((d) => (d ? patch(d) : d));
  const persist = async (d: PageDraft) => { setSaving(true); try { await savePageDraft(eventId, d); setSavedAt(true); setTimeout(() => setSavedAt(false), 2000); } finally { setSaving(false); } };
  const save = () => { if (draft) void persist(draft); };

  const generate = async () => {
    setGenerating(true);
    try {
      const copy = await generatePageDraft(eventId);
      const base = draft ?? defaultPageDraft();
      const next: PageDraft = { ...base, hero: { ...base.hero, headline: copy.headline, subhead: copy.subhead }, about: { ...base.about, body: copy.aboutBody } };
      setDraft(next); await persist(next);
    } finally { setGenerating(false); }
  };

  const onGalleryUpload = (which: "gallery" | "logos") => (url: string) => setDraft((d) => {
    const next = d ?? defaultPageDraft();
    const merged = { ...next, [which]: { images: [...next[which].images, url] } } as PageDraft;
    void persist(merged);
    return merged;
  });
  const reorderSpk = async (i: number, dir: -1 | 1) => {
    const next = move(speakers, i, dir);
    setSpeakers(next);
    await reorderSpeakers(eventId, next.map((s) => s.attendeeId));
  };

  if (!draft) {
    return (
      <div className="bg-white rounded-2xl border border-black p-8 text-center">
        <p className="text-gray-600 mb-4">No page yet. Generate a draft from this event's info — then edit copy, add sections, drop in images. No code needed.</p>
        <button onClick={generate} disabled={generating} className="inline-flex items-center gap-1 px-4 py-2 bg-gray-900 text-white rounded-lg text-sm hover:bg-gray-800 disabled:opacity-50">
          <Sparkles className="w-4 h-4" /> {generating ? "Generating…" : "Generate draft from event info"}
        </button>
      </div>
    );
  }

  return (
    <div>
      {/* Toolbar */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <button onClick={generate} disabled={generating} className="inline-flex items-center gap-1 px-3 py-1.5 border border-gray-300 rounded-lg text-sm hover:bg-gray-50 disabled:opacity-50"><Sparkles className="w-3.5 h-3.5" /> {generating ? "Generating…" : "Regenerate copy"}</button>
          <button onClick={save} disabled={saving} className="inline-flex items-center gap-1 px-3 py-1.5 bg-gray-200 rounded-lg text-sm hover:bg-gray-300 disabled:opacity-50">{saving ? "Saving…" : "Save"}</button>
          {savedAt && !saving && <span className="text-xs text-gray-400">Saved</span>}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setFullscreen(true)} className="inline-flex items-center gap-1 px-3 py-1.5 border border-gray-300 rounded-lg text-sm hover:bg-gray-50"><Maximize2 className="w-3.5 h-3.5" /> Preview</button>
          <div className="flex items-center gap-1 bg-white border border-gray-300 rounded-lg p-1">
            <button onClick={() => setMobile(false)} className={`p-1.5 rounded ${!mobile ? "bg-gray-100" : "hover:bg-gray-50"}`} title="Desktop"><Monitor className="w-4 h-4" /></button>
            <button onClick={() => setMobile(true)} className={`p-1.5 rounded ${mobile ? "bg-gray-100" : "hover:bg-gray-50"}`} title="Mobile"><Smartphone className="w-4 h-4" /></button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        {/* Editor */}
        <div className="space-y-4">
          {/* Theme */}
          <div className="bg-white rounded-2xl border border-black p-4 space-y-3">
            <p className="text-sm font-medium">Theme</p>
            <div className="flex items-center gap-2 text-sm flex-wrap">
              <span className="text-gray-500">Font</span>
              {(["inter", "serif", "grotesk"] as PageFont[]).map((f) => (
                <button key={f} onClick={() => set((d) => ({ ...d, theme: { ...d.theme, font: f } }))} className={`px-2.5 py-1 rounded-full text-xs border ${draft.theme.font === f ? "bg-gray-900 text-white border-gray-900" : "border-gray-200 hover:bg-gray-50"}`}>{FONT_LABEL[f]}</button>
              ))}
              <span className="text-gray-500 ml-2">Accent</span>
              <input type="color" value={draft.theme.accent} onChange={(e) => set((d) => ({ ...d, theme: { ...d.theme, accent: e.target.value } }))} className="w-7 h-7 rounded border border-gray-200 p-0" />
              <label className="inline-flex items-center gap-1 ml-2 text-gray-500"><input type="checkbox" checked={draft.theme.scrollAnim} onChange={(e) => set((d) => ({ ...d, theme: { ...d.theme, scrollAnim: e.target.checked } }))} /> Scroll animations</label>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <span className="text-gray-500">Hero background</span>
              {draft.theme.bgImageUrl && <img src={draft.theme.bgImageUrl} alt="" className="w-8 h-8 rounded object-cover" />}
              <FileDrop compact label="drop full-bleed image" onUploaded={(url) => set((d) => ({ ...d, theme: { ...d.theme, bgImageUrl: url } }))} />
              {draft.theme.bgImageUrl && <button onClick={() => set((d) => ({ ...d, theme: { ...d.theme, bgImageUrl: null } }))} className="text-xs text-gray-400 hover:text-red-600">reset</button>}
            </div>
          </div>

          {/* Sections — order + visibility */}
          <div className="bg-white rounded-2xl border border-black p-4">
            <p className="text-sm font-medium mb-2">Sections <span className="text-gray-400 font-normal">(reorder + show/hide)</span></p>
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-sm text-gray-400 px-1"><span className="flex-1">Hero (fixed top)</span><button onClick={() => set((d) => ({ ...d, visible: { ...d.visible, hero: !d.visible.hero } }))}>{draft.visible.hero ? <Eye className="w-4 h-4 text-gray-700" /> : <EyeOff className="w-4 h-4" />}</button></div>
              {draft.order.map((key, i) => (
                <div key={key} className="flex items-center gap-2 text-sm px-1">
                  <span className="flex-1">{SECTION_LABELS[key]}</span>
                  <button onClick={() => set((d) => ({ ...d, order: move(d.order, i, -1) }))} disabled={i === 0} className="text-gray-400 hover:text-gray-800 disabled:opacity-30"><ChevronUp className="w-4 h-4" /></button>
                  <button onClick={() => set((d) => ({ ...d, order: move(d.order, i, 1) }))} disabled={i === draft.order.length - 1} className="text-gray-400 hover:text-gray-800 disabled:opacity-30"><ChevronDown className="w-4 h-4" /></button>
                  <button onClick={() => set((d) => ({ ...d, visible: { ...d.visible, [key]: !d.visible[key] } }))}>{draft.visible[key] ? <Eye className="w-4 h-4 text-gray-700" /> : <EyeOff className="w-4 h-4 text-gray-400" />}</button>
                </div>
              ))}
            </div>
          </div>

          {/* Hero */}
          <div className="bg-white rounded-2xl border border-black p-4 space-y-2">
            <p className="text-sm font-medium">Hero</p>
            <input value={draft.hero.headline} onChange={(e) => set((d) => ({ ...d, hero: { ...d.hero, headline: e.target.value } }))} placeholder="Headline" className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
            <input value={draft.hero.subhead} onChange={(e) => set((d) => ({ ...d, hero: { ...d.hero, subhead: e.target.value } }))} placeholder="Subhead" className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
          </div>

          {/* About */}
          <div className="bg-white rounded-2xl border border-black p-4 space-y-2">
            <p className="text-sm font-medium">About</p>
            <textarea value={draft.about.body} onChange={(e) => set((d) => ({ ...d, about: { body: e.target.value } }))} rows={4} placeholder="About this event…" className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
          </div>

          {/* Agenda */}
          <div className="bg-white rounded-2xl border border-black p-4 space-y-2">
            <p className="text-sm font-medium">Agenda</p>
            {draft.agenda.items.map((it, i) => (
              <div key={i} className="flex gap-1.5 items-start">
                <input value={it.time} onChange={(e) => set((d) => ({ ...d, agenda: { ...d.agenda, items: d.agenda.items.map((x, j) => j === i ? { ...x, time: e.target.value } : x) } }))} placeholder="1:00 PM" className="w-24 px-2 py-1 border border-gray-300 rounded text-sm" />
                <div className="flex-1 space-y-1">
                  <input value={it.title} onChange={(e) => set((d) => ({ ...d, agenda: { ...d.agenda, items: d.agenda.items.map((x, j) => j === i ? { ...x, title: e.target.value } : x) } }))} placeholder="Session title" className="w-full px-2 py-1 border border-gray-300 rounded text-sm" />
                  <input value={it.desc} onChange={(e) => set((d) => ({ ...d, agenda: { ...d.agenda, items: d.agenda.items.map((x, j) => j === i ? { ...x, desc: e.target.value } : x) } }))} placeholder="Description" className="w-full px-2 py-1 border border-gray-200 rounded text-sm" />
                </div>
                <div className="flex flex-col">
                  <button onClick={() => set((d) => ({ ...d, agenda: { ...d.agenda, items: move(d.agenda.items, i, -1) } }))} disabled={i === 0} className="text-gray-400 hover:text-gray-800 disabled:opacity-30"><ChevronUp className="w-4 h-4" /></button>
                  <button onClick={() => set((d) => ({ ...d, agenda: { ...d.agenda, items: move(d.agenda.items, i, 1) } }))} disabled={i === draft.agenda.items.length - 1} className="text-gray-400 hover:text-gray-800 disabled:opacity-30"><ChevronDown className="w-4 h-4" /></button>
                </div>
                <button onClick={() => set((d) => ({ ...d, agenda: { ...d.agenda, items: d.agenda.items.filter((_, j) => j !== i) } }))} className="text-gray-300 hover:text-red-600 mt-1"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
            ))}
            <button onClick={() => set((d) => ({ ...d, agenda: { ...d.agenda, items: [...d.agenda.items, { time: "", title: "", desc: "" } as AgendaItem] } }))} className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900"><Plus className="w-4 h-4" /> Add agenda item</button>
          </div>

          {/* Speakers (data-bound) */}
          <div className="bg-white rounded-2xl border border-black p-4 space-y-2">
            <p className="text-sm font-medium">Speakers</p>
            <p className="text-xs text-gray-400">Speakers are people tagged “Speaker” for this event (People tab → a person → Mark as speaker). Reorder + headshots here.</p>
            {speakers.length === 0 ? <p className="text-sm text-gray-400">No speakers tagged yet.</p> : (
              <div className="space-y-1">
                {speakers.map((s, i) => (
                  <div key={s.attendeeId} className="flex items-center gap-2 text-sm">
                    {s.photoUrl ? <img src={s.photoUrl} alt="" className="w-7 h-7 rounded-full object-cover" /> : <div className="w-7 h-7 rounded-full bg-gray-100" />}
                    <span className="flex-1 truncate">{s.name}{s.org ? <span className="text-gray-400"> · {s.org}</span> : ""}</span>
                    <button onClick={() => reorderSpk(i, -1)} disabled={i === 0} className="text-gray-400 hover:text-gray-800 disabled:opacity-30"><ChevronUp className="w-4 h-4" /></button>
                    <button onClick={() => reorderSpk(i, 1)} disabled={i === speakers.length - 1} className="text-gray-400 hover:text-gray-800 disabled:opacity-30"><ChevronDown className="w-4 h-4" /></button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Details */}
          <div className="bg-white rounded-2xl border border-black p-4 space-y-2">
            <p className="text-sm font-medium">Details & RSVP</p>
            <input value={draft.details.rsvpLabel} onChange={(e) => set((d) => ({ ...d, details: { rsvpLabel: e.target.value } }))} placeholder="RSVP button label" className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
            <p className="text-xs text-gray-400">Date &amp; location pull live from the event{plan.lumaUrl ? "; RSVP links to the attached Luma." : ". Attach a Luma link to enable RSVP."}</p>
          </div>

          {/* Gallery */}
          <div className="bg-white rounded-2xl border border-black p-4 space-y-3">
            <p className="text-sm font-medium">Image gallery</p>
            <FileDrop label="Drag & drop an image" onUploaded={onGalleryUpload("gallery")} />
            {draft.gallery.images.length > 0 && (
              <div className="grid grid-cols-3 gap-2">
                {draft.gallery.images.map((src, i) => (
                  <div key={i} className="relative group">
                    <img src={src} alt="" className="w-full h-20 object-cover rounded-lg" />
                    <button onClick={() => set((d) => ({ ...d, gallery: { images: d.gallery.images.filter((_, j) => j !== i) } }))} className="absolute top-1 right-1 w-5 h-5 rounded-full bg-gray-900/80 text-white flex items-center justify-center opacity-0 group-hover:opacity-100"><Trash2 className="w-3 h-3" /></button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Logos */}
          <div className="bg-white rounded-2xl border border-black p-4 space-y-3">
            <p className="text-sm font-medium">Partner logos</p>
            <FileDrop label="Drag & drop a logo" onUploaded={onGalleryUpload("logos")} />
            {draft.logos.images.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {draft.logos.images.map((src, i) => (
                  <div key={i} className="relative group">
                    <img src={src} alt="" className="h-10 object-contain rounded border border-gray-100 px-2" />
                    <button onClick={() => set((d) => ({ ...d, logos: { images: d.logos.images.filter((_, j) => j !== i) } }))} className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-gray-900/80 text-white flex items-center justify-center opacity-0 group-hover:opacity-100"><X className="w-2.5 h-2.5" /></button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Closing */}
          <div className="bg-white rounded-2xl border border-black p-4 space-y-2">
            <p className="text-sm font-medium">Closing CTA</p>
            <input value={draft.closing.headline} onChange={(e) => set((d) => ({ ...d, closing: { ...d.closing, headline: e.target.value } }))} placeholder="Headline (e.g. Seats are limited.)" className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm" />
            <input value={draft.closing.body} onChange={(e) => set((d) => ({ ...d, closing: { ...d.closing, body: e.target.value } }))} placeholder="Body" className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm" />
            <input value={draft.closing.rsvpLabel} onChange={(e) => set((d) => ({ ...d, closing: { ...d.closing, rsvpLabel: e.target.value } }))} placeholder="RSVP button label" className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm" />
          </div>
        </div>

        {/* Side preview */}
        <div className="lg:sticky lg:top-4">
          <p className="text-xs text-gray-400 mb-2">Live preview · <button onClick={() => setFullscreen(true)} className="underline hover:text-gray-700">open full screen</button></p>
          <div className="bg-gray-50 border border-gray-200 rounded-2xl overflow-hidden">
            <div className={`mx-auto ${mobile ? "max-w-[24rem]" : "max-w-full"} transition-[max-width] duration-200`}>
              <EventPagePreview plan={plan} draft={draft} speakers={speakers} full={false} animate={false} />
            </div>
          </div>
        </div>
      </div>

      {/* Full-screen interactive preview */}
      {fullscreen && (
        <div className="fixed inset-0 z-50 bg-white overflow-y-auto">
          <button onClick={() => setFullscreen(false)} className="fixed top-4 right-4 z-10 w-9 h-9 rounded-full bg-gray-900 text-white flex items-center justify-center shadow-lg hover:bg-gray-800" aria-label="Close preview"><X className="w-5 h-5" /></button>
          <EventPagePreview plan={plan} draft={draft} speakers={speakers} full animate={draft.theme.scrollAnim} />
        </div>
      )}
    </div>
  );
}
