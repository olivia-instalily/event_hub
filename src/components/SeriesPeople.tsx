import { useState, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Plus, X, Plane, MapPin, Clock, Check, GripVertical } from "lucide-react";
import { DndContext, pointerWithin, PointerSensor, useSensor, useSensors, useDraggable, useDroppable, type DragEndEvent } from "@dnd-kit/core";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@instalily/ui/select";
import type { TabProps } from "./SeriesDashboard";
import {
  personLabel, crewRole, bodyCount, isAnonymous, waveStatus, waveTravel, isPartialInWave,
  eachDay, waveBounds, campaignPeak, crewTravelCounts, waveColor, CREW_ROLES, ROLE_LABEL,
  type CampaignPerson, type Wave, type CrewRole,
} from "../lib/campaign";
import { useProfile } from "../lib/profile";
import { NumberField } from "./NumberField";

const newPersonId = () => "cp-" + (globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2));
const fmtDay = (d: string) => new Date(d + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" });

// Dot / chip color = role (sky / violet / amber / gray); fill = status (confirmed solid / proposed outline).
// Lighter, softer palette to match the site's UI library. Confirmed = solid; proposed = a transparent
// light tint of the same hue (no outline).
const HUE: Record<CrewRole, { solid: string; outline: string }> = {
  eng: { solid: "bg-sky-400 text-white border-2 border-sky-400", outline: "bg-sky-400/20 text-sky-700 border-2 border-transparent" },
  biz: { solid: "bg-violet-400 text-white border-2 border-violet-400", outline: "bg-violet-400/20 text-violet-700 border-2 border-transparent" },
  leadership: { solid: "bg-amber-400 text-white border-2 border-amber-400", outline: "bg-amber-400/25 text-amber-800 border-2 border-transparent" },
  none: { solid: "bg-gray-300 text-gray-700 border-2 border-gray-300", outline: "bg-gray-400/20 text-gray-600 border-2 border-transparent" },
};
const dotClass = (role: CrewRole, status: "confirmed" | "proposed") => (status === "confirmed" ? HUE[role].solid : HUE[role].outline);

// Crew dot board: people as dots grouped by wave (color = role, fill = status, clock badge = partial
// presence, number = anonymous headcount). A person bank on the right lists everyone on the series;
// drag a person onto a wave to assign (they stay in the bank — people can be in multiple waves).
export function SeriesPeople({ campaign, events, save }: TabProps) {
  const { profiles } = useProfile();
  const [openDot, setOpenDot] = useState<string | null>(null); // `${personId}|${waveId}`
  const [dotAnchor, setDotAnchor] = useState<DOMRect | null>(null);
  const [openAdd, setOpenAdd] = useState<string | null>(null); // waveId whose add-menu is open
  const [addAnchor, setAddAnchor] = useState<DOMRect | null>(null);
  const [bankName, setBankName] = useState("");
  const openDotAt = (key: string, el: HTMLElement) => { setOpenDot(openDot === key ? null : key); setDotAnchor(el.getBoundingClientRect()); setOpenAdd(null); };
  const openAddAt = (waveId: string, el: HTMLElement) => { setOpenAdd(openAdd === waveId ? null : waveId); setAddAnchor(el.getBoundingClientRect()); setOpenDot(null); };

  const eventDates: Record<string, string | null> = {};
  for (const e of events) eventDates[e.id] = e.date;

  const patchPerson = (id: string, patch: Partial<CampaignPerson>) => save({ ...campaign, people: campaign.people.map((p) => (p.id === id ? { ...p, ...patch } : p)) });
  const setWaveMap = <T,>(p: CampaignPerson, field: "statusByWave" | "travelByWave" | "spans", waveId: string, val: T | undefined) => {
    const cur = { ...(p as any)[field] } as Record<string, unknown>;
    if (val === undefined) delete cur[waveId]; else cur[waveId] = val;
    patchPerson(p.id, { [field]: Object.keys(cur).length ? cur : undefined } as Partial<CampaignPerson>);
  };
  // Remove from a wave — keeps the person in the bank (they may still be on the series in some form).
  const removeFromWave = (p: CampaignPerson, waveId: string) => {
    const clean = (m?: Record<string, unknown>) => { if (!m) return undefined; const n = { ...m }; delete n[waveId]; return Object.keys(n).length ? n : undefined; };
    patchPerson(p.id, { waveIds: p.waveIds.filter((w) => w !== waveId), spans: clean(p.spans) as any, statusByWave: clean(p.statusByWave) as any, travelByWave: clean(p.travelByWave) as any });
    setOpenDot(null);
  };
  const assignToWave = (personId: string, waveId: string) => {
    const p = campaign.people.find((x) => x.id === personId);
    if (!p || p.waveIds.includes(waveId)) return;
    patchPerson(p.id, { waveIds: [...p.waveIds, waveId], statusByWave: { ...p.statusByWave, [waveId]: "proposed" } });
  };

  // Person bank (right column) — everyone on the series, named. Anonymous headcount lives in waves only.
  const bank = campaign.people.filter((p) => !isAnonymous(p));
  const addProfileToBank = (profileId: string) => { if (campaign.people.some((p) => p.profileId === profileId)) return; const pr = profiles.find((x) => x.id === profileId); if (!pr) return; save({ ...campaign, people: [...campaign.people, { id: newPersonId(), profileId, name: pr.name, email: pr.email ?? undefined, waveIds: [], travel: "flying", role: "eng", status: "proposed" }] }); };
  const addFreeTextToBank = () => { const n = bankName.trim(); if (!n) return; save({ ...campaign, people: [...campaign.people, { id: newPersonId(), name: n, waveIds: [], travel: "flying", role: "eng", status: "proposed" }] }); setBankName(""); };
  const removeFromSeries = (id: string) => save({ ...campaign, people: campaign.people.filter((p) => p.id !== id) });
  const addPlannedToWave = (waveId: string, role: CrewRole, count: number) => { save({ ...campaign, people: [...campaign.people, { id: newPersonId(), waveIds: [waveId], travel: "local", role, status: "proposed", statusByWave: { [waveId]: "proposed" }, plannedCount: count }] }); setOpenAdd(null); };

  const { traveling, local } = crewTravelCounts(campaign);
  const peak = campaignPeak(campaign, eventDates);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const onDragEnd = (e: DragEndEvent) => { if (e.over && typeof e.over.id === "string" && typeof e.active.id === "string") assignToWave(e.active.id, e.over.id); };

  if (campaign.waves.length === 0) return <p className="text-gray-400">Add waves on the Plan tab first, then staff them here.</p>;

  return (
    <div className="space-y-5">
      {/* Summary readouts (derived) */}
      <div className="flex flex-wrap gap-6 text-sm">
        <span><span className="font-medium">{peak}</span> <span className="text-gray-500">peak headcount</span></span>
        <span className="inline-flex items-center gap-1"><Plane className="w-4 h-4 text-gray-400" /> <span className="font-medium">{traveling}</span> <span className="text-gray-500">traveling</span></span>
        <span className="inline-flex items-center gap-1"><MapPin className="w-4 h-4 text-gray-400" /> <span className="font-medium">{local}</span> <span className="text-gray-500">local</span></span>
      </div>

      <DndContext sensors={sensors} collisionDetection={pointerWithin} onDragEnd={onDragEnd}>
        <div className="flex flex-col md:flex-row gap-6 items-start">
          {/* Waves */}
          <div className="flex-1 min-w-0 space-y-4">
            {campaign.waves.map((w, wi) => {
              const bounds = waveBounds(w, eventDates);
              const inWave = campaign.people.filter((p) => p.waveIds.includes(w.id));
              const wc = waveColor(wi);
              return (
                <WaveDrop key={w.id} waveId={w.id}>
                  <div className="flex items-baseline gap-2 mb-3">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${wc.dot}`} title={`${wc.name} wave`} />
                    <span className="text-[15px] font-medium">{w.name || "Untitled wave"}</span>
                    <span className="text-[12px] text-gray-400">{bounds.start ? `${fmtDay(bounds.start)}${bounds.end && bounds.end !== bounds.start ? ` – ${fmtDay(bounds.end)}` : ""}` : "no dates"}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {inWave.length === 0 && <span className="text-[13px] text-gray-400">Drop people here, or use +.</span>}
                    {inWave.map((p) => {
                      const role = crewRole(p), status = waveStatus(p, w.id), anon = isAnonymous(p), partial = isPartialInWave(p, w);
                      const key = `${p.id}|${w.id}`;
                      const label = anon ? String(bodyCount(p)) : (personLabel(p).trim()[0] || "?").toUpperCase();
                      return (
                        <button key={p.id} onClick={(e) => openDotAt(key, e.currentTarget)} title={anon ? `${bodyCount(p)} ${ROLE_LABEL[role]} planned` : `${personLabel(p)} · ${ROLE_LABEL[role]} · ${status}`}
                          className={`relative w-9 h-9 rounded-full flex items-center justify-center text-[13px] font-semibold transition-transform hover:scale-105 ${dotClass(role, status)}`}>
                          {label}
                          {partial && <span className="absolute -top-1 -right-1 bg-white rounded-full p-px shadow-sm"><Clock className="w-3 h-3 text-gray-500" /></span>}
                        </button>
                      );
                    })}
                    {/* Per-wave add (bank person not in wave, or planned headcount) */}
                    <button onClick={(e) => openAddAt(w.id, e.currentTarget)} className="w-9 h-9 rounded-full border-2 border-dashed border-gray-300 text-gray-400 hover:border-gray-400 hover:text-gray-600 flex items-center justify-center" aria-label="Add to wave"><Plus className="w-4 h-4" /></button>
                  </div>
                </WaveDrop>
              );
            })}
          </div>

          {/* Person bank — pinned to the right of the waves. */}
          <aside className="w-full md:w-72 shrink-0 rounded-xl border border-border p-4 md:sticky md:top-4">
            <p className="text-[13px] font-medium text-gray-700">Person bank</p>
            <p className="text-[12px] text-gray-400 mb-3">Everyone on the series. Drag onto a wave to assign.</p>
            <div className="space-y-1.5 mb-3">
              {bank.length === 0 && <p className="text-[13px] text-gray-400">No one added yet.</p>}
              {bank.map((p) => <BankPerson key={p.id} person={p} waveNames={campaign.waves.filter((w) => p.waveIds.includes(w.id)).map((w) => w.name || "wave")} onRemove={() => removeFromSeries(p.id)} />)}
            </div>
            <div className="flex gap-1.5">
              <input value={bankName} onChange={(e) => setBankName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addFreeTextToBank(); }} placeholder="Add by name…" className="flex-1 min-w-0 px-2 py-1 border border-gray-300 rounded text-[13px]" />
              <button onClick={addFreeTextToBank} disabled={!bankName.trim()} className="px-2 rounded bg-gray-900 text-white text-[13px] disabled:opacity-40">Add</button>
            </div>
            <div className="mt-2">
              <Select value="" onValueChange={(v) => { if (v) addProfileToBank(v as string); }} items={profiles.filter((pr) => !campaign.people.some((p) => p.profileId === pr.id)).map((pr) => ({ value: pr.id, label: pr.name }))}>
                <SelectTrigger className="w-full h-9 text-[13px]"><SelectValue placeholder="Add a teammate…" /></SelectTrigger>
                <SelectContent>
                  {profiles.filter((pr) => !campaign.people.some((p) => p.profileId === pr.id)).map((pr) => <SelectItem key={pr.id} value={pr.id}>{pr.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </aside>
        </div>
      </DndContext>

      {/* Popovers portal to the body, clamped to the viewport so the card is never cut off. */}
      {openDot && dotAnchor && (() => {
        const [pid, wid] = openDot.split("|");
        const p = campaign.people.find((x) => x.id === pid);
        const w = campaign.waves.find((x) => x.id === wid);
        if (!p || !w) return null;
        const bounds = waveBounds(w, eventDates);
        const days = eachDay(bounds.start, bounds.end);
        return (
          <AnchoredPopover anchor={dotAnchor} width={264} onClose={() => setOpenDot(null)}>
            <DotPopover person={p} wave={w} days={days} onClose={() => setOpenDot(null)}
              onRole={(r) => patchPerson(p.id, { role: r })}
              onStatus={(s) => setWaveMap(p, "statusByWave", w.id, s)}
              onTravel={(t) => setWaveMap(p, "travelByWave", w.id, t)}
              onSpan={(from, to) => { if (bounds.start && bounds.end && from === bounds.start && to === bounds.end) setWaveMap(p, "spans", w.id, undefined); else setWaveMap(p, "spans", w.id, { from, to }); }}
              onRemove={() => removeFromWave(p, w.id)} />
          </AnchoredPopover>
        );
      })()}
      {openAdd && addAnchor && (() => {
        const w = campaign.waves.find((x) => x.id === openAdd);
        if (!w) return null;
        return (
          <AnchoredPopover anchor={addAnchor} width={256} onClose={() => setOpenAdd(null)}>
            <AddMenu wave={w} candidates={bank.filter((p) => !p.waveIds.includes(w.id))}
              onPickPerson={(id) => { assignToWave(id, w.id); setOpenAdd(null); }}
              onPlanned={(role, count) => addPlannedToWave(w.id, role, count)} />
          </AnchoredPopover>
        );
      })()}
    </div>
  );
}

// Portals a popover to the body and clamps it to the viewport (flip above if no room below, shift in
// from the edges) so it always opens fully visible. Outside-click closes.
function AnchoredPopover({ anchor, width, onClose, children }: { anchor: DOMRect; width: number; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const m = 8;
    const h = ref.current?.offsetHeight ?? 0;
    let left = anchor.left + anchor.width / 2 - width / 2;
    left = Math.max(m, Math.min(left, window.innerWidth - width - m));
    let top = anchor.bottom + 6;
    if (top + h > window.innerHeight - m) top = Math.max(m, anchor.top - h - 6); // flip above
    setPos({ left, top });
  }, [anchor, width]);
  return createPortal(
    <>
      <div className="fixed inset-0 z-[80]" onClick={onClose} />
      <div ref={ref} style={{ position: "fixed", left: pos?.left ?? -9999, top: pos?.top ?? -9999, width }} className="z-[81]">
        {children}
      </div>
    </>,
    document.body,
  );
}

function WaveDrop({ waveId, children }: { waveId: string; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: waveId });
  return <section ref={setNodeRef} className={`rounded-xl border p-4 transition-colors ${isOver ? "border-gray-400 bg-gray-50 ring-2 ring-gray-300" : "border-border"}`}>{children}</section>;
}

function BankPerson({ person, waveNames, onRemove }: { person: CampaignPerson; waveNames: string[]; onRemove: () => void }) {
  const { setNodeRef, attributes, listeners, transform, isDragging } = useDraggable({ id: person.id });
  const style = transform ? { transform: `translate(${transform.x}px, ${transform.y}px)`, zIndex: 50, position: "relative" as const } : undefined;
  const role = crewRole(person);
  return (
    <div ref={setNodeRef} style={style} className={`group flex items-center gap-2 rounded-lg border border-border bg-white px-2 py-1.5 ${isDragging ? "shadow-lg opacity-90" : ""}`}>
      <button {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing text-gray-300 hover:text-gray-500 touch-none" aria-label="Drag to a wave"><GripVertical className="w-4 h-4" /></button>
      <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${HUE[role].solid.split(" ")[0]}`} />
      <span className="flex-1 min-w-0 text-[13px] truncate">{personLabel(person)}{waveNames.length > 0 && <span className="block text-[11px] text-gray-400 truncate">{waveNames.join(", ")}</span>}</span>
      <button onClick={onRemove} className="text-gray-300 hover:text-red-600 opacity-0 group-hover:opacity-100" aria-label="Remove from series"><X className="w-3.5 h-3.5" /></button>
    </div>
  );
}

// Per-dot detail: role, status, presence span (days within the wave), travel, remove-from-wave.
function DotPopover({ person, wave, days, onClose, onRole, onStatus, onTravel, onSpan, onRemove }: {
  person: CampaignPerson; wave: Wave; days: string[];
  onClose: () => void;
  onRole: (r: CrewRole) => void;
  onStatus: (s: "confirmed" | "proposed") => void;
  onTravel: (t: "flying" | "local") => void;
  onSpan: (from: string, to: string) => void;
  onRemove: () => void;
}) {
  const role = crewRole(person);
  const status = waveStatus(person, wave.id);
  const travel = waveTravel(person, wave.id);
  const span = person.spans?.[wave.id];
  const from = span?.from && days.includes(span.from) ? span.from : days[0];
  const to = span?.to && days.includes(span.to) ? span.to : days[days.length - 1];
  const selCls = "px-2 py-1 border border-gray-300 rounded-lg text-[12px] bg-white focus:outline-none focus:ring-2 focus:ring-gray-300";

  return (
      <div className="w-full bg-white border border-border rounded-xl shadow-lg p-3 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-[13px] font-medium truncate">{isAnonymous(person) ? `${bodyCount(person)} ${ROLE_LABEL[role]} planned` : personLabel(person)}</span>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X className="w-4 h-4" /></button>
        </div>

        {/* Role (person-level) */}
        <div className="flex flex-wrap gap-1.5">
          {CREW_ROLES.map((r) => (
            <button key={r} onClick={() => onRole(r)} className={`text-[12px] rounded-lg px-2 py-1 border ${role === r ? HUE[r].solid : "bg-white border-border text-gray-600 hover:bg-gray-50"}`}>{ROLE_LABEL[r]}</button>
          ))}
        </div>

        {/* Status */}
        <div className="flex gap-1.5">
          {(["confirmed", "proposed"] as const).map((s) => (
            <button key={s} onClick={() => onStatus(s)} className={`flex-1 text-[12px] rounded-lg border px-2 py-1 ${status === s ? "bg-gray-900 border-gray-900 text-white" : "bg-white border-border text-gray-600 hover:bg-gray-50"}`}>
              {status === s && <Check className="w-3 h-3 inline mr-0.5" />}{s === "confirmed" ? "Confirmed" : "Proposed"}
            </button>
          ))}
        </div>

        {/* Presence span within the wave */}
        <div>
          <p className="text-[12px] text-gray-500 mb-1">Here for</p>
          {days.length === 0 ? (
            <p className="text-[12px] text-gray-400">Set the wave's dates on the Plan tab first.</p>
          ) : (
            <div className="grid grid-cols-[2rem_1fr] items-center gap-x-2 gap-y-1.5">
              <span className="text-[12px] text-gray-400">From</span>
              <select value={from} onChange={(e) => onSpan(e.target.value, to < e.target.value ? e.target.value : to)} className={`${selCls} w-full`}>
                {days.map((d) => <option key={d} value={d}>{fmtDay(d)}</option>)}
              </select>
              <span className="text-[12px] text-gray-400">To</span>
              <select value={to} onChange={(e) => onSpan(from, e.target.value)} className={`${selCls} w-full`}>
                {days.filter((d) => d >= from).map((d) => <option key={d} value={d}>{fmtDay(d)}</option>)}
              </select>
            </div>
          )}
        </div>

        {/* Travel (per wave) */}
        <div>
          <p className="text-[12px] text-gray-500 mb-1">Travel</p>
          <div className="flex gap-1.5">
            <button onClick={() => onTravel("flying")} className={`flex-1 inline-flex items-center justify-center gap-1 text-[12px] rounded-lg border px-2 py-1 ${travel === "flying" ? "bg-blue-50 border-blue-300 text-blue-700" : "bg-white border-border text-gray-600 hover:bg-gray-50"}`}><Plane className="w-3.5 h-3.5" /> Flying</button>
            <button onClick={() => onTravel("local")} className={`flex-1 inline-flex items-center justify-center gap-1 text-[12px] rounded-lg border px-2 py-1 ${travel === "local" ? "bg-gray-100 border-gray-300 text-gray-700" : "bg-white border-border text-gray-600 hover:bg-gray-50"}`}><MapPin className="w-3.5 h-3.5" /> Local</button>
          </div>
        </div>

        <button onClick={onRemove} className="w-full text-[12px] text-red-600 hover:text-red-700 text-left inline-flex items-center gap-1"><X className="w-3.5 h-3.5" /> Remove from this wave</button>
      </div>
  );
}

// Per-wave add menu: an existing bank person (not yet in this wave) or anonymous planned headcount.
function AddMenu({ wave, candidates, onPickPerson, onPlanned }: {
  wave: Wave;
  candidates: CampaignPerson[];
  onPickPerson: (id: string) => void;
  onPlanned: (role: CrewRole, count: number) => void;
}) {
  const [role, setRole] = useState<CrewRole>("none");
  const [count, setCount] = useState(3);
  return (
      <div className="w-full bg-white border border-border rounded-xl shadow-lg p-3">
        <p className="text-[12px]"><span className="font-medium text-gray-700">Add to {wave.name || "wave"}:</span> <span className="text-gray-500">Planned headcount</span></p>
        <div className="border-t border-gray-100 my-2" />
        {candidates.length > 0 && (
          <div className="max-h-32 overflow-y-auto -mx-1 mb-2">
            {candidates.map((p) => (
              <button key={p.id} onClick={() => onPickPerson(p.id)} className="w-full text-left px-2 py-1 rounded text-[13px] hover:bg-gray-50">{personLabel(p)}</button>
            ))}
          </div>
        )}
        <div className="flex flex-wrap gap-1 mb-2">
          {CREW_ROLES.map((r) => (
            <button key={r} onClick={() => setRole(r)} className={`text-[12px] rounded-md px-2 py-1 border ${role === r ? HUE[r].solid : "bg-white border-border text-gray-600"}`}>{ROLE_LABEL[r]}</button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <NumberField value={count} min={1} onChange={setCount} ariaLabel="Planned count" className="w-14 px-1.5 py-1 border border-gray-300 rounded text-[13px]" />
          <button onClick={() => onPlanned(role, count)} className="text-[13px] text-gray-600 font-medium hover:font-bold hover:text-gray-900">Add planned</button>
        </div>
      </div>
  );
}
