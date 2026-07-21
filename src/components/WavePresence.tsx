import { useState } from "react";
import { X, Plane, StickyNote } from "lucide-react";
import type { SeriesEvent } from "../lib/db";
import {
  wavePresence, daySlice, waveDurationDays, waveBounds, STACK_KEYS, waveColor, logisticsForDay, personLabel, waveTravel,
  type Campaign, type StackKey, type DayLogistic, type CampaignPerson,
} from "../lib/campaign";

const logId = () => "log-" + (globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2));

// Colored segments: hue = role (eng sky / biz violet), shade = status (confirmed deep / proposed pale).
// Solid swatch (tooltip / legend dots) — needs to be visible at small sizes.
const SEG: Record<StackKey, string> = {
  "eng-confirmed": "bg-sky-400",
  "growth-confirmed": "bg-violet-400",
  "marketing-confirmed": "bg-rose-400",
  "leadership-confirmed": "bg-amber-400",
  "none-confirmed": "bg-gray-300",
  "eng-proposed": "bg-sky-200",
  "growth-proposed": "bg-violet-200",
  "marketing-proposed": "bg-rose-200",
  "leadership-proposed": "bg-amber-200",
  "none-proposed": "bg-gray-200",
};
// Stacked blocks — transparent, very light tints (confirmed a touch stronger than proposed).
const SEG_BLOCK: Record<StackKey, string> = {
  "eng-confirmed": "bg-sky-400/30",
  "growth-confirmed": "bg-violet-400/30",
  "marketing-confirmed": "bg-rose-400/30",
  "leadership-confirmed": "bg-amber-400/30",
  "none-confirmed": "bg-gray-400/30",
  "eng-proposed": "bg-sky-400/15",
  "growth-proposed": "bg-violet-400/15",
  "marketing-proposed": "bg-rose-400/15",
  "leadership-proposed": "bg-amber-400/15",
  "none-proposed": "bg-gray-400/15",
};
const PX_PER_PERSON = 22; // stack height per body
const fmtDay = (d: string) => new Date(d + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" });

// A day on the graphic runs 7am → 11pm; map an event's start/end onto that window as horizontal
// fractions (0 = 7am at the left of the day slot, 1 = 11pm at the right) so on hover the dot expands
// into the segment of the day's line where the event actually happens.
const DAY_START = 7 * 60, DAY_END = 23 * 60;
const parseMin = (t: string | null): number | null => { const m = /^(\d{1,2}):(\d{2})/.exec(t ?? ""); return m ? +m[1] * 60 + +m[2] : null; };
const fmtTime = (min: number) => { const h = Math.floor(min / 60), m = min % 60; const ap = h >= 12 ? "PM" : "AM"; const h12 = h % 12 || 12; return m ? `${h12}:${String(m).padStart(2, "0")} ${ap}` : `${h12} ${ap}`; };
// A saved "HH:MM" time → friendly 12-hour clock (e.g. "6:00 PM"); "" if unset/unparseable.
const fmtClock = (t?: string | null) => { const m = parseMin(t ?? null); return m == null ? "" : fmtTime(m); };
function timeFrame(start: string | null, end: string | null): { startFrac: number; endFrac: number; label: string } {
  const s = parseMin(start);
  if (s == null) return { startFrac: 0.08, endFrac: 0.92, label: "time TBD" }; // no time set → span the day
  const e = parseMin(end) ?? s + 60;
  const span = DAY_END - DAY_START;
  const frac = (m: number) => Math.min(1, Math.max(0, (m - DAY_START) / span));
  const sf = frac(s);
  return { startFrac: sf, endFrac: Math.max(sf + 0.05, frac(e)), label: `${fmtTime(s)}–${fmtTime(e)}` };
}

// Wave presence: waves stacked vertically, band width ∝ duration, a stepped role+status headcount
// profile above each band, event dots on it. Reads the campaign's waves + people (+ role/status/span).
export function WavePresence({ campaign, events, save }: { campaign: Campaign; events: SeriesEvent[]; save?: (c: Campaign) => void }) {
  const [hover, setHover] = useState<{ waveId: string; day: string } | null>(null);
  const [eventHover, setEventHover] = useState<string | null>(null); // event id
  const [logDay, setLogDay] = useState<string | null>(null); // day whose logistics modal is open
  const [logHover, setLogHover] = useState<string | null>(null); // day whose logistics marker is hovered

  const eventDates: Record<string, string | null> = {};
  const eventById: Record<string, SeriesEvent> = {};
  for (const e of events) { eventDates[e.id] = e.date; eventById[e.id] = e; }

  // Who a logistics leg involves: named people if given, else an anonymous head-count ("5 people").
  const logWho = (l: DayLogistic): string => {
    if (l.peopleIds && l.peopleIds.length) return l.peopleIds.map((id) => { const p = campaign.people.find((x) => x.id === id); return p ? personLabel(p) : null; }).filter(Boolean).join(", ");
    if (l.count && l.count > 0) return `${l.count} ${l.count === 1 ? "person" : "people"}`;
    return "";
  };

  const waves = campaign.waves;
  if (waves.length === 0) return <p className="text-gray-400">No waves yet — add them below.</p>;

  // Resolve each wave's effective bounds (own dates, else its events' span) up front.
  const resolved = waves.map((w) => { const b = waveBounds(w, eventDates); return { ...w, start: b.start, end: b.end }; });
  const maxDur = Math.max(1, ...resolved.map(waveDurationDays));

  return (
    <div>
      <Legend />
      <div className="space-y-8">
        {resolved.map((w, wi) => {
          const dur = waveDurationDays(w);
          const widthPct = dur > 0 ? Math.max(22, (dur / maxDur) * 100) : 42; // undated → a modest bare band
          const { days, columns, peak } = wavePresence(w, campaign.people);
          // Height = this wave's OWN peak (constant px per person, so bars stay comparable across waves)
          // — sizing to the global max would leave big empty space above low-headcount waves.
          const stackH = Math.max(peak, 1) * PX_PER_PERSON;
          const waveEvents = w.eventIds.map((id) => eventById[id]).filter((e): e is SeriesEvent => !!e && !!e.date && days.includes(e.date!));
          const wc = waveColor(wi);
          return (
            <div key={w.id}>
              <div className="flex items-baseline gap-2 mb-1">
                <span className={`w-2 h-2 rounded-full shrink-0 ${wc.dot}`} title={`${wc.name} wave`} />
                <span className="text-sm font-medium text-gray-800">{w.name || "Untitled wave"}</span>
                {w.start && <span className="text-[13px] font-medium text-gray-500">{w.end && w.end !== w.start ? `${fmtDay(w.start)} – ${fmtDay(w.end)}` : fmtDay(w.start)}</span>}
                <span className="text-[12px] text-gray-400">{dur > 0 ? `${dur} day${dur === 1 ? "" : "s"}` : "no dates"}{peak > 0 ? ` · peak ${peak}` : ""}</span>
              </div>
              <div style={{ width: `${widthPct}%` }} className="min-w-[220px]">
                {/* Stepped presence profile */}
                <div className="relative flex items-end" style={{ height: stackH }}>
                  {days.length === 0 && <div className="text-[12px] text-gray-300 pb-1">—</div>}
                  {columns.map((col, i) => {
                    const total = STACK_KEYS.reduce((s, k) => s + col[k], 0);
                    const isHover = hover?.waveId === w.id && hover?.day === days[i];
                    return (
                      <div
                        key={i}
                        className={`relative flex-1 h-full flex flex-col-reverse justify-start ${save ? "cursor-pointer" : "cursor-default"} ${isHover ? "z-10" : ""}`}
                        onMouseEnter={() => setHover({ waveId: w.id, day: days[i] })}
                        onMouseLeave={() => setHover(null)}
                        onClick={() => save && setLogDay(days[i])}
                        title={save ? "Add logistics for this day" : undefined}
                      >
                        {/* Hovered day darkens to the solid color (same size); otherwise a light transparent tint. */}
                        {STACK_KEYS.map((k) => col[k] > 0 && (
                          <div key={k} className="relative" style={{ height: col[k] * PX_PER_PERSON }}>
                            <div className={`absolute inset-0 transition-colors ${isHover ? SEG[k] : SEG_BLOCK[k]}`} />
                            {/* small tick separating this attendance category from the one above */}
                            <span className="absolute top-0 left-1/2 -translate-x-1/2 w-2 h-0.5 bg-white z-10" />
                          </div>
                        ))}
                        {/* white line down the middle marks each day (no gaps between columns) */}
                        {total > 0 && <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-0.5 bg-white/80" />}
                      </div>
                    );
                  })}
                  {/* Day card — grows upward out of the TOP of that day's own stack (same width as the
                      day column), showing the date, who's on the ground, and any planned headcount. */}
                  {hover?.waveId === w.id && (() => {
                    const i = days.indexOf(hover.day);
                    if (i < 0) return null;
                    const people = daySlice(w, campaign.people, hover.day);
                    const total = people.reduce((s, p) => s + p.count, 0);
                    const logs = logisticsForDay(campaign, hover.day);
                    const colW = 100 / days.length;
                    return (
                      <div className="absolute z-30 w-max min-w-[160px] max-w-[360px] rounded-xl border border-border bg-white shadow-xl p-2.5 animate-in fade-in zoom-in-95 slide-in-from-bottom-2 duration-200 origin-bottom" style={{ left: `${i * colW}%`, bottom: `${total * PX_PER_PERSON}px` }}>
                        <div className="flex gap-3">
                          {/* Planned / who's on the ground */}
                          <div className="min-w-[140px]">
                            <p className="text-[12px] font-medium text-gray-800 mb-1.5">{fmtDay(hover.day)} · {total} on the ground</p>
                            {people.length === 0 ? (
                              <p className="text-[12px] text-gray-400">No one assigned this day.</p>
                            ) : (
                              <ul className="space-y-1">
                                {people.map((p, j) => (
                                  <li key={j} className={`flex items-center gap-1.5 text-[12px] ${p.status === "proposed" ? "text-gray-400" : "text-gray-800"}`}>
                                    <span className={`w-2.5 h-2.5 rounded-sm shrink-0 ${SEG[p.key]}`} />
                                    {p.label}
                                    {p.anon && <span className="text-[10px] text-gray-400">· planned</span>}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                          {/* Logistics / notes for the day — to the right of the planned column */}
                          {logs.length > 0 && (
                            <div className="min-w-[120px] border-l border-gray-100 pl-3">
                              <p className="text-[11px] font-medium text-gray-500 mb-1.5">Logistics</p>
                              <ul className="space-y-1">
                                {logs.map((l) => (
                                  <li key={l.id} className="flex items-start gap-1.5 text-[12px] text-gray-700">
                                    {l.kind === "travel" ? <Plane className="w-3 h-3 text-gray-400 mt-0.5 shrink-0" /> : <StickyNote className="w-3 h-3 text-gray-400 mt-0.5 shrink-0" />}
                                    <span>{l.time && <span className="text-gray-500">{fmtClock(l.time)} · </span>}{l.text}{logWho(l) && <span className="block text-[11px] text-gray-400">{logWho(l)}</span>}</span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })()}
                </div>
                {/* Band (duration) — a light, thin line flush under the blocks (no gap); event dots in the
                    wave-dot color with a lighter halo straddle the top edge, coming up over the blocks. */}
                <div className="relative h-10">
                  <div className={`absolute left-0 right-0 top-0 h-px rounded-full ${wc.soft}`} />
                  {/* Start / end dates — bigger, on the band's ends, in line with the event titles. */}
                  {w.start && <span className="absolute top-1.5 left-0 text-[13px] font-medium text-gray-600">{fmtDay(w.start)}</span>}
                  {w.end && w.end !== w.start && <span className="absolute top-1.5 right-0 text-[13px] font-medium text-gray-600">{fmtDay(w.end)}</span>}
                  {/* Travel markers — a small triangle (outlined in the wave color) ABOVE the line for any
                      day with a note/travel leg. A default triangle sits at the wave's start AND end
                      (travel in / out) unless everyone on the wave is local. Hover for details. */}
                  {(() => {
                    const hasFlyers = campaign.people.some((p) => p.waveIds.includes(w.id) && waveTravel(p, w.id) === "flying");
                    const nDays = days.length;
                    // Fraction (0..1) of a leg's time across the 7am→11pm day window; no time → middle.
                    const dayFrac = (t: string | null | undefined) => {
                      const m = parseMin(t ?? null);
                      if (m == null) return 0.5;
                      return Math.min(1, Math.max(0, (m - DAY_START) / (DAY_END - DAY_START)));
                    };
                    const leftFor = (i: number, f: number) => (nDays > 1 ? ((i + f) / nDays) * 100 : f * 100);
                    // One triangle per leg, positioned at its time so it lands roughly where it happens in
                    // the day (before/after any event on the same day). Boundary "travel in/out" defaults
                    // only show on a first/last day with no explicit leg.
                    type Marker = { key: string; leftPct: number; log?: DayLogistic; boundary?: "in" | "out" };
                    const markers: Marker[] = [];
                    days.forEach((d, i) => {
                      const logs = logisticsForDay(campaign, d);
                      for (const l of logs) markers.push({ key: l.id, leftPct: leftFor(i, dayFrac(l.time)), log: l });
                      if (hasFlyers && !logs.length && (i === 0 || i === nDays - 1)) {
                        markers.push({ key: `boundary-${d}`, leftPct: leftFor(i, 0.5), boundary: i === 0 ? "in" : "out" });
                      }
                    });
                    return markers.map((mk) => (
                      <span key={`log-${mk.key}`} className="absolute top-0 -translate-x-1/2 -translate-y-full z-20" style={{ left: `${mk.leftPct}%` }}
                        onMouseEnter={() => setLogHover(mk.key)} onMouseLeave={() => setLogHover(null)}>
                        {/* Triangle (two sides in the light wave color, white fill, open bottom) + a white
                            segment over the line beneath it, so the line looks like it spikes up. */}
                        <svg width="12" height="9" viewBox="0 0 12 9" className={`block ${wc.textSoft}`}>
                          <path d="M1 9 L6 1 L11 9" fill="white" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                        </svg>
                        {/* White break over the flat wave line BETWEEN the triangle's base corners, so the
                            line reads as going up into the triangle (narrow, so the green sides still meet the line). */}
                        <span className="absolute left-1/2 top-full -translate-x-1/2 -translate-y-1/2 w-2 h-[3px] bg-white z-30" />
                        {logHover === mk.key && (
                          <span className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 z-40 w-max max-w-[220px] rounded-lg border border-border bg-white shadow-lg p-2 text-left">
                            {mk.log ? (
                              <span className="flex items-start gap-1.5 text-[12px] text-gray-800">
                                {mk.log.kind === "travel" ? <Plane className="w-3 h-3 text-gray-400 mt-0.5 shrink-0" /> : <StickyNote className="w-3 h-3 text-gray-400 mt-0.5 shrink-0" />}
                                <span>{mk.log.time && <span className="text-gray-500">{fmtClock(mk.log.time)} · </span>}{mk.log.text}{logWho(mk.log) && <span className="block text-[11px] text-gray-400">{logWho(mk.log)}</span>}</span>
                              </span>
                            ) : (
                              <span className="flex items-center gap-1.5 text-[12px] text-gray-600"><Plane className="w-3 h-3 text-gray-400" /> {mk.boundary === "in" ? "Travel in" : "Travel out"} · click the day to add details</span>
                            )}
                          </span>
                        )}
                      </span>
                    ));
                  })()}
                  {(() => {
                    const colW = 100 / days.length;
                    // Group events by day — a day can hold several.
                    const byDay = new Map<string, SeriesEvent[]>();
                    for (const e of waveEvents) { const a = byDay.get(e.date!) ?? []; a.push(e); byDay.set(e.date!, a); }
                    return (
                      <>
                        {/* Time-range highlights — shown ONLY when the day's BLOCK is hovered (one per event). */}
                        {hover?.waveId === w.id && (byDay.get(hover.day) ?? []).map((e) => {
                          const i = days.indexOf(e.date!);
                          const tf = timeFrame(e.startTime, e.endTime);
                          return (
                            <span key={`tl-${e.id}`} className="absolute top-0 -translate-y-1/2 pointer-events-none z-30 transition-all duration-150"
                              style={{ left: `${(i + tf.startFrac) * colW + (tf.endFrac - tf.startFrac) * colW * 0.1}%`, width: `${(tf.endFrac - tf.startFrac) * colW * 0.8}%` }}>
                              <span className={`relative block h-2 ${wc.soft}`}><span className={`absolute inset-x-0 top-1/2 -translate-y-1/2 h-px ${wc.strong}`} /></span>
                              <span className={`absolute -top-5 left-1/2 -translate-x-1/2 rounded px-1 py-px text-[10px] font-semibold whitespace-nowrap ${wc.text} ${wc.bg}`}>{tf.label}</span>
                            </span>
                          );
                        })}
                        {/* One dot per day; its label lists the day's event(s); hovering the dot pops the list. */}
                        {[...byDay.entries()].map(([date, evs]) => {
                          const i = days.indexOf(date);
                          const centerPct = days.length > 1 ? (i + 0.5) / days.length * 100 : 50;
                          const key = `${w.id}|${date}`;
                          const dh = eventHover === key;
                          // When this day's stack block is hovered, the circle gives way to the time-range
                          // highlight that emerges on the line — so it fades out (and stops catching hover).
                          const blockHover = hover?.waveId === w.id && hover?.day === date;
                          return (
                            <span key={date} className="absolute top-0 -translate-x-1/2 z-20" style={{ left: `${centerPct}%` }}
                              onMouseEnter={() => setEventHover(key)} onMouseLeave={() => setEventHover(null)}>
                              <span className={`block w-3 h-3 rounded-full border-[3px] border-white ring-2 -translate-y-1/2 transition-opacity duration-150 ${wc.dot} ${wc.ring} ${blockHover ? "opacity-0" : "opacity-100"}`} />
                              <span className="absolute top-3 left-1/2 -translate-x-1/2 w-24 text-left pointer-events-none">
                                {evs.map((e) => (
                                  <span key={e.id} className="flex items-center gap-1 text-[10px] leading-tight text-gray-600">
                                    <span className="w-1 h-1 rounded-full bg-gray-400 shrink-0" />
                                    <span className="truncate">{e.name}</span>
                                  </span>
                                ))}
                                <span className="block text-[9px] text-gray-400 mt-0.5">{fmtDay(date)}</span>
                              </span>
                              {/* Dot-hover popup: the day's events as a list. */}
                              {dh && (
                                <span className="absolute top-full mt-1 left-1/2 -translate-x-1/2 z-40 w-max max-w-[240px] rounded-lg border border-border bg-white shadow-lg p-2 text-left">
                                  <span className="block text-[11px] font-medium text-gray-700 mb-1">{fmtDay(date)} · {evs.length} event{evs.length === 1 ? "" : "s"}</span>
                                  <ul className="space-y-1.5">
                                    {evs.map((e) => {
                                      const tf = timeFrame(e.startTime, e.endTime);
                                      return (
                                        <li key={e.id} className="text-[12px] text-gray-800">
                                          <span className="flex items-center gap-1.5"><span className={`w-1.5 h-1.5 rounded-full shrink-0 ${wc.dot}`} />{e.name}</span>
                                          <span className="block ml-3 text-[10px] text-gray-400">{tf.label}{e.location ? ` · ${e.location}` : ""}</span>
                                        </li>
                                      );
                                    })}
                                  </ul>
                                </span>
                              )}
                            </span>
                          );
                        })}
                      </>
                    );
                  })()}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {logDay && save && (
        <LogisticsModal
          date={logDay}
          people={campaign.people}
          existing={logisticsForDay(campaign, logDay)}
          onClose={() => setLogDay(null)}
          onAdd={(item) => save({ ...campaign, logistics: [...campaign.logistics, item] })}
          onRemove={(id) => save({ ...campaign, logistics: campaign.logistics.filter((l) => l.id !== id) })}
        />
      )}
    </div>
  );
}

// Modal to add a piece of logistics to a day: a travel note (text + time + people) or a general note.
function LogisticsModal({ date, people, existing, onClose, onAdd, onRemove }: {
  date: string; people: CampaignPerson[]; existing: DayLogistic[];
  onClose: () => void; onAdd: (l: DayLogistic) => void; onRemove: (id: string) => void;
}) {
  const [kind, setKind] = useState<"travel" | "note">("travel");
  const [text, setText] = useState("");
  const [time, setTime] = useState("");
  const [peopleIds, setPeopleIds] = useState<string[]>([]);
  const [count, setCount] = useState<number | "">(""); // anonymous head-count when not naming people
  const named = people.filter((p) => (p.name && p.name.trim()) || p.profileId);
  const fmtDate = new Date(date + "T12:00:00").toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
  const field = "w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-300";
  // Who a saved leg involves — names if picked, else the anonymous count.
  const who = (l: DayLogistic): string => {
    if (l.peopleIds && l.peopleIds.length) return l.peopleIds.map((id) => { const p = people.find((x) => x.id === id); return p ? personLabel(p) : null; }).filter(Boolean).join(", ");
    if (l.count && l.count > 0) return `${l.count} ${l.count === 1 ? "person" : "people"}`;
    return "";
  };
  const add = () => {
    if (!text.trim()) return;
    const travel = kind === "travel";
    onAdd({ id: logId(), date, kind, text: text.trim(), time: travel ? (time || null) : null, peopleIds: travel && peopleIds.length ? peopleIds : undefined, count: travel && !peopleIds.length && typeof count === "number" && count > 0 ? count : undefined });
    setText(""); setTime(""); setPeopleIds([]); setCount("");
  };
  const toggle = (id: string) => setPeopleIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-border bg-white shadow-xl p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-[15px] font-medium">Logistics · {fmtDate}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X className="w-4 h-4" /></button>
        </div>

        {existing.length > 0 && (
          <ul className="mb-3 space-y-1">
            {existing.map((l) => (
              <li key={l.id} className="flex items-start gap-2 rounded-lg border border-border px-2.5 py-1.5 text-[13px]">
                {l.kind === "travel" ? <Plane className="w-3.5 h-3.5 text-gray-400 mt-0.5 shrink-0" /> : <StickyNote className="w-3.5 h-3.5 text-gray-400 mt-0.5 shrink-0" />}
                <span className="flex-1 min-w-0">{l.time && <span className="text-gray-500">{fmtClock(l.time)} · </span>}{l.text}
                  {who(l) && <span className="block text-[11px] text-gray-400">{who(l)}</span>}
                </span>
                <button onClick={() => onRemove(l.id)} className="text-gray-300 hover:text-red-600 shrink-0"><X className="w-3.5 h-3.5" /></button>
              </li>
            ))}
          </ul>
        )}

        <div className="flex gap-1.5 mb-3">
          {(["travel", "note"] as const).map((k) => (
            <button key={k} onClick={() => setKind(k)} className={`flex-1 inline-flex items-center justify-center gap-1 text-[13px] rounded-lg border px-2 py-1.5 ${kind === k ? "bg-gray-900 border-gray-900 text-white" : "bg-white border-border text-gray-600 hover:bg-gray-50"}`}>
              {k === "travel" ? <><Plane className="w-3.5 h-3.5" /> Travel note</> : <><StickyNote className="w-3.5 h-3.5" /> General note</>}
            </button>
          ))}
        </div>

        <div className="space-y-2">
          <input autoFocus value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && kind === "note") add(); }} placeholder={kind === "travel" ? "e.g. Drive to Waterloo" : "Note for this day"} className={field} />
          {kind === "travel" && (
            <>
              <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className={field} />
              {/* Head-count — the quick path: log "N people" without naming anyone. Disabled once
                  specific people are picked below (then the names carry the count). */}
              <div className="flex items-center gap-2">
                <input type="number" min={1} value={count} disabled={peopleIds.length > 0}
                  onChange={(e) => setCount(e.target.value === "" ? "" : Math.max(1, Math.floor(Number(e.target.value))))}
                  placeholder="# people" className="w-24 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-300 disabled:bg-gray-50 disabled:text-gray-400" />
                <span className="text-[12px] text-gray-400">people traveling{named.length > 0 ? " — or name them below" : ""}</span>
              </div>
              {named.length > 0 && (
                <div>
                  <p className="text-[12px] text-gray-500 mb-1">Or pick specific people</p>
                  <div className="flex flex-wrap gap-1.5">
                    {named.map((p) => (
                      <button key={p.id} onClick={() => toggle(p.id)} className={`text-[12px] rounded-full border px-2.5 py-1 ${peopleIds.includes(p.id) ? "bg-gray-900 border-gray-900 text-white" : "bg-white border-border text-gray-600 hover:bg-gray-50"}`}>{personLabel(p)}</button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900">Done</button>
          <button onClick={add} disabled={!text.trim()} className="px-4 py-1.5 rounded-lg bg-gray-900 text-white text-sm hover:bg-black disabled:opacity-50">Add</button>
        </div>
      </div>
    </div>
  );
}

function Legend() {
  const items: { key: StackKey; label: string }[] = [
    { key: "eng-confirmed", label: "Eng" },
    { key: "growth-confirmed", label: "Growth" },
    { key: "marketing-confirmed", label: "Marketing" },
    { key: "leadership-confirmed", label: "Leadership" },
    { key: "none-confirmed", label: "Unspecified" },
  ];
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mb-4">
      {items.map((it) => (
        <span key={it.key} className="inline-flex items-center gap-1.5 text-[12px] text-gray-600">
          <span className={`w-3 h-3 rounded-sm ${SEG[it.key]}`} /> {it.label}
        </span>
      ))}
      {/* Event tag is grey here because on the graphic each event takes its own wave's color. */}
      <span className="inline-flex items-center gap-1.5 text-[12px] text-gray-500"><span className="w-3.5 h-3.5 rounded-full bg-gray-400 border-[3px] border-white ring-2 ring-gray-300" /> event</span>
      {/* Two-sided open triangle (point) = a travel leg / logistics marker on the wave line. */}
      <span className="inline-flex items-center gap-1.5 text-[12px] text-gray-500">
        <svg width="12" height="9" viewBox="0 0 12 9" className="text-gray-400"><path d="M1 9 L6 1 L11 9" fill="white" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /></svg>
        travel/logistics
      </span>
    </div>
  );
}
