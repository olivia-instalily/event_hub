import { useEffect, useMemo, useState, type ComponentType } from "react";
import {
  // UI controls
  HelpCircle, Clock, Search, PlayCircle, Plus, Trash2, GripVertical, Check, Eye, Save, Pencil,
  // Icon palette (also used by walkthroughs)
  FolderInput, Copy, History, PencilLine, Sparkles, Wand2, DollarSign, Target, GitBranch,
  ClipboardList, ListChecks, CalendarDays, Users, Handshake, Mail, Megaphone, Ticket, Share2,
  MapPin, Mic, Presentation, Coffee, Camera, PartyPopper, Flag, CheckCircle2, Star, Lightbulb,
  BookOpen, Video, Activity, Rocket, Bell,
} from "lucide-react";
import { DndContext, closestCenter, PointerSensor, KeyboardSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy, arrayMove, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useProfile } from "../lib/profile";
import { getTutorials, saveTutorials, type TutorialSection, type TutorialWalkthrough } from "../lib/db";

// Admin-editable walkthrough library. Content lives in the DB (app_setting → 'tutorials'); the seed
// below is the fallback shown until an admin saves. Admins get an Edit mode (add/reorder/attach
// video) and a Preview toggle to see the exact non-admin view.

type Status = TutorialWalkthrough["status"];

// ── Icon palette ──────────────────────────────────────────────────────────────
// Icons are stored by NAME (a string) so the structure is JSON-serializable. Render via this map.
const ICONS: Record<string, ComponentType<{ className?: string }>> = {
  FolderInput, Copy, History, PencilLine, Sparkles, Wand2, DollarSign, Target, GitBranch,
  ClipboardList, ListChecks, CalendarDays, Users, Handshake, Mail, Megaphone, Ticket, Share2,
  MapPin, Mic, Presentation, Coffee, Camera, PartyPopper, Flag, CheckCircle2, Star, Lightbulb,
  BookOpen, Video, PlayCircle, Activity, Rocket, Bell,
};
const PALETTE = Object.keys(ICONS);
const IconByName = ({ name, className }: { name: string; className?: string }) => {
  const Cmp = ICONS[name] ?? PlayCircle;
  return <Cmp className={className} />;
};

// Keyword → icon, for auto-assigning a sensible icon to a freshly-added walkthrough.
const ICON_KEYWORDS: [RegExp, string][] = [
  [/budget|cost|spend|money|financ/, "DollarSign"],
  [/scop|goal|target/, "Target"],
  [/phase|timeline|schedul/, "GitBranch"],
  [/deliverable|task|checklist|to-?do/, "ClipboardList"],
  [/calendar/, "CalendarDays"],
  [/staff|people|team|owner|assign/, "Users"],
  [/vendor|partner|sponsor/, "Handshake"],
  [/email|invite|mail|outreach/, "Mail"],
  [/promot|announce|market/, "Megaphone"],
  [/rsvp|ticket|registr/, "Ticket"],
  [/\bshare\b|social/, "Share2"],
  [/venue|location|place/, "MapPin"],
  [/speaker|fireside|mic|panel/, "Mic"],
  [/workshop|talk|present|demo/, "Presentation"],
  [/coffee|happy hour|social|mixer|dinner/, "Coffee"],
  [/photo|camera|media/, "Camera"],
  [/party|celebrat|day-?of/, "PartyPopper"],
  [/wrap|settl|close|debrief|post-?event/, "Flag"],
  [/done|complete|finish/, "CheckCircle2"],
  [/tip|best practice|advice/, "Lightbulb"],
  [/guide|how to|overview|intro|start/, "BookOpen"],
  [/folder|drop|import|upload/, "FolderInput"],
  [/copy|duplicate|reuse|spin/, "Copy"],
  [/backfill|past|history|previous/, "History"],
  [/scratch|blank|from scratch/, "PencilLine"],
  [/linear|sync|integrat/, "Activity"],
  [/\bai\b|generat|magic|auto/, "Sparkles"],
  [/launch|kickoff/, "Rocket"],
  [/video|record|walkthrough/, "Video"],
  [/remind|notif|alert/, "Bell"],
];
function pickIcon(title: string, used: Set<string>): string {
  const t = title.toLowerCase();
  for (const [rx, name] of ICON_KEYWORDS) if (rx.test(t)) return name;
  return PALETTE.find((n) => !used.has(n)) ?? "PlayCircle";
}

const newId = () => (globalThis.crypto?.randomUUID?.() ?? `id-${Date.now()}-${Math.round(Math.random() * 1e9)}`);

// ── Default seed (used only until an admin saves) ─────────────────────────────
const SEED: TutorialSection[] = [
  {
    id: "sec-getting-in", heading: "Getting an event in", blurb: "The four ways an event starts life in EventHub.",
    items: [
      { id: "w-folder", title: "Create from a folder", when: "You have a brief, budget, or attendee list to drop in.", icon: "FolderInput", length: "1:10", embedUrl: "https://demo.arcade.software/zIxItNMYbgowZanKxQkt?embed&embed_mobile=inline&embed_desktop=inline&show_copy_link=true", status: "ready" },
      { id: "w-similar", title: "Spin up from a similar event", when: "You've run something like this before and want to reuse it.", icon: "Copy", length: "0:55", embedUrl: null, status: "soon" },
      { id: "w-past", title: "Color in a past event", when: "Backfilling an event that already happened.", icon: "History", length: "1:05", embedUrl: null, status: "soon" },
      { id: "w-scratch", title: "Build from scratch", when: "Starting fresh with no source material.", icon: "PencilLine", length: "0:50", embedUrl: null, status: "soon" },
    ],
  },
  {
    id: "sec-planning", heading: "Planning the event", blurb: "Working an event through to the day-of.",
    items: [
      { id: "w-budget", title: "Budget flow", when: "Scoping a target and tracking spend against it.", icon: "DollarSign", length: "1:20", embedUrl: "https://demo.arcade.software/vk5LA3UpZIH0yNDbKZlV?embed&embed_mobile=tab&embed_desktop=inline&show_copy_link=true", status: "ready", aspect: "calc(64.7368% + 41px)" },
      { id: "w-phases", title: "Phases", when: "Laying out the timeline and its deliverables.", icon: "GitBranch", length: "1:00", embedUrl: null, status: "soon" },
      { id: "w-linear", title: "Sync with Linear", when: "Mirroring deliverables into Linear as issues.", icon: "Activity", length: "0:45", embedUrl: null, status: "soon" },
      { id: "w-calendar", title: "Calendar", when: "Putting the event on the shared company calendar.", icon: "CalendarDays", length: "0:40", embedUrl: null, status: "soon" },
    ],
  },
  {
    id: "sec-after", heading: "After the event", blurb: "Closing an event out into a complete record.",
    items: [
      { id: "w-wrap", title: "Wrap & settle", when: "Recording what happened and settling the budget.", icon: "Flag", length: "—", embedUrl: null, status: "planned" },
    ],
  },
];

const STATUS_LABEL: Record<Status, string> = { ready: "", soon: "Soon", planned: "Planned" };
const isPlayable = (w: TutorialWalkthrough) => w.status === "ready" && !!w.embedUrl;

const fmtDuration = (sec: number): string => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, "0")}`;

// Best-effort auto-duration from a pasted video URL. Works for providers whose public oEmbed
// returns a duration (Loom, Vimeo). Arcade (interactive walkthrough — no public duration) and
// YouTube (needs an API key) return null → the duration stays whatever the editor typed.
async function fetchVideoDuration(url: string): Promise<string | null> {
  try {
    const loom = url.match(/loom\.com\/(?:share|embed)\/([a-z0-9]+)/i);
    if (loom) {
      const r = await fetch(`https://www.loom.com/v1/oembed?url=${encodeURIComponent(`https://www.loom.com/share/${loom[1]}`)}`);
      const j = await r.json();
      return typeof j?.duration === "number" ? fmtDuration(j.duration) : null;
    }
    if (/vimeo\.com\//i.test(url)) {
      const r = await fetch(`https://vimeo.com/api/oembed.json?url=${encodeURIComponent(url)}`);
      const j = await r.json();
      return typeof j?.duration === "number" ? fmtDuration(j.duration) : null;
    }
    return null; // Arcade / YouTube / unknown → keep the manual value
  } catch { return null; }
}

function StatusBadge({ item }: { item: TutorialWalkthrough }) {
  if (isPlayable(item)) return <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-[12px] text-gray-600"><PlayCircle className="w-3 h-3" /> {item.length}</span>;
  const cls = item.status === "soon" ? "bg-amber-50 text-amber-700" : "bg-gray-100 text-gray-500";
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px] ${cls}`}><Clock className="w-3 h-3" /> {STATUS_LABEL[item.status] || "Soon"}</span>;
}

// ══════════════════════════════════════════════════════════════════════════════
export function TutorialPage() {
  const { current } = useProfile();
  const isAdmin = !!current?.isAdmin;

  const [sections, setSections] = useState<TutorialSection[]>(SEED);
  const [loaded, setLoaded] = useState(false);
  const [mode, setMode] = useState<"view" | "edit">("view");

  useEffect(() => {
    let cancelled = false;
    getTutorials().then((t) => { if (!cancelled) { if (t?.length) setSections(t); setLoaded(true); } }).catch(() => setLoaded(true));
    return () => { cancelled = true; };
  }, []);

  if (isAdmin && mode === "edit") {
    return <Editor sections={sections} onCancel={() => setMode("view")} onSaved={(s) => { setSections(s); setMode("view"); }} />;
  }

  return <ReadOnly sections={sections} loaded={loaded} admin={isAdmin} previewing={false} onEdit={() => setMode("edit")} />;
}

// ── Read-only view (also what non-admins and Preview mode see) ─────────────────
function ReadOnly({ sections, loaded, admin, previewing, onEdit, onExitPreview }: {
  sections: TutorialSection[]; loaded: boolean; admin: boolean; previewing: boolean; onEdit?: () => void; onExitPreview?: () => void;
}) {
  const allItems = useMemo(() => sections.flatMap((s) => s.items), [sections]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [query, setQuery] = useState("");

  // Default selection: first playable, else first item. Re-resolve when content loads.
  useEffect(() => {
    if (selectedId && allItems.some((w) => w.id === selectedId)) return;
    setSelectedId((allItems.find(isPlayable) ?? allItems[0])?.id ?? "");
  }, [allItems, selectedId]);

  const selected = allItems.find((w) => w.id === selectedId) ?? allItems[0];
  const q = query.trim().toLowerCase();
  const filtered = q
    ? sections.map((s) => ({ ...s, items: s.items.filter((w) => w.title.toLowerCase().includes(q)) })).filter((s) => s.items.length > 0)
    : sections;

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-start justify-between gap-3 mb-1">
        <div className="flex items-center gap-3">
          <HelpCircle className="w-6 h-6 text-gray-700" />
          <h1 className="text-2xl">How to use EventHub</h1>
        </div>
        {admin && (previewing ? (
          <button onClick={onExitPreview} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-300 bg-white text-sm text-gray-700 hover:bg-gray-50"><Pencil className="w-4 h-4" /> Back to editing</button>
        ) : (
          <button onClick={onEdit} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-300 bg-white text-sm text-gray-700 hover:bg-gray-50"><Pencil className="w-4 h-4" /> Edit</button>
        ))}
      </div>
      <p className="text-sm text-gray-500 mb-6">
        {previewing ? "Preview — this is what non-admins see." : "Short, task-focused walkthroughs. Pick one on the right to watch it here."}
      </p>

      {!loaded ? (
        <p className="text-sm text-gray-400 py-12 text-center">Loading…</p>
      ) : allItems.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-gray-50 py-16 text-center text-gray-500">No walkthroughs yet.</div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1.9fr_1fr]">
          {/* Player */}
          <div>
            <div
              className={`relative w-full overflow-hidden rounded-xl border border-border bg-gray-900 ${selected && isPlayable(selected) && selected.aspect ? "" : "aspect-video"}`}
              style={selected && isPlayable(selected) && selected.aspect ? { paddingBottom: selected.aspect, height: 0 } : undefined}
            >
              {selected && isPlayable(selected) ? (
                <iframe key={selected.id} src={selected.embedUrl!} title={selected.title} className="absolute inset-0 w-full h-full" allowFullScreen allow="clipboard-write; autoplay; fullscreen; picture-in-picture" />
              ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-center text-gray-400">
                  <Clock className="w-8 h-8 mb-3" />
                  <p className="text-gray-200 font-medium">{selected?.status === "planned" ? "Planned" : "Coming soon"}</p>
                  <p className="text-sm mt-1 max-w-xs">This walkthrough hasn't been recorded yet — check back soon.</p>
                </div>
              )}
              {selected && isPlayable(selected) && <span className="absolute top-3 right-3 rounded-full bg-black/60 px-2 py-0.5 text-[12px] text-white">{selected.length}</span>}
            </div>
            {selected && (
              <div className="mt-3 flex items-start gap-3">
                <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-700"><IconByName name={selected.icon} className="w-5 h-5" /></span>
                <div className="min-w-0">
                  <h2 className="text-lg font-medium leading-tight">{selected.title}</h2>
                  <p className="text-sm text-gray-500 mt-0.5">{selected.when}</p>
                </div>
              </div>
            )}
          </div>

          {/* Index */}
          <div className="lg:max-h-[72vh] lg:overflow-y-auto lg:pr-1">
            <div className="relative mb-3">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search walkthroughs…" className="w-full rounded-lg border border-border pl-8 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
            </div>
            {filtered.length === 0 && <p className="text-sm text-gray-400 px-1 py-6 text-center">No walkthroughs match "{query}".</p>}
            <div className="space-y-6">
              {filtered.map((section) => (
                <section key={section.id}>
                  <h3 className="text-[15px] font-medium text-gray-900">{section.heading}</h3>
                  <p className="text-[13px] text-gray-500 mb-2">{section.blurb}</p>
                  <div className="space-y-1">
                    {section.items.map((item) => (
                      <button key={item.id} onClick={() => setSelectedId(item.id)} className={`flex w-full items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left transition-colors ${item.id === selectedId ? "border-gray-300 bg-gray-100" : "border-transparent hover:bg-gray-50"}`}>
                        <IconByName name={item.icon} className="w-4 h-4 shrink-0 text-gray-500" />
                        <span className="flex-1 truncate text-sm text-gray-800">{item.title}</span>
                        <StatusBadge item={item} />
                      </button>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Editor (admin) ────────────────────────────────────────────────────────────
function Editor({ sections: initial, onCancel, onSaved }: {
  sections: TutorialSection[]; onCancel: () => void; onSaved: (s: TutorialSection[]) => void;
}) {
  const [sections, setSections] = useState<TutorialSection[]>(() => JSON.parse(JSON.stringify(initial)));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [iconPickerFor, setIconPickerFor] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  const sectionIds = sections.map((s) => s.id);
  const isSectionId = (id: string) => sectionIds.includes(id);
  const sectionOf = (itemId: string) => sections.find((s) => s.items.some((w) => w.id === itemId));

  const usedIcons = () => new Set(sections.flatMap((s) => s.items.map((w) => w.icon)));

  const patchSection = (sid: string, f: Partial<TutorialSection>) => setSections((prev) => prev.map((s) => (s.id === sid ? { ...s, ...f } : s)));
  const patchItem = (sid: string, wid: string, f: Partial<TutorialWalkthrough>) =>
    setSections((prev) => prev.map((s) => (s.id === sid ? { ...s, items: s.items.map((w) => (w.id === wid ? { ...w, ...f } : w)) } : s)));

  const addSection = () => setSections((prev) => [...prev, { id: newId(), heading: "New section", blurb: "", items: [] }]);
  const removeSection = (sid: string) => setSections((prev) => prev.filter((s) => s.id !== sid));
  const addItem = (sid: string) => setSections((prev) => prev.map((s) => (s.id === sid ? { ...s, items: [...s.items, { id: newId(), title: "New walkthrough", when: "", icon: pickIcon("New walkthrough", usedIcons()), length: "—", embedUrl: null, status: "soon" }] } : s)));
  const removeItem = (sid: string, wid: string) => setSections((prev) => prev.map((s) => (s.id === sid ? { ...s, items: s.items.filter((w) => w.id !== wid) } : s)));
  // Setting a video URL flips status to ready; clearing it drops back to "soon". Best-effort: pull
  // the duration from the provider (Loom/Vimeo) and auto-fill the length — without clobbering a
  // duration you typed yourself. Arcade/YouTube can't be read, so those keep the manual value.
  const setVideo = (sid: string, wid: string, url: string) => {
    const u = url.trim();
    patchItem(sid, wid, { embedUrl: u || null, status: u ? "ready" : "soon" });
    if (!u) return;
    void fetchVideoDuration(u).then((dur) => {
      if (!dur) return;
      setSections((prev) => prev.map((s) => s.id !== sid ? s : { ...s, items: s.items.map((w) => {
        if (w.id !== wid) return w;
        const manual = w.length && w.length !== "—" && w.length.trim();
        return manual ? w : { ...w, length: dur };
      }) }));
    }).catch(() => {});
  };
  const moveItemToSection = (wid: string, fromSid: string, toSid: string) => {
    if (fromSid === toSid) return;
    setSections((prev) => {
      const item = prev.find((s) => s.id === fromSid)?.items.find((w) => w.id === wid);
      if (!item) return prev;
      return prev.map((s) =>
        s.id === fromSid ? { ...s, items: s.items.filter((w) => w.id !== wid) }
        : s.id === toSid ? { ...s, items: [...s.items, item] } : s);
    });
  };

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const activeId = String(active.id), overId = String(over.id);
    if (isSectionId(activeId)) {
      if (!isSectionId(overId)) return;
      setSections((prev) => arrayMove(prev, prev.findIndex((s) => s.id === activeId), prev.findIndex((s) => s.id === overId)));
      return;
    }
    // Item drag.
    const from = sectionOf(activeId);
    const to = isSectionId(overId) ? sections.find((s) => s.id === overId) : sectionOf(overId);
    if (!from || !to) return;
    setSections((prev) => {
      const fromS = prev.find((s) => s.id === from.id)!;
      const item = fromS.items.find((w) => w.id === activeId)!;
      if (from.id === to.id) {
        const oldIdx = fromS.items.findIndex((w) => w.id === activeId);
        const newIdx = isSectionId(overId) ? fromS.items.length - 1 : fromS.items.findIndex((w) => w.id === overId);
        return prev.map((s) => (s.id === from.id ? { ...s, items: arrayMove(s.items, oldIdx, newIdx) } : s));
      }
      const insertAt = isSectionId(overId) ? to.items.length : to.items.findIndex((w) => w.id === overId);
      return prev.map((s) =>
        s.id === from.id ? { ...s, items: s.items.filter((w) => w.id !== activeId) }
        : s.id === to.id ? { ...s, items: [...s.items.slice(0, insertAt), item, ...s.items.slice(insertAt)] } : s);
    });
  };

  const save = async () => {
    setSaving(true); setErr(null);
    try { await saveTutorials(sections); onSaved(sections); }
    catch (e: any) { setErr(e?.message ?? String(e)); }
    finally { setSaving(false); }
  };

  // Preview reflects the live (unsaved) working copy — it's the same read-only view non-admins get.
  if (previewing) return <ReadOnly sections={sections} loaded admin previewing onExitPreview={() => setPreviewing(false)} />;

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center justify-between gap-3 mb-1">
        <div className="flex items-center gap-3"><Pencil className="w-6 h-6 text-gray-700" /><h1 className="text-2xl">Edit tutorials</h1></div>
        <div className="flex items-center gap-2">
          <button onClick={() => setPreviewing(true)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-300 bg-white text-sm text-gray-700 hover:bg-gray-50"><Eye className="w-4 h-4" /> Preview</button>
          <button onClick={onCancel} className="px-3 py-1.5 rounded-lg text-sm text-gray-600 hover:text-gray-900">Cancel</button>
          <button onClick={save} disabled={saving} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-900 text-white text-sm hover:bg-black disabled:opacity-50"><Save className="w-4 h-4" /> {saving ? "Saving…" : "Save"}</button>
        </div>
      </div>
      <p className="text-sm text-gray-500 mb-5">Drag the handles to reorder. Attach a video by pasting an Arcade / Loom / YouTube embed URL.</p>
      {err && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4">{err}</p>}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={sectionIds} strategy={verticalListSortingStrategy}>
          <div className="space-y-4">
            {sections.map((section) => (
              <SortableSection key={section.id} id={section.id}>
                {(handle) => (
                  <div className="rounded-2xl border border-gray-200 bg-white p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <span {...handle} className="cursor-grab text-gray-300 hover:text-gray-600" title="Drag to reorder section"><GripVertical className="w-5 h-5" /></span>
                      <input value={section.heading} onChange={(e) => patchSection(section.id, { heading: e.target.value })} placeholder="Section heading" className="flex-1 font-medium text-gray-900 border-b border-transparent hover:border-gray-200 focus:border-gray-400 focus:outline-none py-0.5" />
                      <button onClick={() => removeSection(section.id)} className="text-gray-300 hover:text-red-600" title="Delete section" aria-label="Delete section"><Trash2 className="w-4 h-4" /></button>
                    </div>
                    <input value={section.blurb} onChange={(e) => patchSection(section.id, { blurb: e.target.value })} placeholder="Short description of this section" className="w-full text-[13px] text-gray-500 border-b border-transparent hover:border-gray-200 focus:border-gray-400 focus:outline-none py-0.5 mb-3" />

                    <SortableContext items={section.items.map((w) => w.id)} strategy={verticalListSortingStrategy}>
                      <div className="space-y-2">
                        {section.items.map((item) => (
                          <SortableItem key={item.id} id={item.id}>
                            {(ihandle) => (
                              <div className="rounded-lg border border-gray-200 p-2.5">
                                <div className="flex items-center gap-2">
                                  <span {...ihandle} className="cursor-grab text-gray-300 hover:text-gray-600" title="Drag to reorder"><GripVertical className="w-4 h-4" /></span>
                                  {/* Icon picker */}
                                  <div className="relative">
                                    <button onClick={() => setIconPickerFor(iconPickerFor === item.id ? null : item.id)} className="w-8 h-8 rounded-lg bg-gray-100 text-gray-700 flex items-center justify-center hover:bg-gray-200" title="Change icon"><IconByName name={item.icon} className="w-4 h-4" /></button>
                                    {iconPickerFor === item.id && (
                                      <>
                                        <div className="fixed inset-0 z-40" onClick={() => setIconPickerFor(null)} />
                                        <div className="absolute z-50 mt-1 w-64 bg-white border border-border rounded-lg shadow-lg p-2 grid grid-cols-8 gap-1">
                                          {PALETTE.map((name) => (
                                            <button key={name} title={name} onClick={() => { patchItem(section.id, item.id, { icon: name }); setIconPickerFor(null); }} className={`w-7 h-7 rounded flex items-center justify-center hover:bg-gray-100 ${item.icon === name ? "bg-gray-900 text-white hover:bg-gray-900" : "text-gray-600"}`}><IconByName name={name} className="w-4 h-4" /></button>
                                          ))}
                                        </div>
                                      </>
                                    )}
                                  </div>
                                  <input value={item.title} onChange={(e) => patchItem(section.id, item.id, { title: e.target.value })} placeholder="Walkthrough title" className="flex-1 text-sm text-gray-900 border-b border-transparent hover:border-gray-200 focus:border-gray-400 focus:outline-none py-0.5" />
                                  {item.embedUrl ? <span className="text-[12px] text-emerald-700 inline-flex items-center gap-1"><Check className="w-3.5 h-3.5" /> video</span> : <span className="text-[12px] text-gray-400">no video</span>}
                                  {sections.length > 1 && (
                                    <select value={section.id} onChange={(e) => moveItemToSection(item.id, section.id, e.target.value)} title="Move to section" className="text-[12px] text-gray-500 border border-gray-200 rounded px-1 py-0.5 max-w-[8rem] bg-white">
                                      {sections.map((s) => <option key={s.id} value={s.id}>{s.heading || "Untitled"}</option>)}
                                    </select>
                                  )}
                                  <button onClick={() => removeItem(section.id, item.id)} className="text-gray-300 hover:text-red-600" title="Delete" aria-label="Delete walkthrough"><Trash2 className="w-4 h-4" /></button>
                                </div>
                                <div className="mt-2 pl-10 space-y-1.5">
                                  <input value={item.when} onChange={(e) => patchItem(section.id, item.id, { when: e.target.value })} placeholder="When you'd do this (one line)" className="w-full text-[13px] text-gray-600 border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-gray-300" />
                                  <div className="flex items-center gap-2">
                                    <input value={item.embedUrl ?? ""} onChange={(e) => setVideo(section.id, item.id, e.target.value)} placeholder="Video embed URL (Arcade / Loom / YouTube)" className="flex-1 text-[13px] text-gray-600 border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-gray-300" />
                                    <input value={item.length} onChange={(e) => patchItem(section.id, item.id, { length: e.target.value })} placeholder="1:10" className="w-16 text-[13px] text-gray-600 border border-gray-200 rounded px-2 py-1 text-center focus:outline-none focus:ring-2 focus:ring-gray-300" title="Duration label" />
                                  </div>
                                </div>
                              </div>
                            )}
                          </SortableItem>
                        ))}
                      </div>
                    </SortableContext>

                    <button onClick={() => addItem(section.id)} className="mt-2 inline-flex items-center gap-1 text-[13px] text-gray-500 hover:text-gray-900"><Plus className="w-3.5 h-3.5" /> Add walkthrough</button>
                  </div>
                )}
              </SortableSection>
            ))}
          </div>
        </SortableContext>
      </DndContext>

      <button onClick={addSection} className="mt-4 inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-dashed border-gray-300 text-sm text-gray-600 hover:bg-gray-50"><Plus className="w-4 h-4" /> Add section</button>
    </div>
  );
}

// Sortable wrappers — expose drag-handle props via render prop so only the handle initiates a drag.
function SortableSection({ id, children }: { id: string; children: (handle: Record<string, unknown>) => React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : 1 }}>{children({ ...attributes, ...listeners })}</div>;
}
function SortableItem({ id, children }: { id: string; children: (handle: Record<string, unknown>) => React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : 1 }}>{children({ ...attributes, ...listeners })}</div>;
}
