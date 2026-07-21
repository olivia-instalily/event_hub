import { useState } from "react";
import type { SeriesEvent } from "../lib/db";
import {
  wavePresence, daySlice, waveDurationDays, waveBounds, STACK_KEYS, waveColor, type Campaign, type StackKey,
} from "../lib/campaign";

// Colored segments: hue = role (eng sky / biz violet), shade = status (confirmed deep / proposed pale).
const SEG: Record<StackKey, string> = {
  "eng-confirmed": "bg-sky-500",
  "biz-confirmed": "bg-violet-500",
  "leadership-confirmed": "bg-amber-500",
  "none-confirmed": "bg-gray-400",
  "eng-proposed": "bg-sky-300",
  "biz-proposed": "bg-violet-300",
  "leadership-proposed": "bg-amber-200",
  "none-proposed": "bg-gray-200",
};
const PX_PER_PERSON = 22; // stack height per body
const fmtDay = (d: string) => new Date(d + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" });

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
                <div className="relative flex items-end gap-px border-b-2 border-gray-300" style={{ height: stackH }}>
                  {days.length === 0 && <div className="text-[12px] text-gray-300 pb-1">—</div>}
                  {columns.map((col, i) => {
                    const total = STACK_KEYS.reduce((s, k) => s + col[k], 0);
                    const isHover = hover?.waveId === w.id && hover?.day === days[i];
                    return (
                      <div
                        key={i}
                        className="flex-1 flex flex-col-reverse cursor-default rounded-t-sm overflow-hidden"
                        onMouseEnter={() => total > 0 && setHover({ waveId: w.id, day: days[i] })}
                        onMouseLeave={() => setHover(null)}
                      >
                        {STACK_KEYS.map((k) => col[k] > 0 && (
                          <div key={k} className={`${SEG[k]} ${isHover ? "brightness-110 outline outline-1 outline-gray-900/25" : ""}`} style={{ height: col[k] * PX_PER_PERSON }} />
                        ))}
                      </div>
                    );
                  })}
                  {/* Day-slice tooltip */}
                  {hover?.waveId === w.id && (() => {
                    const i = days.indexOf(hover.day);
                    if (i < 0) return null;
                    const people = daySlice(w, campaign.people, hover.day);
                    const leftPct = days.length > 1 ? (i + 0.5) / days.length * 100 : 50;
                    return (
                      <div className="absolute bottom-full mb-1 z-20 -translate-x-1/2 w-max max-w-[220px] rounded-lg border border-border bg-white shadow-lg p-2" style={{ left: `${leftPct}%` }}>
                        <p className="text-[11px] font-medium text-gray-700 mb-1">{fmtDay(hover.day)} · {people.reduce((s, p) => s + p.count, 0)} present</p>
                        <ul className="space-y-0.5">
                          {people.map((p, j) => (
                            <li key={j} className={`flex items-center gap-1.5 text-[12px] ${p.status === "proposed" ? "text-gray-400" : "text-gray-800"}`}>
                              <span className={`w-2 h-2 rounded-full shrink-0 ${SEG[p.key]}`} />
                              {p.label}
                            </li>
                          ))}
                        </ul>
                      </div>
                    );
                  })()}
                </div>
                {/* Band (duration) with event dots */}
                <div className="relative h-6 rounded-b-md bg-gradient-to-r from-gray-100 to-gray-200/70">
                  {waveEvents.map((e) => {
                    const i = days.indexOf(e.date!);
                    const leftPct = days.length > 1 ? (i / (days.length - 1)) * 100 : 50;
                    const on = eventHover === e.id;
                    return (
                      <span key={e.id} className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2" style={{ left: `${Math.min(97, Math.max(3, leftPct))}%` }}
                        onMouseEnter={() => setEventHover(e.id)} onMouseLeave={() => setEventHover(null)}>
                        <span className={`block rounded-full bg-amber-500 border-2 border-white shadow ring-2 ring-amber-500/30 transition-transform ${on ? "w-4 h-4 scale-110" : "w-3.5 h-3.5"}`} />
                        {on && (
                          <span className="absolute top-full mt-1 left-1/2 -translate-x-1/2 z-20 w-max max-w-[200px] rounded-lg border border-border bg-white shadow-lg px-2 py-1 text-[12px] text-gray-800">
                            <span className="font-medium">{e.name}</span>{e.date ? <span className="block text-[11px] text-gray-400">{fmtDay(e.date)}{e.location ? ` · ${e.location}` : ""}</span> : null}
                          </span>
                        )}
                      </span>
                    );
                  })}
                </div>
                {/* Start / end dates */}
                <div className="flex justify-between text-[11px] text-gray-500 mt-0.5">
                  <span>{w.start ? fmtDay(w.start) : "—"}</span>
                  <span>{w.end ? fmtDay(w.end) : ""}</span>
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
      <span className="inline-flex items-center gap-1.5 text-[12px] text-gray-500"><span className="w-3 h-3 rounded-full bg-amber-500 border-2 border-white ring-2 ring-amber-500/30" /> event</span>
    </div>
  );
}
