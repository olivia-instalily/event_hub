import { useState, useEffect } from "react";
import { Plus, X, Star, ExternalLink, GripVertical } from "lucide-react";
import { DndContext, pointerWithin, PointerSensor, KeyboardSensor, useSensor, useSensors, useDraggable, useDroppable, type DragEndEvent } from "@dnd-kit/core";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@instalily/ui/select";
import type { TabProps } from "./SeriesDashboard";
import { type Wave } from "../lib/campaign";
import { listEvents, setEventSeries, type EventListItem, type SeriesEvent } from "../lib/db";
import { DateEdit } from "./DateEdit";

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
function EventChip({ event, anchor, inWave, waves, onOpen, onToggleAnchor, onUnassign, onAssign }: {
  event: SeriesEvent;
  anchor: boolean;
  inWave: boolean;
  waves: Wave[];
  onOpen?: (id: string) => void;
  onToggleAnchor: (id: string) => void;
  onUnassign: (id: string) => void;
  onAssign: (id: string, waveId: string) => void;
}) {
  const { setNodeRef, attributes, listeners, transform, isDragging } = useDraggable({ id: event.id });
  const style = transform ? { transform: `translate(${transform.x}px, ${transform.y}px)`, zIndex: 50, position: "relative" as const } : undefined;
  return (
    <div ref={setNodeRef} style={style} className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${anchor ? "border-amber-300 bg-amber-50" : "border-gray-200 bg-white"} ${isDragging ? "opacity-70 shadow-lg ring-2 ring-gray-300" : ""}`}>
      <button {...attributes} {...listeners} className="shrink-0 cursor-grab active:cursor-grabbing text-gray-300 hover:text-gray-500 touch-none" title="Drag to a wave" aria-label="Drag event"><GripVertical className="w-4 h-4" /></button>
      {anchor && <Star className="w-3.5 h-3.5 text-amber-500 shrink-0" />}
      <button onClick={() => onOpen?.(event.id)} className="flex-1 min-w-0 text-left text-sm hover:underline inline-flex items-center gap-1"><span className="truncate">{event.name}</span><ExternalLink className="w-3 h-3 text-gray-400 shrink-0" /></button>
      <span className="text-[12px] text-gray-400 shrink-0">{event.date ?? "—"}</span>
      <button onClick={() => onToggleAnchor(event.id)} title={anchor ? "Unmark anchor" : "Mark as anchor"} className={`shrink-0 ${anchor ? "text-amber-500" : "text-gray-300 hover:text-amber-500"}`}><Star className="w-4 h-4" /></button>
      {inWave ? (
        <button onClick={() => onUnassign(event.id)} title="Remove from wave" className="shrink-0 text-gray-300 hover:text-red-600"><X className="w-4 h-4" /></button>
      ) : waves.length > 0 ? (
        <div className="shrink-0"><WaveSelect waves={waves} onPick={(wid) => onAssign(event.id, wid)} /></div>
      ) : null}
    </div>
  );
}

// A drop target (a wave's event list, or the pending bin). Highlights while a row hovers over it.
function DropZone({ id, empty, children }: { id: string; empty: boolean; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div ref={setNodeRef} className={`rounded-lg border border-dashed p-1.5 space-y-1.5 transition-colors ${isOver ? "border-gray-400 bg-gray-50 ring-2 ring-gray-300" : empty ? "border-gray-200" : "border-transparent"} ${empty ? "min-h-[3rem]" : ""}`}>
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

export function SeriesPlan({ seriesId, campaign, events, save, onOpenEvent, reload }: TabProps) {
  const [adding, setAdding] = useState(false);
  const [wName, setWName] = useState("");
  // Which target the "add event" picker is open for: null = closed, "pending" = add to series only,
  // or a wave id = add straight into that wave.
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<EventListItem[]>([]);
  useEffect(() => {
    if (pickerFor === null) { setCandidates([]); return; }
    listEvents().then((all) => setCandidates(all.filter((e) => !e.isTemplate && e.seriesId !== seriesId))).catch(() => setCandidates([]));
  }, [pickerFor, seriesId]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor));

  const eventsById = Object.fromEntries(events.map((e) => [e.id, e])) as Record<string, SeriesEvent>;
  const assignedIds = new Set(campaign.waves.flatMap((w) => w.eventIds));
  const pending = events.filter((e) => !assignedIds.has(e.id));

  const addWave = () => { if (!wName.trim()) return; save({ ...campaign, waves: [...campaign.waves, { id: newWaveId(), name: wName.trim(), start: null, end: null, eventIds: [] }] }); setWName(""); setAdding(false); };
  const patchWave = (id: string, patch: Partial<Wave>) => save({ ...campaign, waves: campaign.waves.map((w) => (w.id === id ? { ...w, ...patch } : w)) });
  const removeWave = (id: string) => save({ ...campaign, waves: campaign.waves.filter((w) => w.id !== id) });
  // Assign to exactly one wave (removes from any other wave it was in).
  const assignEvent = (eventId: string, waveId: string) => save({ ...campaign, waves: campaign.waves.map((w) => ({ ...w, eventIds: w.id === waveId ? [...new Set([...w.eventIds, eventId])] : w.eventIds.filter((id) => id !== eventId) })) });
  const unassign = (eventId: string) => save({ ...campaign, waves: campaign.waves.map((w) => ({ ...w, eventIds: w.eventIds.filter((id) => id !== eventId) })) });
  const toggleAnchor = (eventId: string) => save({ ...campaign, anchorEventIds: campaign.anchorEventIds.includes(eventId) ? campaign.anchorEventIds.filter((id) => id !== eventId) : [...campaign.anchorEventIds, eventId] });

  // Pull an existing event into the series. Always registers series membership (so it joins the
  // member list / pending); if a wave is given, also drops it straight into that wave.
  const addToSeries = async (eventId: string, waveId?: string) => {
    await setEventSeries(eventId, seriesId).catch(() => {});
    if (waveId) assignEvent(eventId, waveId);
    setPickerFor(null);
    reload(); // refetch member events so the new one shows up
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
        {campaign.waves.map((w) => (
          <section key={w.id} className="rounded-xl border border-border p-4">
            <div className="flex items-center gap-2">
              <input value={w.name} onChange={(e) => patchWave(w.id, { name: e.target.value })} placeholder="Wave name" className="font-medium text-[15px] flex-1 min-w-0 border-b border-transparent hover:border-gray-200 focus:border-gray-400 focus:outline-none" />
              <button onClick={() => removeWave(w.id)} className="text-gray-300 hover:text-red-600 shrink-0" aria-label="Remove wave"><X className="w-4 h-4" /></button>
            </div>
            <div className="mt-2 mb-3 flex flex-wrap items-center gap-1">
              <DateEdit value={w.start} onChange={(v) => patchWave(w.id, { start: v })} placeholder="Start date" />
              <span className="text-gray-400 text-sm">→</span>
              <DateEdit value={w.end} onChange={(v) => patchWave(w.id, { end: v })} placeholder="End date" />
            </div>
            <DropZone id={w.id} empty={w.eventIds.length === 0}>
              {w.eventIds.length === 0
                ? <p className="text-[13px] text-gray-400 px-1 py-1.5">No events yet — drag one here or use “Add event”.</p>
                : w.eventIds.map((id) => eventsById[id] && (
                    <EventChip key={id} event={eventsById[id]} anchor={campaign.anchorEventIds.includes(id)} inWave waves={campaign.waves} onOpen={onOpenEvent} onToggleAnchor={toggleAnchor} onUnassign={unassign} onAssign={assignEvent} />
                  ))}
            </DropZone>
            <div className="mt-2">
              {pickerFor === w.id ? (
                <EventPicker candidates={candidates} onPick={(id) => void addToSeries(id, w.id)} onCancel={() => setPickerFor(null)} />
              ) : (
                <button onClick={() => setPickerFor(w.id)} className="inline-flex items-center gap-1 text-[13px] text-gray-500 hover:text-gray-900"><Plus className="w-3.5 h-3.5" /> Add event</button>
              )}
            </div>
          </section>
        ))}

        {adding ? (
          <div className="flex items-center gap-2">
            <input autoFocus value={wName} onChange={(e) => setWName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addWave(); }} placeholder="Wave name (e.g. Wave 1)" className="px-3 py-2 border border-border rounded-lg text-sm" />
            <button onClick={addWave} disabled={!wName.trim()} className="px-3 py-2 bg-gray-900 text-white rounded-lg text-sm disabled:opacity-50">Add</button>
            <button onClick={() => setAdding(false)} className="text-gray-400 hover:text-gray-700"><X className="w-4 h-4" /></button>
          </div>
        ) : (
          <button onClick={() => setAdding(true)} className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900"><Plus className="w-4 h-4" /> Add wave</button>
        )}

        <section>
          <h3 className="text-[15px] font-medium text-gray-700 mb-2">Pending events <span className="text-gray-400 font-normal">· not yet in a wave</span></h3>
          <DropZone id="pending" empty={pending.length === 0}>
            {pending.length === 0
              ? <p className="text-[13px] text-gray-400 px-1 py-1.5">All member events are assigned.{events.length === 0 ? " Add one below." : " Drag one here to unassign it."}</p>
              : pending.map((e) => (
                  <EventChip key={e.id} event={e} anchor={campaign.anchorEventIds.includes(e.id)} inWave={false} waves={campaign.waves} onOpen={onOpenEvent} onToggleAnchor={toggleAnchor} onUnassign={unassign} onAssign={assignEvent} />
                ))}
          </DropZone>
          <div className="mt-3">
            {pickerFor === "pending" ? (
              <EventPicker candidates={candidates} onPick={(id) => void addToSeries(id)} onCancel={() => setPickerFor(null)} />
            ) : (
              <button onClick={() => setPickerFor("pending")} className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900"><Plus className="w-4 h-4" /> Add event to series</button>
            )}
          </div>
        </section>
      </div>
    </DndContext>
  );
}
