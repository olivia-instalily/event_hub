import { useState } from "react";
import type { SeriesEvent } from "../lib/db";
import {
  wavePresence, daySlice, waveDurationDays, waveBounds, STACK_KEYS, waveColor, type Campaign, type StackKey,
} from "../lib/campaign";

// Colored segments: hue = role (eng sky / biz violet), shade = status (confirmed deep / proposed pale).
// Solid swatch (tooltip / legend dots) — needs to be visible at small sizes.
const SEG: Record<StackKey, string> = {
  "eng-confirmed": "bg-sky-400",
  "biz-confirmed": "bg-violet-400",
  "leadership-confirmed": "bg-amber-400",
  "none-confirmed": "bg-gray-300",
  "eng-proposed": "bg-sky-200",
  "biz-proposed": "bg-violet-200",
  "leadership-proposed": "bg-amber-200",
  "none-proposed": "bg-gray-200",
};
// Stacked blocks — transparent, very light tints (confirmed a touch stronger than proposed).
const SEG_BLOCK: Record<StackKey, string> = {
  "eng-confirmed": "bg-sky-400/30",
  "biz-confirmed": "bg-violet-400/30",
  "leadership-confirmed": "bg-amber-400/30",
  "none-confirmed": "bg-gray-400/30",
  "eng-proposed": "bg-sky-400/15",
  "biz-proposed": "bg-violet-400/15",
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
export function WavePresence({ campaign, events }: { campaign: Campaign; events: SeriesEvent[] }) {
  const [hover, setHover] = useState<{ waveId: string; day: string } | null>(null);
  const [eventHover, setEventHover] = useState<string | null>(null); // event id

  const eventDates: Record<string, string | null> = {};
  const eventById: Record<string, SeriesEvent> = {};
  for (const e of events) { eventDates[e.id] = e.date; eventById[e.id] = e; }

  const waves = campaign.waves;
  if (waves.length === 0) return <p className="text-gray-400">No waves yet — add them below.</p>;

  // Resolve each wave's effective bounds (own dates, else its events' span) up front.
  const resolved = waves.map((w) => { const b = waveBounds(w, eventDates); return { ...w, start: b.start, end: b.end }; });
  const maxDur = Math.max(1, ...resolved.map(waveDurationDays));
  // Common y-scale across waves so a short-tall spike reads bigger than a long-wide low band (honest).
  const globalPeak = Math.max(1, ...resolved.map((w) => wavePresence(w, campaign.people).peak));
  const stackH = globalPeak * PX_PER_PERSON;

  return (
    <div>
      <Legend />
      <div className="space-y-8">
        {resolved.map((w, wi) => {
          const dur = waveDurationDays(w);
          const widthPct = dur > 0 ? Math.max(22, (dur / maxDur) * 100) : 42; // undated → a modest bare band
          const { days, columns, peak } = wavePresence(w, campaign.people);
          const waveEvents = w.eventIds.map((id) => eventById[id]).filter((e): e is SeriesEvent => !!e && !!e.date && days.includes(e.date!));
          const wc = waveColor(wi);
          return (
            <div key={w.id}>
              <div className="flex items-baseline gap-2 mb-1">
                <span className={`w-2 h-2 rounded-full shrink-0 ${wc.dot}`} title={`${wc.name} wave`} />
                <span className="text-sm font-medium text-gray-800">{w.name || "Untitled wave"}</span>
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
                        className={`relative flex-1 h-full flex flex-col-reverse justify-start cursor-default ${isHover ? "z-10" : ""}`}
                        onMouseEnter={() => setHover({ waveId: w.id, day: days[i] })}
                        onMouseLeave={() => setHover(null)}
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
                    const colW = 100 / days.length;
                    return (
                      <div className="absolute z-30 min-w-[160px] rounded-xl border border-border bg-white shadow-xl p-2.5 animate-in fade-in zoom-in-95 slide-in-from-bottom-2 duration-200 origin-bottom" style={{ left: `${i * colW}%`, width: `${colW}%`, bottom: `${total * PX_PER_PERSON}px` }}>
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
                          return (
                            <span key={date} className="absolute top-0 -translate-x-1/2 z-20" style={{ left: `${centerPct}%` }}
                              onMouseEnter={() => setEventHover(key)} onMouseLeave={() => setEventHover(null)}>
                              <span className={`block w-3 h-3 rounded-full border-[3px] border-white ring-2 -translate-y-1/2 ${wc.dot} ${wc.ring}`} />
                              <span className="absolute top-1.5 left-1/2 -translate-x-1/2 w-24 text-center pointer-events-none">
                                {evs.length === 1 ? (
                                  <span className="block text-[10px] leading-tight text-gray-600 truncate">{evs[0].name}</span>
                                ) : (
                                  <ul className="inline-block text-left text-[10px] leading-tight text-gray-600">
                                    {evs.map((e) => <li key={e.id} className="list-disc ml-3 truncate">{e.name}</li>)}
                                  </ul>
                                )}
                                <span className="block text-[9px] text-gray-400">{fmtDay(date)}</span>
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
    </div>
  );
}

function Legend() {
  const items: { key: StackKey; label: string }[] = [
    { key: "eng-confirmed", label: "Eng" },
    { key: "biz-confirmed", label: "Biz" },
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
    </div>
  );
}
