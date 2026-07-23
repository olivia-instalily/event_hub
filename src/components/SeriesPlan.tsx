import { useState, useEffect } from "react";
import { Plus, X, Star, GripVertical, AlertCircle, Plane, StickyNote, CircleDashed } from "lucide-react";
import { DndContext, pointerWithin, PointerSensor, KeyboardSensor, useSensor, useSensors, useDraggable, useDroppable, type DragEndEvent } from "@dnd-kit/core";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@instalily/ui/select";
import type { TabProps } from "./SeriesDashboard";
import { type Wave, waveColor, waveBounds } from "../lib/campaign";
import { listEvents, setEventSeries, extractBrief, createPlanningEvent, type EventListItem, type SeriesEvent } from "../lib/db";
import { defaultPhases } from "../lib/eventPhases";
import { DateEdit } from "./DateEdit";
import { WavePresence } from "./WavePresence";
import { ConfirmModal } from "./Modal";

const newWaveId = () => "w-" + (globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2));

// Small brand-Select used as an action menu ("pick a wave" → assign). Value stays empty so it can be
// re-picked; the choice fires onPick. Matches the site's Select instead of a native OS dropdown.
function WaveSelect({ waves, onPick }: { waves: Wave[]; onPick: (waveId: string) => void }) {
  const items = waves.map((w) => ({ value: w.id, label: w.name }));
  return (
    <Select value="" onValueChange={(v) => v && onPick(v as string)} items={items}>
      <SelectTrigger className="h-8 min-w-[9rem] text-[12px]"><SelectValue placeholder="Add to wave…" /></SelectTrigger>
      <SelectContent>
        {waves.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

// A draggable event row. Module-scope component (uses the useDraggable hook) so it isn't redefined on
// every render. Drag is isolated to the grip handle; the name/anchor/select stay clickable.
function EventChip({ event, anchor, tentative, inWave, waves, onOpen, onToggleAnchor, onToggleTentative, onUnassign, onAssign, onRemove }: {
  event: SeriesEvent;
  anchor: boolean;
  tentative: boolean;
  inWave: boolean;
  waves: Wave[];
  onOpen?: (id: string) => void;
  onToggleAnchor: (id: string) => void;
  onToggleTentative: (id: string) => void;
  onUnassign: (id: string) => void;
  onAssign: (id: string, waveId: string) => void;
  onRemove?: (id: string) => void; // pending only: remove the event from the series entirely
}) {
  const { setNodeRef, attributes, listeners, transform, isDragging } = useDraggable({ id: event.id });
  const style = transform ? { transform: `translate(${transform.x}px, ${transform.y}px)`, zIndex: 50, position: "relative" as const } : undefined;
  const subtitle = [event.date, event.location].filter(Boolean).join(" · ");
  return (
    <div ref={setNodeRef} style={style} className={`group/row flex items-center gap-2 py-2 ${isDragging ? "opacity-80 bg-white rounded-lg px-2 shadow-lg ring-1 ring-gray-200" : ""}`}>
      <button {...attributes} {...listeners} className="shrink-0 cursor-grab active:cursor-grabbing text-gray-200 group-hover/row:text-gray-400 hover:text-gray-600 touch-none" title="Drag to a wave" aria-label="Drag event"><GripVertical className="w-4 h-4" /></button>
      {anchor && <Star className="w-3.5 h-3.5 text-amber-500 shrink-0" />}
      <button onClick={() => onOpen?.(event.id)} className="flex-1 min-w-0 text-left">
        <span className={`block text-sm font-medium text-gray-900 truncate group-hover/row:underline ${tentative ? "italic" : ""}`}>{event.name}{tentative && <span className="ml-1 not-italic text-[11px] font-normal text-gray-400">tentative</span>}</span>
        {subtitle && <span className="block text-[12px] text-gray-400 truncate">{subtitle}</span>}
      </button>
      <button onClick={() => onToggleTentative(event.id)} title={tentative ? "Mark confirmed" : "Mark tentative"} className={`shrink-0 ${tentative ? "text-gray-600" : "text-gray-300 hover:text-gray-600"}`}><CircleDashed className="w-4 h-4" /></button>
      <button onClick={() => onToggleAnchor(event.id)} title={anchor ? "Unmark anchor" : "Mark as anchor"} className={`shrink-0 ${anchor ? "text-amber-500" : "text-gray-300 hover:text-amber-500"}`}><Star className="w-4 h-4" /></button>
      {inWave ? (
        <button onClick={() => onUnassign(event.id)} title="Remove from wave" className="shrink-0 text-gray-300 hover:text-red-600"><X className="w-4 h-4" /></button>
      ) : (
        <>
          {waves.length > 0 && <div className="shrink-0"><WaveSelect waves={waves} onPick={(wid) => onAssign(event.id, wid)} /></div>}
          {onRemove && <button onClick={() => onRemove(event.id)} title="Remove from series" className="shrink-0 text-gray-300 hover:text-red-600"><X className="w-4 h-4" /></button>}
        </>
      )}
    </div>
  );
}

// A drop target (a wave's event list, or the pending bin). Highlights while a row hovers over it.
function DropZone({ id, empty, children }: { id: string; empty: boolean; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div ref={setNodeRef} className={`rounded-lg transition-colors ${isOver ? "bg-gray-50 ring-2 ring-gray-300" : ""} ${empty ? "min-h-[2.25rem]" : "divide-y divide-gray-100"}`}>
      {children}
    </div>
  );
}

// Inline picker of existing events to pull into the series (optionally straight into a wave).
function EventPicker({ candidates, onPick, onCancel }: { candidates: EventListItem[]; onPick: (eventId: string) => void; onCancel: () => void }) {
  return (
    <div className="mt-2 rounded-lg border border-border p-2 max-h-60 overflow-y-auto">
      {candidates.length === 0 ? <p className="text-[13px] text-gray-400 px-1 py-2">No other events to add.</p> : candidates.map((c) => (
        <button key={c.id} onClick={() => onPick(c.id)} className="flex w-full items-center justify-between px-2 py-1.5 rounded text-sm hover:bg-gray-50 text-left">
          <span className="truncate">{c.title}</span>
          <span className="text-[12px] text-gray-400 shrink-0">{c.seriesName ? `in ${c.seriesName}` : (c.date ?? "—")}</span>
        </button>
      ))}
      <button onClick={onCancel} className="mt-1 text-[13px] text-gray-500 hover:text-gray-800 px-1">Cancel</button>
    </div>
  );
}

export function SeriesPlan({ seriesId, campaign, events, save, onOpenEvent, reloadEvents }: TabProps) {
  const [adding, setAdding] = useState(false);
  const [wName, setWName] = useState("");
  const [view, setView] = useState<"viz" | "plan">("viz"); // toggle: visualization vs. waves/events editor
  // Which target the "add event" picker is open for: null = closed, "pending" = add to series only,
  // or a wave id = add straight into that wave.
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<EventListItem[]>([]);
  const [dropTarget, setDropTarget] = useState<{ waveId: string; files: File[] } | null>(null); // file dropped on a wave → confirm create
  const [fileOverWave, setFileOverWave] = useState<string | null>(null); // wave currently under a file-drag
  useEffect(() => {
    if (pickerFor === null) { setCandidates([]); return; }
    listEvents().then((all) => setCandidates(all.filter((e) => !e.isTemplate && e.seriesId !== seriesId))).catch(() => setCandidates([]));
  }, [pickerFor, seriesId]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor));

  const eventsById = Object.fromEntries(events.map((e) => [e.id, e])) as Record<string, SeriesEvent>;
  const eventDates: Record<string, string | null> = Object.fromEntries(events.map((e) => [e.id, e.date]));
  const fmtShort = (d: string) => new Date(d + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const assignedIds = new Set(campaign.waves.flatMap((w) => w.eventIds));
  const pending = events.filter((e) => !assignedIds.has(e.id));

  const addWave = () => { if (!wName.trim()) return; save({ ...campaign, waves: [...campaign.waves, { id: newWaveId(), name: wName.trim(), start: null, end: null, eventIds: [] }] }); setWName(""); setAdding(false); };
  const patchWave = (id: string, patch: Partial<Wave>) => save({ ...campaign, waves: campaign.waves.map((w) => (w.id === id ? { ...w, ...patch } : w)) });
  const removeWave = (id: string) => save({ ...campaign, waves: campaign.waves.filter((w) => w.id !== id) });
  // Assign to exactly one wave (removes from any other wave it was in).
  const assignEvent = (eventId: string, waveId: string) => save({ ...campaign, waves: campaign.waves.map((w) => ({ ...w, eventIds: w.id === waveId ? [...new Set([...w.eventIds, eventId])] : w.eventIds.filter((id) => id !== eventId) })) });
  const unassign = (eventId: string) => save({ ...campaign, waves: campaign.waves.map((w) => ({ ...w, eventIds: w.eventIds.filter((id) => id !== eventId) })) });
  const toggleAnchor = (eventId: string) => save({ ...campaign, anchorEventIds: campaign.anchorEventIds.includes(eventId) ? campaign.anchorEventIds.filter((id) => id !== eventId) : [...campaign.anchorEventIds, eventId] });
  const toggleTentative = (eventId: string) => save({ ...campaign, tentativeEventIds: campaign.tentativeEventIds.includes(eventId) ? campaign.tentativeEventIds.filter((id) => id !== eventId) : [...campaign.tentativeEventIds, eventId] });
  // Remove a pending event from the series entirely (unlink it — the event itself is not deleted).
  const removeFromSeries = async (eventId: string) => {
    await setEventSeries(eventId, null).catch(() => {});
    save({ ...campaign, waves: campaign.waves.map((w) => ({ ...w, eventIds: w.eventIds.filter((id) => id !== eventId) })), anchorEventIds: campaign.anchorEventIds.filter((id) => id !== eventId) });
    reloadEvents();
  };

  // Pull an existing event into the series. Always registers series membership (so it joins the
  // member list / pending); if a wave is given, also drops it straight into that wave.
  const addToSeries = async (eventId: string, waveId?: string) => {
    await setEventSeries(eventId, seriesId).catch(() => {});
    if (waveId) assignEvent(eventId, waveId); // optimistic wave assignment (persisted via save)
    setPickerFor(null);
    reloadEvents(); // refetch ONLY the member events — leaves the optimistic wave assignment intact
  };

  // Drop a brief FILE onto a wave → confirm → create an event from it and assign it to that wave.
  const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes("Files");
  const createFromDrop = async () => {
    if (!dropTarget) return;
    const { waveId, files } = dropTarget;
    setDropTarget(null);
    const file = files[0];
    const text = await file.text().catch(() => "");
    let ex: Awaited<ReturnType<typeof extractBrief>> | null = null;
    try { ex = await extractBrief(text); } catch { ex = null; }
    const name = (ex?.title && ex.title.trim()) || file.name.replace(/\.[^.]+$/, "") || "Untitled event";
    // Assume this year (or next occurrence) for a year-less/stale date — matches the create flow.
    const todayIso = new Date().toISOString().slice(0, 10);
    let date = (ex?.date && ex.date.trim()) || null;
    if (date && date < todayIso) { const d = new Date(date + "T00:00:00"); const now = new Date(); d.setFullYear(now.getFullYear()); if (d.toISOString().slice(0, 10) < todayIso) d.setFullYear(now.getFullYear() + 1); date = d.toISOString().slice(0, 10); }
    const id = await createPlanningEvent({
      name, date, location: (ex?.location && ex.location.trim()) || null, tags: [],
      format: (ex?.format && ex.format.trim()) || null,
      phases: defaultPhases(date),
      template: { name, vendorCategories: [], budgetLines: [], progressCategories: [] },
    }).catch(() => null);
    if (!id) return;
    await setEventSeries(id, seriesId).catch(() => {});
    assignEvent(id, waveId);
    reloadEvents();
  };

  // Drag a row onto a wave → assign there; onto the pending bin → unassign.
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over) return;
    const eventId = String(e.active.id);
    const target = String(e.over.id);
    if (target === "pending") unassign(eventId);
    else assignEvent(eventId, target);
  };

  return (
    <DndContext sensors={sensors} collisionDetection={pointerWithin} onDragEnd={onDragEnd}>
      <div className="space-y-6">
        {/* Toggle between the visualization and the waves/events editor so both are one click away. */}
        <div className="inline-flex rounded-lg border border-border bg-gray-50 p-0.5 text-sm">
          {([["viz", "Visualization"], ["plan", "Waves & events"]] as const).map(([k, label]) => (
            <button key={k} onClick={() => setView(k)} className={`px-3 py-1 rounded-md transition-colors ${view === k ? "bg-white shadow-sm text-gray-900" : "text-gray-500 hover:text-gray-800"}`}>{label}</button>
          ))}
        </div>

        {/* Wave-presence visualization */}
        {view === "viz" && (
          <section className="rounded-xl border border-border p-4">
            <WavePresence campaign={campaign} events={events} save={save} />
          </section>
        )}

        {/* Waves + events editor */}
        {view === "plan" && <>
        {/* Top bar — wave nav chips + Add wave. Always visible in the plan view (even with 0 waves),
            so waves are created here and each chip jumps to its section. */}
        <div className="sticky top-0 z-30 -mx-1 mb-2 flex flex-wrap items-center gap-1.5 border-b border-border bg-white px-1 py-2 shadow-sm">
          {campaign.waves.map((w, wi) => {
            const wc = waveColor(wi);
            const fmt = (d: string) => new Date(d + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" });
            return (
              <button key={w.id} onClick={() => document.getElementById(`wave-${w.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" })}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-white px-2.5 py-1 text-[12px] hover:bg-gray-50 transition-colors">
                <span className={`w-2 h-2 rounded-full shrink-0 ${wc.dot}`} />
                <span className="font-medium text-gray-800">{w.name || "Wave"}</span>
                {w.start && <span className="text-gray-400">{fmt(w.start)}{w.end && w.end !== w.start ? `–${fmt(w.end)}` : ""}</span>}
              </button>
            );
          })}
          {adding ? (
            <span className="inline-flex items-center gap-1">
              <input autoFocus value={wName} onChange={(e) => setWName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addWave(); else if (e.key === "Escape") { setAdding(false); setWName(""); } }} placeholder="Wave name" className="w-32 px-2.5 py-1 border border-gray-300 rounded-full text-[12px] focus:outline-none focus:ring-2 focus:ring-gray-300" />
              <button onClick={addWave} disabled={!wName.trim()} className="rounded-full bg-gray-900 text-white px-2.5 py-1 text-[12px] disabled:opacity-50">Add</button>
              <button onClick={() => { setAdding(false); setWName(""); }} className="text-gray-400 hover:text-gray-700" aria-label="Cancel"><X className="w-3.5 h-3.5" /></button>
            </span>
          ) : (
            <button onClick={() => setAdding(true)} className="inline-flex items-center gap-1 rounded-full border border-dashed border-gray-300 px-2.5 py-1 text-[12px] text-gray-500 hover:text-gray-900 hover:border-gray-400 transition-colors"><Plus className="w-3.5 h-3.5" /> Add wave</button>
          )}
        </div>

        <div className="flex flex-col md:flex-row gap-6 items-start">
          <div className="flex-1 min-w-0 space-y-6">
            {campaign.waves.length === 0 && (
              <p className="text-[13px] text-gray-400 py-8 text-center border border-dashed border-gray-200 rounded-xl">No waves yet — add one on the bar above, then drag events in from the Events bank.</p>
            )}
            {campaign.waves.map((w, wi) => {
          const wc = waveColor(wi);
          // Events assigned to this wave whose date falls outside the wave's own date range (both set).
          const outOfRange = (w.start && w.end)
            ? w.eventIds.map((id) => eventsById[id]).filter((e): e is SeriesEvent => !!e && !!e.date && (e.date < w.start! || e.date > w.end!))
            : [];
          // Day logistics (notes/travel) that fall within this wave's date range.
          const lb = waveBounds(w, eventDates);
          const waveLogs = (lb.start && lb.end) ? campaign.logistics.filter((l) => l.date >= lb.start! && l.date <= lb.end!).sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? "").localeCompare(b.time ?? "")) : [];
          return (
          <section
            key={w.id}
            id={`wave-${w.id}`}
            onDragOver={(e) => { if (hasFiles(e)) { e.preventDefault(); e.stopPropagation(); setFileOverWave(w.id); } }}
            onDragLeave={(e) => { e.stopPropagation(); if (e.currentTarget === e.target) setFileOverWave((cur) => (cur === w.id ? null : cur)); }}
            onDrop={(e) => { if (hasFiles(e)) { e.preventDefault(); e.stopPropagation(); setFileOverWave(null); const fs = Array.from(e.dataTransfer.files); if (fs.length) setDropTarget({ waveId: w.id, files: fs }); } }}
            className={`px-1 pt-1 pb-5 scroll-mt-16 transition-colors ${fileOverWave === w.id ? "ring-2 ring-gray-300 bg-gray-50 rounded-xl" : ""}`}
          >
            {/* Borderless header: color dot + bold name, then dates in gray; remove sits far right. */}
            <div className="flex items-center gap-2 mb-1.5">
              <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${wc.dot}`} title={`${wc.name} wave`} />
              <input value={w.name} onChange={(e) => patchWave(w.id, { name: e.target.value })} placeholder="Wave name" className="font-semibold text-[15px] min-w-0 flex-1 bg-transparent border-b border-transparent hover:border-gray-200 focus:border-gray-400 focus:outline-none" />
              <span className="shrink-0 inline-flex items-center gap-1 text-[13px] text-gray-400">
                <DateEdit value={w.start} onChange={(v) => patchWave(w.id, { start: v })} placeholder="Start" />
                <span>–</span>
                <DateEdit value={w.end} onChange={(v) => patchWave(w.id, { end: v })} placeholder="End" />
              </span>
              <button onClick={() => removeWave(w.id)} className="shrink-0 text-gray-300 hover:text-red-600" aria-label="Remove wave"><X className="w-4 h-4" /></button>
            </div>
            {outOfRange.length > 0 && (
              <p className="flex items-start gap-1 text-[12px] text-red-600 mb-1.5 ml-[1.125rem]">
                <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-px" />
                <span>{outOfRange.length === 1
                  ? `“${outOfRange[0].name}” (${outOfRange[0].date}) falls outside this wave's dates.`
                  : `${outOfRange.length} events fall outside this wave's dates: ${outOfRange.map((e) => e.name).join(", ")}.`}</span>
              </p>
            )}
            <div className="flex">
              {/* Colored left rail — same color as the dot, dropping straight down from it (with a
                  gap below the dot). Acts as the wave's left edge; content is indented to its right. */}
              <div className="relative w-2.5 shrink-0 mr-2" aria-hidden="true">
                <div className={`absolute top-1 bottom-0 left-1/2 -translate-x-1/2 w-0.5 rounded-full ${wc.dot}`} />
              </div>
              <div className="flex-1 min-w-0">
                <DropZone id={w.id} empty={w.eventIds.length === 0}>
                  {w.eventIds.length === 0
                    ? <p className="text-[13px] text-gray-400 py-1.5">No events yet — drag one in from the Events bank, or drop a brief here.</p>
                    : w.eventIds.map((id) => eventsById[id] && (
                        <EventChip key={id} event={eventsById[id]} anchor={campaign.anchorEventIds.includes(id)} tentative={campaign.tentativeEventIds.includes(id)} inWave waves={campaign.waves} onOpen={onOpenEvent} onToggleAnchor={toggleAnchor} onToggleTentative={toggleTentative} onUnassign={unassign} onAssign={assignEvent} />
                      ))}
                </DropZone>
              </div>
              {/* Logistics / notes for this wave's days — on the right. Added on the visualization. */}
              {waveLogs.length > 0 && (
                <div className="w-52 shrink-0 border-l border-gray-100 pl-3 ml-2">
                  <p className="text-[12px] font-medium text-gray-500 mb-1.5">Logistics</p>
                  <ul className="space-y-1.5">
                    {waveLogs.map((l) => (
                      <li key={l.id} className="group/log flex items-start gap-1.5 text-[12px] text-gray-700">
                        {l.kind === "travel" ? <Plane className="w-3 h-3 text-gray-400 mt-0.5 shrink-0" /> : <StickyNote className="w-3 h-3 text-gray-400 mt-0.5 shrink-0" />}
                        <span className="flex-1 min-w-0">
                          <span className="text-gray-400">{fmtShort(l.date)}{l.time ? ` · ${l.time}` : ""}</span>
                          <span className="block">{l.text}</span>
                        </span>
                        <button onClick={() => save({ ...campaign, logistics: campaign.logistics.filter((x) => x.id !== l.id) })} className="text-gray-300 hover:text-red-600 opacity-0 group-hover/log:opacity-100 shrink-0" aria-label="Remove"><X className="w-3.5 h-3.5" /></button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </section>
          );
        })}
          </div>

          {/* Events bank — series events not yet in a wave. Drag one onto a wave (like the People
              tab's person bank). "Add event to series" pulls an existing event in here. */}
          <aside className="w-full md:w-72 shrink-0 rounded-xl border border-border p-4 md:sticky md:top-16">
            <p className="text-[13px] font-medium text-gray-700">Events bank</p>
            <p className="text-[12px] text-gray-400 mb-3">Series events not yet in a wave. Drag one onto a wave.</p>
            <DropZone id="pending" empty={pending.length === 0}>
              {pending.length === 0
                ? <p className="text-[13px] text-gray-400 px-1 py-1.5">{events.length === 0 ? "No events yet — add one below." : "All events are in a wave. Drag one here to pull it out."}</p>
                : pending.map((e) => (
                    <EventChip key={e.id} event={e} anchor={campaign.anchorEventIds.includes(e.id)} tentative={campaign.tentativeEventIds.includes(e.id)} inWave={false} waves={campaign.waves} onOpen={onOpenEvent} onToggleAnchor={toggleAnchor} onToggleTentative={toggleTentative} onUnassign={unassign} onAssign={assignEvent} onRemove={(id) => void removeFromSeries(id)} />
                  ))}
            </DropZone>
            <div className="mt-3">
              {pickerFor === "pending" ? (
                <EventPicker candidates={candidates} onPick={(id) => void addToSeries(id)} onCancel={() => setPickerFor(null)} />
              ) : (
                <button onClick={() => setPickerFor("pending")} className="inline-flex items-center gap-1 text-[13px] text-gray-500 hover:text-gray-900"><Plus className="w-3.5 h-3.5" /> Add event to series</button>
              )}
            </div>
          </aside>
        </div>
        </>}
      </div>

      {dropTarget && (
        <ConfirmModal
          title="Create event + assign to this wave?"
          message={`Create an event from “${dropTarget.files[0]?.name ?? "this file"}” and add it to ${campaign.waves.find((w) => w.id === dropTarget.waveId)?.name || "this wave"}?`}
          confirmLabel="Create + assign"
          onConfirm={() => void createFromDrop()}
          onClose={() => setDropTarget(null)}
        />
      )}
    </DndContext>
  );
}
