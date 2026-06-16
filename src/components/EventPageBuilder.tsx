import { useEffect, useRef, useState } from "react";
import {
  Calendar, MapPin, Monitor, Smartphone, Sparkles, Trash2, Eye, EyeOff,
  GripVertical, Maximize2, X, Plus, Minus,
} from "lucide-react";
import {
  DndContext, DragOverlay, PointerSensor, KeyboardSensor, closestCenter, useSensor, useSensors,
  type DragStartEvent, type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy, arrayMove, useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  savePageDraft, generatePageDraft, generatePageStyle, defaultPageDraft, listEventSpeakers, reorderSpeakers, updateAttendee,
  type EventPlanning, type PageDraft, type PageTheme, type AgendaItem, type AgendaLayout, type Speaker2, type PageFont,
} from "../lib/db";
import { FileDrop } from "./FileDrop";

// dnd-kit sortable wrapper: blocks scoot out of the way, the grabbed block follows the cursor
// (rendered in a DragOverlay), and the slot it left becomes a highlighted dashed placeholder.
type SortableHandle = Pick<ReturnType<typeof useSortable>, "setActivatorNodeRef" | "attributes" | "listeners"> & { isDragging: boolean };
function SortableSection({ id, children }: { id: string; children: (h: SortableHandle) => React.ReactNode }) {
  const s = useSortable({ id });
  const style: React.CSSProperties = { transform: CSS.Transform.toString(s.transform), transition: s.transition };
  return (
    <div ref={s.setNodeRef} style={style} className={s.isDragging ? "relative z-10" : undefined}>
      {children({ setActivatorNodeRef: s.setActivatorNodeRef, attributes: s.attributes, listeners: s.listeners, isDragging: s.isDragging })}
    </div>
  );
}

const SECTION_LABELS: Record<string, string> = {
  hero: "Hero", about: "About", agenda: "Agenda", speakers: "Speakers", details: "Details & RSVP", gallery: "Gallery", logos: "Logos", closing: "Closing CTA",
};
const FONT_CLASS: Record<PageFont, string> = { inter: "font-sans", serif: "font-serif", grotesk: "font-mono" };
const FONT_LABEL: Record<PageFont, string> = { inter: "Sans", serif: "Serif", grotesk: "Mono" };
const FONTS: PageFont[] = ["inter", "serif", "grotesk"];

// One-click looks: fonts + accent + heading treatment + agenda layout. "InstaLILY" mirrors the
// brand (lime accent, mono labels, timeline agenda); the rest are alternative starting points.
type Preset = { name: string; theme: Partial<PageTheme>; agendaLayout: AgendaLayout };
const PRESETS: Preset[] = [
  { name: "InstaLILY", theme: { headingFont: "grotesk", bodyFont: "inter", accent: "#84cc16", accentOn: "marker", headingStyle: "marker", bgColor: null, textColor: null }, agendaLayout: "timeline" },
  { name: "Editorial", theme: { headingFont: "serif", bodyFont: "serif", accent: "#111827", accentOn: "title", headingStyle: "plain", bgColor: null, textColor: null }, agendaLayout: "list" },
  { name: "Minimal", theme: { headingFont: "inter", bodyFont: "inter", accent: "#111827", accentOn: "marker", headingStyle: "plain", bgColor: null, textColor: null }, agendaLayout: "list" },
  { name: "Bold", theme: { headingFont: "grotesk", bodyFont: "grotesk", accent: "#2563eb", accentOn: "title", headingStyle: "marker", bgColor: null, textColor: null }, agendaLayout: "cards" },
];
function applyPreset(d: PageDraft, p: Preset): PageDraft {
  return { ...d, theme: { ...d.theme, ...p.theme }, headingFonts: {}, agenda: { ...d.agenda, layout: p.agendaLayout } };
}

// Read a reference image, downscale to keep the payload small, return base64 for Claude vision.
function fileToStyleToken(file: File): Promise<{ media_type: string; data: string }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const max = 1280;
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      const ctx = c.getContext("2d");
      if (!ctx) return reject(new Error("canvas unavailable"));
      ctx.drawImage(img, 0, 0, w, h);
      resolve({ media_type: "image/jpeg", data: c.toDataURL("image/jpeg", 0.85).split(",")[1] });
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("could not read image")); };
    img.src = url;
  });
}

function normalize(d: PageDraft): PageDraft {
  const def = defaultPageDraft();
  const rawTheme = (d.theme ?? {}) as Partial<PageDraft["theme"]> & { font?: PageFont };
  // Migrate the old single `font` → heading + body fonts.
  const migrated = rawTheme.font ? { headingFont: rawTheme.font, bodyFont: rawTheme.font } : {};
  return {
    theme: { ...def.theme, ...migrated, ...rawTheme },
    headingFonts: d.headingFonts ?? {},
    hero: { ...def.hero, ...(d.hero ?? {}) },
    about: { ...def.about, ...(d.about ?? {}) },
    agenda: { ...def.agenda, ...(d.agenda ?? {}) },
    speakers: { ...def.speakers, ...(d.speakers ?? {}) },
    details: { ...def.details, ...(d.details ?? {}) },
    gallery: { ...def.gallery, ...(d.gallery ?? {}) },
    logos: { ...def.logos, ...(d.logos ?? {}) },
    closing: { ...def.closing, ...(d.closing ?? {}) },
    order: (() => {
      const kept = (d.order ?? def.order).filter((k) => def.order.includes(k) || k.startsWith("divider"));
      return [...kept, ...def.order.filter((k) => !kept.includes(k))]; // append any new sections
    })(),
    visible: { ...def.visible, ...(d.visible ?? {}) },
  };
}
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

  // Heading font respects a per-section override, then the global heading font.
  const headingClass = (key?: string) => FONT_CLASS[(key && draft.headingFonts?.[key]) || draft.theme.headingFont];
  const SectionHeading = ({ k, center, children }: { k: string; center?: boolean; children: React.ReactNode }) => {
    const marker = draft.theme.headingStyle === "marker";
    const accentTitle = draft.theme.accentOn === "title";
    return (
      <div className={`flex items-center gap-2.5 ${marker ? "mb-4" : "mb-3"} ${center ? "justify-center" : ""}`}>
        {marker && <span className="inline-block w-3.5 h-3.5 rounded-[3px] shrink-0" style={{ backgroundColor: draft.theme.accentOn === "marker" ? accent : "#9ca3af" }} />}
        <h2 className={`${headingClass(k)} ${marker ? "text-sm font-semibold tracking-[0.2em] uppercase" : "text-2xl font-medium"}`} style={accentTitle ? { color: accent } : undefined}>{children}</h2>
      </div>
    );
  };

  const renderSection = (key: string) => {
    if (!draft.visible[key]) return null;
    switch (key) {
      case "about":
        return draft.about.body ? <section className="max-w-3xl mx-auto px-6"><SectionHeading k="about">{draft.about.title}</SectionHeading><p className="whitespace-pre-wrap leading-relaxed opacity-80">{draft.about.body}</p></section> : null;
      case "agenda": {
        if (!draft.agenda.items.length) return null;
        const layout = draft.agenda.layout;
        return (
          <section className="max-w-3xl mx-auto px-6">
            <SectionHeading k="agenda">{draft.agenda.title}</SectionHeading>
            {layout === "timeline" ? (
              <ol className="relative ml-1 border-l-2" style={{ borderColor: `${accent}33` }}>
                {draft.agenda.items.map((it, i) => (
                  <li key={i} className="relative pl-6 pb-6 last:pb-0">
                    <span className="absolute -left-[7px] top-1.5 w-3 h-3 rounded-full ring-4 ring-white" style={{ backgroundColor: accent }} />
                    {it.time && <div className={`text-xs font-semibold tracking-wider ${FONT_CLASS.grotesk}`} style={{ color: accent }}>{it.time}</div>}
                    <p className="font-medium mt-0.5">{it.title}</p>
                    {it.desc && <p className="text-sm opacity-70 mt-0.5">{it.desc}</p>}
                  </li>
                ))}
              </ol>
            ) : layout === "cards" ? (
              <div className="space-y-3">
                {draft.agenda.items.map((it, i) => (
                  <div key={i} className="rounded-xl border border-gray-200 p-4 flex gap-4 items-start">
                    {it.time && <span className="shrink-0 px-2.5 py-1 rounded-md text-xs font-semibold text-white" style={{ backgroundColor: accent }}>{it.time}</span>}
                    <div><p className="font-medium">{it.title}</p>{it.desc && <p className="text-sm opacity-70 mt-0.5">{it.desc}</p>}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {draft.agenda.items.map((it, i) => (
                  <div key={i} className="py-3 flex gap-4">
                    <div className="w-24 shrink-0 font-medium" style={{ color: accent }}>{it.time}</div>
                    <div><p className="font-medium">{it.title}</p>{it.desc && <p className="text-sm opacity-70 mt-0.5">{it.desc}</p>}</div>
                  </div>
                ))}
              </div>
            )}
          </section>
        );
      }
      case "speakers": {
        if (!speakers.length) return null;
        // Whole card links to the speaker's LinkedIn when present.
        const wrap = (s: Speaker2, children: React.ReactNode, cls: string) =>
          s.linkedinUrl
            ? <a key={s.attendeeId} href={s.linkedinUrl} target="_blank" rel="noreferrer" className={cls}>{children}</a>
            : <div key={s.attendeeId} className={cls}>{children}</div>;
        const isCard = draft.speakers.cardStyle === "card";
        return (
          <section className="max-w-5xl mx-auto px-6">
            <SectionHeading k="speakers" center>{draft.speakers.title}</SectionHeading>
            <div className={`grid gap-5 ${isCard ? "grid-cols-2 sm:grid-cols-3 md:grid-cols-4" : "grid-cols-2 sm:grid-cols-3 md:grid-cols-4"}`}>
              {speakers.map((s) => isCard
                ? wrap(s,
                    <>
                      <div className="aspect-[3/4] bg-gray-100 overflow-hidden">
                        {s.photoUrl && <img src={s.photoUrl} alt="" className="w-full h-full object-cover grayscale group-hover:grayscale-0 transition-[filter] duration-300" />}
                      </div>
                      <div className="p-3">
                        <p className="font-medium leading-tight">{s.name}</p>
                        {s.org && <p className="text-[11px] font-semibold tracking-wide uppercase text-gray-700 mt-1">{s.org}</p>}
                        {s.title && <p className="text-[11px] tracking-wide uppercase text-gray-400 mt-0.5">{s.title}</p>}
                      </div>
                    </>,
                    "group block rounded-lg border border-gray-200 overflow-hidden hover:shadow-md transition-shadow")
                : wrap(s,
                    <>
                      {s.photoUrl ? <img src={s.photoUrl} alt="" className="w-24 h-24 rounded-full object-cover mx-auto" /> : <div className="w-24 h-24 rounded-full bg-gray-100 mx-auto" />}
                      <p className="font-medium mt-2 leading-tight">{s.name}</p>
                      {(s.title || s.org) && <p className="text-xs text-gray-500">{[s.title, s.org].filter(Boolean).join(" · ")}</p>}
                    </>,
                    "block text-center")
              )}
            </div>
          </section>
        );
      }
      case "details":
        return (
          <section className="max-w-3xl mx-auto px-6">
            {draft.details.title && <SectionHeading k="details">{draft.details.title}</SectionHeading>}
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
            <SectionHeading k="gallery">{draft.gallery.title}</SectionHeading>
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
            <h2 className={`text-2xl font-medium ${headingClass("closing")}`}>{draft.closing.headline}</h2>
            {draft.closing.body && <p className="text-gray-600 mt-1 mb-4">{draft.closing.body}</p>}
            {btn(draft.closing.rsvpLabel || "RSVP")}
          </section>
        );
      default: return null;
    }
  };

  return (
    <div
      className={`bg-white text-gray-900 ${FONT_CLASS[draft.theme.bodyFont]}`}
      style={{ ...(draft.theme.bgColor ? { backgroundColor: draft.theme.bgColor } : {}), ...(draft.theme.textColor ? { color: draft.theme.textColor } : {}) }}
    >
      {draft.visible.hero && (
        <div className={`relative flex items-end overflow-hidden ${full ? "min-h-screen" : "h-[26rem]"}`}>
          {heroBg && <img src={heroBg} alt="" className="absolute inset-0 w-full h-full object-cover" />}
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent" />
          <div className="relative p-8 text-white max-w-4xl">
            <h1 className={`text-4xl font-semibold leading-tight ${headingClass("hero")}`}>{draft.hero.headline || plan.title}</h1>
            {draft.hero.subhead && <p className="text-white/85 mt-2 text-lg">{draft.hero.subhead}</p>}
            <p className="text-white/75 mt-3 text-sm">{[plan.date, plan.location].filter(Boolean).join(" · ")}</p>
            <div className="mt-4">{btn(draft.details.rsvpLabel || "RSVP")}</div>
          </div>
        </div>
      )}
      <div className="py-10 space-y-12">
        {draft.order.map((key) => {
          if (key.startsWith("divider")) return <hr key={key} className="border-t border-gray-200 max-w-5xl mx-auto" />;
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
  const [styling, setStyling] = useState(false);
  const [styleErr, setStyleErr] = useState<string | null>(null);
  const [styleImages, setStyleImages] = useState<{ media_type: string; data: string }[]>([]);
  const [styleDragOver, setStyleDragOver] = useState(false);
  const styleInputRef = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(false);
  // Section reorder is dnd-kit (both the Sections list and the editor cards index into draft.order).
  // A pointer activation distance lets clicks on the handle still register; closestCenter makes
  // the whole nearest block a drop target, so dropping is forgiving rather than pixel-exact.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const [activeSection, setActiveSection] = useState<string | null>(null);

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

  // Stage design reference(s), then apply. Images are read + base64'd client-side (no upload,
  // no server fetch). On apply, Claude (vision) infers style tokens; content stays from the plan.
  const addStyleFiles = async (files: FileList | null) => {
    if (!files || !files.length) return;
    setStyleErr(null);
    try {
      const toks = await Promise.all(Array.from(files).map(fileToStyleToken));
      setStyleImages((prev) => [...prev, ...toks].slice(0, 4));
    } catch (e: any) { setStyleErr(e?.message ?? String(e)); }
  };
  const applyStyle = async () => {
    if (!styleImages.length) return;
    setStyling(true); setStyleErr(null);
    try {
      const s = await generatePageStyle(styleImages);
      set((d) => ({
        ...d,
        theme: { ...d.theme, headingFont: s.headingFont, bodyFont: s.bodyFont, accent: s.accent, accentOn: s.accentOn, headingStyle: s.headingStyle, bgColor: s.bgColor, textColor: s.textColor },
        headingFonts: {},
        agenda: { ...d.agenda, layout: s.agendaLayout },
      }));
    } catch (e: any) { setStyleErr(e?.message ?? String(e)); }
    finally { setStyling(false); }
  };

  const onGalleryUpload = (which: "gallery" | "logos") => (url: string) => setDraft((d) => {
    const next = d ?? defaultPageDraft();
    const merged = { ...next, [which]: { ...next[which], images: [...next[which].images, url] } } as PageDraft;
    void persist(merged);
    return merged;
  });
  // Agenda items reorder within draft.agenda.items (ids are `agenda-<index>`).
  const onAgendaDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = Number(String(active.id).slice("agenda-".length));
    const to = Number(String(over.id).slice("agenda-".length));
    set((d) => (Number.isNaN(from) || Number.isNaN(to) ? d : { ...d, agenda: { ...d.agenda, items: arrayMove(d.agenda.items, from, to) } }));
  };
  // Speakers reorder by attendeeId and persist the new order.
  const onSpeakerDragEnd = async (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = speakers.findIndex((s) => s.attendeeId === active.id);
    const to = speakers.findIndex((s) => s.attendeeId === over.id);
    if (from < 0 || to < 0) return;
    const next = arrayMove(speakers, from, to);
    setSpeakers(next);
    await reorderSpeakers(eventId, next.map((s) => s.attendeeId));
  };
  // Edit a speaker's role (title) / company (org) inline. Update locally on change; persist on blur.
  const editSpeaker = (attendeeId: string, patch: Partial<Speaker2>) =>
    setSpeakers((prev) => prev.map((s) => (s.attendeeId === attendeeId ? { ...s, ...patch } : s)));
  const persistSpeaker = (attendeeId: string, field: "title" | "org", value: string) =>
    void updateAttendee(attendeeId, { [field]: value.trim() || null });

  const sectionLabel = (key: string) => (key.startsWith("divider") ? "Page break" : SECTION_LABELS[key] ?? key);
  const fontRow = (current: PageFont, onPick: (f: PageFont) => void) =>
    FONTS.map((f) => (
      <button key={f} onClick={() => onPick(f)} className={`px-2.5 py-1 rounded-full text-xs border ${current === f ? "bg-gray-900 text-white border-gray-900" : "border-gray-200 hover:bg-gray-50"}`}>{FONT_LABEL[f]}</button>
    ));
  const onSectionDragStart = (e: DragStartEvent) => setActiveSection(String(e.active.id));
  const onSectionDragCancel = () => setActiveSection(null);
  const onSectionDragEnd = (e: DragEndEvent) => {
    setActiveSection(null);
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    set((d) => {
      const from = d.order.indexOf(String(active.id));
      const to = d.order.indexOf(String(over.id));
      return from < 0 || to < 0 ? d : { ...d, order: arrayMove(d.order, from, to) };
    });
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

  // Body fields for one section's editor card. The wrapper (grip + label + drop bar) is shared below.
  const renderEditorCard = (key: string) => {
    switch (key) {
      case "about":
        return (
          <>
            <input value={draft.about.title} onChange={(e) => set((d) => ({ ...d, about: { ...d.about, title: e.target.value } }))} placeholder="Section title (shown on page)" className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
            <textarea value={draft.about.body} onChange={(e) => set((d) => ({ ...d, about: { ...d.about, body: e.target.value } }))} rows={4} placeholder="About this event…" className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
          </>
        );
      case "agenda":
        return (
          <>
            <input value={draft.agenda.title} onChange={(e) => set((d) => ({ ...d, agenda: { ...d.agenda, title: e.target.value } }))} placeholder="Section title (shown on page)" className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
            <div className="flex items-center gap-2 text-sm">
              <span className="text-gray-500">Layout</span>
              {(["list", "timeline", "cards"] as AgendaLayout[]).map((l) => (
                <button key={l} onClick={() => set((d) => ({ ...d, agenda: { ...d.agenda, layout: l } }))} className={`px-2.5 py-1 rounded-full text-xs border capitalize ${draft.agenda.layout === l ? "bg-gray-900 text-white border-gray-900" : "border-gray-200 hover:bg-gray-50"}`}>{l}</button>
              ))}
            </div>
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onAgendaDragEnd}>
              <SortableContext items={draft.agenda.items.map((_, i) => `agenda-${i}`)} strategy={verticalListSortingStrategy}>
                {draft.agenda.items.map((it, i) => (
                  <SortableSection key={`agenda-${i}`} id={`agenda-${i}`}>
                    {({ setActivatorNodeRef, attributes, listeners, isDragging }) => (
                      <div className={`flex gap-1.5 items-start ${isDragging ? "opacity-50" : ""}`}>
                        <button ref={setActivatorNodeRef} {...attributes} {...listeners} className="mt-1 p-1 -ml-1 rounded cursor-grab active:cursor-grabbing touch-none hover:bg-gray-50" title="Drag to reorder"><GripVertical className="w-4 h-4 text-gray-400 shrink-0" /></button>
                        <input value={it.time} onChange={(e) => set((d) => ({ ...d, agenda: { ...d.agenda, items: d.agenda.items.map((x, j) => j === i ? { ...x, time: e.target.value } : x) } }))} placeholder="1:00 PM" className="w-24 px-2 py-1 border border-gray-300 rounded text-sm" />
                        <div className="flex-1 space-y-1">
                          <input value={it.title} onChange={(e) => set((d) => ({ ...d, agenda: { ...d.agenda, items: d.agenda.items.map((x, j) => j === i ? { ...x, title: e.target.value } : x) } }))} placeholder="Session title" className="w-full px-2 py-1 border border-gray-300 rounded text-sm" />
                          <input value={it.desc} onChange={(e) => set((d) => ({ ...d, agenda: { ...d.agenda, items: d.agenda.items.map((x, j) => j === i ? { ...x, desc: e.target.value } : x) } }))} placeholder="Description" className="w-full px-2 py-1 border border-gray-200 rounded text-sm" />
                        </div>
                        <button onClick={() => set((d) => ({ ...d, agenda: { ...d.agenda, items: d.agenda.items.filter((_, j) => j !== i) } }))} className="text-gray-300 hover:text-red-600 mt-1"><Trash2 className="w-3.5 h-3.5" /></button>
                      </div>
                    )}
                  </SortableSection>
                ))}
              </SortableContext>
            </DndContext>
            <button onClick={() => set((d) => ({ ...d, agenda: { ...d.agenda, items: [...d.agenda.items, { time: "", title: "", desc: "" } as AgendaItem] } }))} className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900"><Plus className="w-4 h-4" /> Add agenda item</button>
          </>
        );
      case "speakers":
        return (
          <>
            <input value={draft.speakers.title} onChange={(e) => set((d) => ({ ...d, speakers: { ...d.speakers, title: e.target.value } }))} placeholder="Section title (shown on page)" className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
            <div className="flex items-center gap-2 text-sm">
              <span className="text-gray-500">Card style</span>
              {(["circle", "card"] as const).map((s) => (
                <button key={s} onClick={() => set((d) => ({ ...d, speakers: { ...d.speakers, cardStyle: s } }))} className={`px-2.5 py-1 rounded-full text-xs border capitalize ${draft.speakers.cardStyle === s ? "bg-gray-900 text-white border-gray-900" : "border-gray-200 hover:bg-gray-50"}`}>{s}</button>
              ))}
            </div>
            <p className="text-xs text-gray-400">Speakers are people tagged “Speaker” for this event (People tab → a person → Mark as speaker). Drag to reorder; headshots set there.</p>
            {speakers.length === 0 ? <p className="text-sm text-gray-400">No speakers tagged yet.</p> : (
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onSpeakerDragEnd}>
                <SortableContext items={speakers.map((s) => s.attendeeId)} strategy={verticalListSortingStrategy}>
                  <div className="space-y-1">
                    {speakers.map((s) => (
                      <SortableSection key={s.attendeeId} id={s.attendeeId}>
                        {({ setActivatorNodeRef, attributes, listeners, isDragging }) => (
                          <div className={`flex items-start gap-2 text-sm rounded ${isDragging ? "opacity-50 bg-gray-50" : ""}`}>
                            <button ref={setActivatorNodeRef} {...attributes} {...listeners} className="mt-1 p-1 rounded cursor-grab active:cursor-grabbing touch-none hover:bg-gray-50" title="Drag to reorder"><GripVertical className="w-4 h-4 text-gray-400 shrink-0" /></button>
                            {s.photoUrl ? <img src={s.photoUrl} alt="" className="w-7 h-7 mt-0.5 rounded-full object-cover" /> : <div className="w-7 h-7 mt-0.5 rounded-full bg-gray-100" />}
                            <div className="flex-1 min-w-0">
                              <p className="truncate font-medium">{s.name}</p>
                              <div className="flex gap-1.5 mt-1">
                                <input value={s.title ?? ""} onChange={(e) => editSpeaker(s.attendeeId, { title: e.target.value })} onBlur={(e) => persistSpeaker(s.attendeeId, "title", e.target.value)} placeholder="Role" className="w-1/2 px-2 py-0.5 border border-gray-200 rounded text-xs focus:outline-none focus:ring-2 focus:ring-gray-300" />
                                <input value={s.org ?? ""} onChange={(e) => editSpeaker(s.attendeeId, { org: e.target.value })} onBlur={(e) => persistSpeaker(s.attendeeId, "org", e.target.value)} placeholder="Company" className="w-1/2 px-2 py-0.5 border border-gray-200 rounded text-xs focus:outline-none focus:ring-2 focus:ring-gray-300" />
                              </div>
                            </div>
                          </div>
                        )}
                      </SortableSection>
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            )}
          </>
        );
      case "details":
        return (
          <>
            <input value={draft.details.title} onChange={(e) => set((d) => ({ ...d, details: { ...d.details, title: e.target.value } }))} placeholder="Section title (shown on page)" className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
            <input value={draft.details.rsvpLabel} onChange={(e) => set((d) => ({ ...d, details: { ...d.details, rsvpLabel: e.target.value } }))} placeholder="RSVP button label" className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
            <p className="text-xs text-gray-400">Date &amp; location pull live from the event{plan.lumaUrl ? "; RSVP links to the attached Luma." : ". Attach a Luma link to enable RSVP."}</p>
          </>
        );
      case "gallery":
        return (
          <>
            <input value={draft.gallery.title} onChange={(e) => set((d) => ({ ...d, gallery: { ...d.gallery, title: e.target.value } }))} placeholder="Section title (shown on page)" className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
            <FileDrop label="Drag & drop an image" onUploaded={onGalleryUpload("gallery")} />
            {draft.gallery.images.length > 0 && (
              <div className="grid grid-cols-3 gap-2">
                {draft.gallery.images.map((src, i) => (
                  <div key={i} className="relative group">
                    <img src={src} alt="" className="w-full h-20 object-cover rounded-lg" />
                    <button onClick={() => set((d) => ({ ...d, gallery: { ...d.gallery, images: d.gallery.images.filter((_, j) => j !== i) } }))} className="absolute top-1 right-1 w-5 h-5 rounded-full bg-gray-900/80 text-white flex items-center justify-center opacity-0 group-hover:opacity-100"><Trash2 className="w-3 h-3" /></button>
                  </div>
                ))}
              </div>
            )}
          </>
        );
      case "logos":
        return (
          <>
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
          </>
        );
      case "closing":
        return (
          <>
            <input value={draft.closing.headline} onChange={(e) => set((d) => ({ ...d, closing: { ...d.closing, headline: e.target.value } }))} placeholder="Headline (e.g. Seats are limited.)" className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm" />
            <input value={draft.closing.body} onChange={(e) => set((d) => ({ ...d, closing: { ...d.closing, body: e.target.value } }))} placeholder="Body" className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm" />
            <input value={draft.closing.rsvpLabel} onChange={(e) => set((d) => ({ ...d, closing: { ...d.closing, rsvpLabel: e.target.value } }))} placeholder="RSVP button label" className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm" />
          </>
        );
      default:
        return null;
    }
  };

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

            {/* Presets — a starting look you can then fine-tune below. */}
            <div className="flex items-center gap-2 text-sm flex-wrap">
              <span className="text-gray-500 w-20 shrink-0">Preset</span>
              {PRESETS.map((p) => (
                <button key={p.name} onClick={() => set((d) => applyPreset(d, p))} className="px-2.5 py-1 rounded-full text-xs border border-gray-200 hover:bg-gray-50">{p.name}</button>
              ))}
            </div>

            {/* Match a style — stage one or more references, then apply. Claude infers the look. */}
            <div className="flex items-start gap-2 text-sm">
              <span className="text-gray-500 w-20 shrink-0 pt-2">Match style</span>
              <div className="flex-1">
                <div
                  onClick={() => styleInputRef.current?.click()}
                  onDragOver={(e) => { e.preventDefault(); if (!styleDragOver) setStyleDragOver(true); }}
                  onDragLeave={() => setStyleDragOver(false)}
                  onDrop={(e) => { e.preventDefault(); setStyleDragOver(false); void addStyleFiles(e.dataTransfer.files); }}
                  className={`border border-dashed rounded text-xs cursor-pointer text-center transition-all duration-150 ${styleDragOver ? "border-gray-900 bg-gray-50 shadow-md py-6 text-gray-700" : "border-gray-300 text-gray-500 hover:bg-gray-50 py-3"}`}
                >
                  {styleDragOver ? "Drop to add" : "drop or click — screenshots / mocks (add several)"}
                </div>
                {styleImages.length > 0 && (
                  <>
                    <div className="flex flex-wrap gap-2 mt-2">
                      {styleImages.map((im, i) => (
                        <div key={i} className="relative group">
                          <img src={`data:${im.media_type};base64,${im.data}`} alt="" className="w-14 h-14 object-cover rounded border border-gray-200" />
                          <button onClick={() => setStyleImages((p) => p.filter((_, j) => j !== i))} className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-gray-900/80 text-white flex items-center justify-center opacity-0 group-hover:opacity-100"><X className="w-2.5 h-2.5" /></button>
                        </div>
                      ))}
                    </div>
                    <div className="flex items-center gap-3 mt-2">
                      <button onClick={() => void applyStyle()} disabled={styling} className="px-3 py-1 bg-gray-900 text-white rounded text-xs hover:bg-gray-800 disabled:opacity-50">
                        {styling ? "Analyzing…" : `Apply style from ${styleImages.length} image${styleImages.length > 1 ? "s" : ""}`}
                      </button>
                      <button onClick={() => setStyleImages([])} className="text-xs text-gray-400 hover:text-gray-700">clear</button>
                    </div>
                  </>
                )}
              </div>
              <input ref={styleInputRef} type="file" accept="image/*" multiple hidden onChange={(e) => { void addStyleFiles(e.target.files); e.target.value = ""; }} />
            </div>
            <p className="text-xs text-gray-400">Copies the look (fonts, color, layout), not the content.{styleErr ? <span className="text-red-600"> · {styleErr}</span> : null}</p>

            {/* Type — heading vs body font groups. */}
            <div className="flex items-center gap-2 text-sm flex-wrap">
              <span className="text-gray-500 w-20 shrink-0">Headings</span>
              {fontRow(draft.theme.headingFont, (f) => set((d) => ({ ...d, theme: { ...d.theme, headingFont: f } })))}
            </div>
            <div className="flex items-center gap-2 text-sm flex-wrap">
              <span className="text-gray-500 w-20 shrink-0">Body</span>
              {fontRow(draft.theme.bodyFont, (f) => set((d) => ({ ...d, theme: { ...d.theme, bodyFont: f } })))}
            </div>

            {/* Heading style: plain, or a small square + uppercase label (Kedrion-style). */}
            <div className="flex items-center gap-2 text-sm flex-wrap">
              <span className="text-gray-500 w-20 shrink-0">Heading</span>
              {([["plain", "Plain"], ["marker", "Square + label"]] as const).map(([v, label]) => (
                <button key={v} onClick={() => set((d) => ({ ...d, theme: { ...d.theme, headingStyle: v } }))} className={`px-2.5 py-1 rounded-full text-xs border ${draft.theme.headingStyle === v ? "bg-gray-900 text-white border-gray-900" : "border-gray-200 hover:bg-gray-50"}`}>{label}</button>
              ))}
            </div>

            {/* Accent + where it lands. */}
            <div className="flex items-center gap-2 text-sm flex-wrap">
              <span className="text-gray-500 w-20 shrink-0">Accent</span>
              <input type="color" value={draft.theme.accent} onChange={(e) => set((d) => ({ ...d, theme: { ...d.theme, accent: e.target.value } }))} className="w-7 h-7 rounded border border-gray-200 p-0" />
              <span className="text-gray-400">on</span>
              {([["marker", "Marker"], ["title", "Title"]] as const).map(([v, label]) => (
                <button key={v} onClick={() => set((d) => ({ ...d, theme: { ...d.theme, accentOn: v } }))} className={`px-2.5 py-1 rounded-full text-xs border ${draft.theme.accentOn === v ? "bg-gray-900 text-white border-gray-900" : "border-gray-200 hover:bg-gray-50"}`}>{label}</button>
              ))}
            </div>

            {/* Background + text color. */}
            <div className="flex items-center gap-2 text-sm flex-wrap">
              <span className="text-gray-500 w-20 shrink-0">Background</span>
              <input type="color" value={draft.theme.bgColor ?? "#ffffff"} onChange={(e) => set((d) => ({ ...d, theme: { ...d.theme, bgColor: e.target.value } }))} className="w-7 h-7 rounded border border-gray-200 p-0" />
              {draft.theme.bgColor && <button onClick={() => set((d) => ({ ...d, theme: { ...d.theme, bgColor: null } }))} className="text-xs text-gray-400 hover:text-red-600">reset</button>}
              <span className="text-gray-500 ml-2">Text</span>
              <input type="color" value={draft.theme.textColor ?? "#111827"} onChange={(e) => set((d) => ({ ...d, theme: { ...d.theme, textColor: e.target.value } }))} className="w-7 h-7 rounded border border-gray-200 p-0" />
              {draft.theme.textColor && <button onClick={() => set((d) => ({ ...d, theme: { ...d.theme, textColor: null } }))} className="text-xs text-gray-400 hover:text-red-600">reset</button>}
            </div>

            <label className="inline-flex items-center gap-1 text-sm text-gray-500"><input type="checkbox" checked={draft.theme.scrollAnim} onChange={(e) => set((d) => ({ ...d, theme: { ...d.theme, scrollAnim: e.target.checked } }))} /> Scroll animations</label>

            <div className="flex items-center gap-2 text-sm">
              <span className="text-gray-500 w-20 shrink-0">Hero image</span>
              {draft.theme.bgImageUrl && <img src={draft.theme.bgImageUrl} alt="" className="w-8 h-8 rounded object-cover" />}
              <FileDrop compact label="drop full-bleed image" onUploaded={(url) => set((d) => ({ ...d, theme: { ...d.theme, bgImageUrl: url } }))} />
              {draft.theme.bgImageUrl && <button onClick={() => set((d) => ({ ...d, theme: { ...d.theme, bgImageUrl: null } }))} className="text-xs text-gray-400 hover:text-red-600">reset</button>}
            </div>
          </div>

          {/* Sections — drag to reorder, show/hide; page-break lines split the site. */}
          <div className="bg-white rounded-2xl border border-black p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-medium">Sections <span className="text-gray-400 font-normal">(drag to reorder)</span></p>
              <button onClick={() => set((d) => ({ ...d, order: [...d.order, `divider-${Math.random().toString(36).slice(2, 8)}`] }))} className="inline-flex items-center gap-1 text-xs text-gray-600 hover:text-gray-900"><Minus className="w-3.5 h-3.5" /> Add page-break line</button>
            </div>
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={onSectionDragStart} onDragEnd={onSectionDragEnd} onDragCancel={onSectionDragCancel}>
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-sm text-gray-400 px-1"><GripVertical className="w-4 h-4 text-transparent shrink-0" /><span className="flex-1">Hero (fixed top)</span><button onClick={() => set((d) => ({ ...d, visible: { ...d.visible, hero: !d.visible.hero } }))}>{draft.visible.hero ? <Eye className="w-4 h-4 text-gray-700" /> : <EyeOff className="w-4 h-4" />}</button></div>
                <SortableContext items={draft.order} strategy={verticalListSortingStrategy}>
                  {draft.order.map((key) => {
                    const isDivider = key.startsWith("divider");
                    return (
                      <SortableSection key={key} id={key}>
                        {({ setActivatorNodeRef, attributes, listeners, isDragging }) => (
                          <div className={`flex items-center gap-2 text-sm rounded ${isDragging ? "opacity-50 border border-dashed border-gray-900/40 bg-gray-50" : ""}`}>
                            <button ref={setActivatorNodeRef} {...attributes} {...listeners} className="flex flex-1 items-center gap-2 px-1 py-1 rounded cursor-grab active:cursor-grabbing touch-none text-left hover:bg-gray-50" title="Drag to reorder">
                              <GripVertical className="w-4 h-4 text-gray-400 shrink-0" />
                              {isDivider
                                ? <span className="flex-1 flex items-center gap-2 text-gray-400"><span className="flex-1 border-t border-gray-200" />page break<span className="flex-1 border-t border-gray-200" /></span>
                                : <span className="flex-1">{SECTION_LABELS[key]}</span>}
                            </button>
                            {isDivider
                              ? <button onClick={() => set((d) => ({ ...d, order: d.order.filter((k) => k !== key) }))} className="text-gray-300 hover:text-red-600 pr-1" aria-label="Remove line"><Trash2 className="w-3.5 h-3.5" /></button>
                              : <button onClick={() => set((d) => ({ ...d, visible: { ...d.visible, [key]: !d.visible[key] } }))} className="pr-1">{draft.visible[key] ? <Eye className="w-4 h-4 text-gray-700" /> : <EyeOff className="w-4 h-4 text-gray-400" />}</button>}
                          </div>
                        )}
                      </SortableSection>
                    );
                  })}
                </SortableContext>
              </div>
              <DragOverlay>
                {activeSection ? (
                  <div className="flex items-center gap-2 text-sm px-1 py-1 rounded bg-white border border-gray-900 shadow-lg">
                    <GripVertical className="w-4 h-4 text-gray-500 shrink-0" /><span className="flex-1">{sectionLabel(activeSection)}</span>
                  </div>
                ) : null}
              </DragOverlay>
            </DndContext>
          </div>

          {/* Hero */}
          <div className="bg-white rounded-2xl border border-black p-4 space-y-2">
            <p className="text-sm font-medium">Hero</p>
            <input value={draft.hero.headline} onChange={(e) => set((d) => ({ ...d, hero: { ...d.hero, headline: e.target.value } }))} placeholder="Headline" className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
            <input value={draft.hero.subhead} onChange={(e) => set((d) => ({ ...d, hero: { ...d.hero, subhead: e.target.value } }))} placeholder="Subhead" className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
          </div>

          {/* Section editor cards — mirror the Sections list order. Grab the header to drag:
              the block lifts into a DragOverlay, others slide aside, and the slot it left
              becomes a highlighted dashed placeholder (closestCenter = forgiving drop). */}
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={onSectionDragStart} onDragEnd={onSectionDragEnd} onDragCancel={onSectionDragCancel}>
            <SortableContext items={draft.order} strategy={verticalListSortingStrategy}>
              <div className="space-y-4">
                {draft.order.map((key) => {
                  const isDivider = key.startsWith("divider");
                  return (
                    <SortableSection key={key} id={key}>
                      {({ setActivatorNodeRef, attributes, listeners, isDragging }) => (
                        <div className={`rounded-2xl border p-4 space-y-2 ${isDragging ? "border-2 border-dashed border-gray-900/40 bg-gray-50" : "bg-white border-black"}`}>
                          <div className={`flex items-center gap-2 ${isDragging ? "opacity-40" : ""}`}>
                            <button ref={setActivatorNodeRef} {...attributes} {...listeners} className="flex flex-1 items-center gap-2 -m-1 p-1 rounded cursor-grab active:cursor-grabbing touch-none text-left hover:bg-gray-50" title="Drag to reorder">
                              <GripVertical className="w-4 h-4 text-gray-400 shrink-0" />
                              {isDivider
                                ? <span className="flex-1 flex items-center gap-2 text-sm text-gray-400"><span className="flex-1 border-t border-gray-200" />page break<span className="flex-1 border-t border-gray-200" /></span>
                                : <p className="text-sm font-medium flex-1">{SECTION_LABELS[key] ?? key}</p>}
                            </button>
                            {!isDivider && key !== "logos" && (
                              <select
                                value={draft.headingFonts?.[key] ?? ""}
                                onChange={(e) => set((d) => { const hf = { ...d.headingFonts }; if (e.target.value) hf[key] = e.target.value as PageFont; else delete hf[key]; return { ...d, headingFonts: hf }; })}
                                className="text-xs border border-gray-200 rounded px-1 py-0.5 text-gray-500 bg-white"
                                title="Heading font for this section"
                              >
                                <option value="">Aa</option>
                                {FONTS.map((f) => <option key={f} value={f}>{FONT_LABEL[f]}</option>)}
                              </select>
                            )}
                            {isDivider
                              ? <button onClick={() => set((d) => ({ ...d, order: d.order.filter((k) => k !== key) }))} className="text-gray-300 hover:text-red-600" aria-label="Remove line"><Trash2 className="w-3.5 h-3.5" /></button>
                              : <button onClick={() => set((d) => ({ ...d, visible: { ...d.visible, [key]: !d.visible[key] } }))}>{draft.visible[key] ? <Eye className="w-4 h-4 text-gray-700" /> : <EyeOff className="w-4 h-4 text-gray-400" />}</button>}
                          </div>
                          {!isDragging && renderEditorCard(key)}
                        </div>
                      )}
                    </SortableSection>
                  );
                })}
              </div>
            </SortableContext>
            <DragOverlay>
              {activeSection ? (
                <div className="rounded-2xl border-2 border-gray-900 bg-white shadow-xl p-4 flex items-center gap-2 cursor-grabbing">
                  <GripVertical className="w-4 h-4 text-gray-500 shrink-0" /><p className="text-sm font-medium">{sectionLabel(activeSection)}</p>
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
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
