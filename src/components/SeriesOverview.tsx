import { useEffect, useState } from "react";
import { ArrowUpRight, X, Users, Lightbulb, Folder, Inbox } from "lucide-react";
import {
  listSeriesCaptures, assignSeriesCapture, dismissSlackCapture, runSeriesScrape,
  getSeriesOverviewData, type SeriesCapture, type SeriesOverviewData, type CaptureHome,
} from "../lib/db";
import type { TabProps } from "./SeriesDashboard";

const HOME_TAG: Record<CaptureHome, { label: string; cls: string }> = {
  person: { label: "Staffing", cls: "bg-blue-100 text-blue-700" },
  budget: { label: "Budget", cls: "bg-emerald-100 text-emerald-700" },
  open: { label: "Still open", cls: "bg-violet-100 text-violet-700" },
  plan: { label: "Plan", cls: "bg-gray-100 text-gray-600" },
};
const money = (n: number | null | undefined, cur = "USD") =>
  n == null ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: cur, maximumFractionDigits: 0 }).format(n);
const fmtDate = (d: string | null) => (d ? new Date(d + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "TBD");

// The series' cross-event Overview: where Slack updates for the whole push land + get routed to a
// member event, plus a snapshot that stretches across the events (budget rollup, staffing, learnings).
export function SeriesOverview({ seriesId, campaign, events, onOpenEvent }: TabProps) {
  const [caps, setCaps] = useState<SeriesCapture[]>([]);
  const [data, setData] = useState<SeriesOverviewData | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const reloadCaps = () => { void listSeriesCaptures(seriesId).then(setCaps); };
  const reloadData = () => { void getSeriesOverviewData(seriesId).then(setData); };
  useEffect(() => {
    reloadCaps(); reloadData();
    void runSeriesScrape(seriesId).then((r) => { if (r?.ok) { reloadCaps(); reloadData(); } }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seriesId]);

  const assign = async (capId: string, eventId: string) => {
    setBusy(capId);
    try { await assignSeriesCapture(capId, eventId); reloadCaps(); reloadData(); } catch { /* ignore */ } finally { setBusy(null); }
  };
  const dismiss = async (capId: string) => { setBusy(capId); try { await dismissSlackCapture(capId); reloadCaps(); } catch { /* ignore */ } finally { setBusy(null); } };

  const committedTotal = (data?.committed ?? []).reduce((s, c) => s + c.committed, 0);
  const cur = campaign.currency || data?.committed[0]?.currency || "USD";
  // Merged staffing: series-level roles + any role on a member event (deduped), with where it sits.
  const roleRows = (() => {
    const m = new Map<string, string[]>(); // role → where (series / event names)
    for (const r of data?.seriesRoles ?? []) (m.get(r) ?? m.set(r, []).get(r))!.push("series");
    for (const e of data?.events ?? []) for (const r of e.staffRoles) (m.get(r) ?? m.set(r, []).get(r))!.push(e.name);
    return [...m.entries()].map(([role, where]) => ({ role, where }));
  })();
  const learnings = (data?.events ?? []).filter((e) => e.reflections.length > 0);

  return (
    <div className="space-y-6">
      {/* ── From Slack — series-level updates to route ─────────────────────────────── */}
      <section className="bg-white rounded-2xl border border-border p-5">
        <div className="flex items-center gap-2 mb-1">
          <Inbox className="w-4 h-4 text-gray-400" />
          <h3 className="font-medium">From Slack</h3>
          <span className="text-[12px] text-gray-400">push-wide + unrouted updates · assign each to the event it belongs to</span>
        </div>
        {caps.length === 0 ? (
          <p className="text-[13px] text-gray-400 mt-2">Nothing waiting. Updates the scrape couldn't pin to one event land here to assign.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {caps.map((c) => {
              const tag = HOME_TAG[c.home];
              return (
                <li key={c.id} className="rounded-lg border border-violet-200 bg-violet-50/50 px-3 py-2.5">
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${tag.cls}`}>{tag.label}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${c.routing === "series" ? "bg-amber-100 text-amber-700" : "bg-gray-100 text-gray-500"}`}>{c.routing === "series" ? "push-wide" : "no event matched"}</span>
                    {c.sourceRef && <a href={c.sourceRef} target="_blank" rel="noreferrer" className="ml-auto inline-flex items-center gap-0.5 text-[11px] text-violet-600 hover:text-violet-800">source <ArrowUpRight className="w-3 h-3" /></a>}
                  </div>
                  <p className="text-[14px] text-gray-900 leading-snug">{c.summary}{c.detail && <span className="text-gray-500"> — {c.detail}</span>}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] text-gray-400">assign to:</span>
                    {events.map((e) => (
                      <button key={e.id} disabled={busy === c.id} onClick={() => assign(c.id, e.id)}
                        className="rounded-full border border-gray-200 px-2.5 py-1 text-[12px] text-gray-700 hover:border-violet-300 hover:bg-violet-50 hover:text-violet-700 disabled:opacity-50">
                        {e.name}
                      </button>
                    ))}
                    <button disabled={busy === c.id} onClick={() => dismiss(c.id)} title="Dismiss" className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px] text-gray-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"><X className="w-3.5 h-3.5" /> dismiss</button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* ── Where things stand — the events in the push ────────────────────────────── */}
      <section className="bg-white rounded-2xl border border-border p-5">
        <h3 className="font-medium mb-3">Where things stand</h3>
        <ul className="divide-y divide-gray-100">
          {events.map((e) => {
            const comm = (data?.committed ?? []).find((c) => c.eventId === e.id);
            return (
              <li key={e.id} className="flex items-center gap-3 py-2">
                <span className="text-[12px] text-gray-400 w-14 shrink-0">{fmtDate(e.date)}</span>
                <button onClick={() => onOpenEvent?.(e.id)} className="text-sm text-gray-800 flex-1 min-w-0 truncate text-left hover:text-violet-700 hover:underline">{e.name}</button>
                <span className="text-[12px] text-gray-500 shrink-0">{comm && comm.committed > 0 ? money(comm.committed, comm.currency) + " committed" : ""}</span>
              </li>
            );
          })}
          {events.length === 0 && <li className="text-[13px] text-gray-400 py-2">No events in this series yet.</li>}
        </ul>
      </section>

      {/* ── Budget · Staffing (stretched across the push) ──────────────────────────── */}
      <div className="grid md:grid-cols-2 gap-6">
        <section className="bg-white rounded-2xl border border-border p-5">
          <h3 className="font-medium mb-3">Budget</h3>
          <p className="text-2xl font-semibold text-gray-900">{money(committedTotal, cur)}</p>
          <p className="text-[12px] text-gray-500 mb-3">committed across the push</p>
          <ul className="space-y-1">
            {(data?.committed ?? []).filter((c) => c.committed > 0).map((c) => (
              <li key={c.eventId} className="flex items-center justify-between text-[13px]">
                <button onClick={() => onOpenEvent?.(c.eventId)} className="text-gray-700 hover:text-violet-700 hover:underline truncate">{c.name}</button>
                <span className="text-gray-600 shrink-0 ml-2">{money(c.committed, c.currency)}</span>
              </li>
            ))}
            {(data?.committed ?? []).every((c) => c.committed === 0) && <li className="text-[13px] text-gray-400">Nothing committed yet.</li>}
          </ul>
        </section>

        <section className="bg-white rounded-2xl border border-border p-5">
          <div className="flex items-center gap-2 mb-3"><Users className="w-4 h-4 text-gray-400" /><h3 className="font-medium">Staffing</h3></div>
          {roleRows.length === 0 ? <p className="text-[13px] text-gray-400">No roles yet.</p> : (
            <ul className="space-y-1.5">
              {roleRows.map((r) => (
                <li key={r.role} className="flex items-center gap-2 text-sm">
                  <span className="text-gray-800 flex-1 min-w-0 truncate">{r.role}</span>
                  <span className="text-[11px] text-gray-400 shrink-0">{r.where.includes("series") ? "push-wide" : r.where.length > 1 ? `${r.where.length} events` : r.where[0]}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* ── Learnings (carried across the events) ──────────────────────────────────── */}
      <section className="bg-white rounded-2xl border border-border p-5">
        <div className="flex items-center gap-2 mb-3"><Lightbulb className="w-4 h-4 text-gray-400" /><h3 className="font-medium">Learnings</h3></div>
        {learnings.length === 0 ? <p className="text-[13px] text-gray-400">No learnings captured yet across the push.</p> : (
          <div className="space-y-3">
            {learnings.map((e) => (
              <div key={e.id}>
                <button onClick={() => onOpenEvent?.(e.id)} className="text-[12px] font-medium text-gray-600 hover:text-violet-700 hover:underline">{e.name}</button>
                <ul className="mt-1 list-disc list-inside space-y-0.5">
                  {e.reflections.map((r, i) => <li key={i} className="text-[13px] text-gray-700">{r}</li>)}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Resources ──────────────────────────────────────────────────────────────── */}
      <section className="bg-white rounded-2xl border border-border p-5">
        <div className="flex items-center gap-2 mb-2"><Folder className="w-4 h-4 text-gray-400" /><h3 className="font-medium">Resources</h3></div>
        {campaign.folderUrl ? (
          <a href={campaign.folderUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[13px] text-violet-600 hover:text-violet-800">Drive folder <ArrowUpRight className="w-3.5 h-3.5" /></a>
        ) : <p className="text-[13px] text-gray-400">No shared folder linked yet (add one from the header).</p>}
      </section>
    </div>
  );
}
