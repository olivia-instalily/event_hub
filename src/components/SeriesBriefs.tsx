import { useState } from "react";
import type { TabProps } from "./SeriesDashboard";
import { personBrief, personLabel, type BriefEvent } from "../lib/campaign";

export function SeriesBriefs({ campaign, events, save }: TabProps) {
  const [selected, setSelected] = useState<string | null>(campaign.people[0]?.id ?? null);
  const eventsById: Record<string, BriefEvent> = Object.fromEntries(events.map((e) => [e.id, { id: e.id, name: e.name, date: e.date, location: e.location }]));
  const brief = selected ? personBrief(campaign, selected, eventsById) : null;

  const patchSelected = (patch: { lodging?: string; travelDetail?: string }) => {
    if (!selected) return;
    save({ ...campaign, people: campaign.people.map((p) => (p.id === selected ? { ...p, ...patch } : p)) });
  };
  const copy = () => { if (brief) void navigator.clipboard?.writeText(briefText(brief)).catch(() => {}); };

  if (campaign.people.length === 0) return <p className="text-gray-400">Add people on the People & logistics tab to generate briefs.</p>;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_2fr]">
      <div className="rounded-xl border border-border divide-y divide-gray-100 h-fit">
        {campaign.people.map((p) => (
          <button key={p.id} onClick={() => setSelected(p.id)} className={`block w-full text-left px-3 py-2 text-sm ${selected === p.id ? "bg-gray-100 font-medium" : "hover:bg-gray-50"}`}>{personLabel(p)}</button>
        ))}
      </div>

      {brief && (
        <div className="rounded-xl border border-border p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-medium">{brief.label} — trip brief</h2>
            <button onClick={copy} className="text-sm text-gray-600 hover:text-gray-900 border border-gray-300 rounded-lg px-2.5 py-1">Copy</button>
          </div>
          <p className="text-[13px] text-gray-500 mb-4">{brief.traveling ? "Traveling" : "Local"} · {brief.waves.length} wave{brief.waves.length === 1 ? "" : "s"}</p>

          {brief.waves.length === 0 ? <p className="text-sm text-gray-400">Not assigned to any wave yet.</p> : brief.waves.map(({ wave, events: evs }) => (
            <section key={wave.id} className="mb-4">
              <h3 className="text-sm font-medium">{wave.name} <span className="text-gray-400 font-normal">{wave.start ?? "—"}{wave.end ? ` → ${wave.end}` : ""}</span></h3>
              {evs.length === 0 ? <p className="text-[13px] text-gray-400 pl-2">No events.</p> : (
                <ul className="mt-1 space-y-0.5">
                  {evs.map((e) => <li key={e.id} className="text-sm pl-2"><span className="text-gray-400 text-[12px] mr-2">{e.date ?? "—"}</span>{e.name}{e.location ? <span className="text-gray-400"> · {e.location}</span> : ""}</li>)}
                </ul>
              )}
            </section>
          ))}

          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            <label className="text-[13px] text-gray-500">Lodging
              <input value={brief.person.lodging ?? ""} onChange={(e) => patchSelected({ lodging: e.target.value })} placeholder="to confirm" className="mt-1 w-full px-2 py-1 border border-gray-200 rounded text-sm" />
            </label>
            <label className="text-[13px] text-gray-500">Travel detail
              <input value={brief.person.travelDetail ?? ""} onChange={(e) => patchSelected({ travelDetail: e.target.value })} placeholder="to confirm" className="mt-1 w-full px-2 py-1 border border-gray-200 rounded text-sm" />
            </label>
          </div>
        </div>
      )}
    </div>
  );
}

function briefText(b: ReturnType<typeof personBrief> & object): string {
  const lines = [`${b.label} — trip brief`, `${b.traveling ? "Traveling" : "Local"}`, ""];
  for (const { wave, events } of b.waves) {
    lines.push(`${wave.name} (${wave.start ?? "—"}${wave.end ? ` → ${wave.end}` : ""})`);
    for (const e of events) lines.push(`  - ${e.date ?? "—"}  ${e.name}${e.location ? ` · ${e.location}` : ""}`);
  }
  lines.push("", `Lodging: ${b.lodging}`, `Travel: ${b.travelDetail}`);
  return lines.join("\n");
}
