import { useEffect, useState } from "react";
import { ArrowUpRight, X, Users, Lightbulb, Folder, Inbox, CheckSquare, Square, Plus, Trash2, StickyNote } from "lucide-react";
import {
  listSeriesCaptures, listAssignedSeriesCaptures, assignSeriesCapture, dismissSlackCapture, discardCapture,
  editSlackCapture, setCaptureHome, keepSeriesCapture, listSeriesNotes, addSeriesNote, removeSeriesNote,
  runSeriesScrape, getSeriesOverviewData, addSeriesBudgetLine, addSeriesRole,
  type SeriesCapture, type AssignedCapture, type SeriesOverviewData, type CaptureHome, type PlanItem,
} from "../lib/db";
import { SlackCard, SlackCaptureList } from "./SlackCard";
import type { TabProps } from "./SeriesDashboard";
const money = (n: number | null | undefined, cur = "USD") =>
  n == null ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: cur, maximumFractionDigits: 0 }).format(n);
const fmtDate = (d: string | null) => (d ? new Date(d + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "TBD");

// The series' cross-event Overview: where Slack updates for the whole push land + get routed to a
// member event, plus a snapshot that stretches across the events (budget rollup, staffing, learnings).
export function SeriesOverview({ seriesId, campaign, events, onOpenEvent }: TabProps) {
  const [caps, setCaps] = useState<SeriesCapture[]>([]);          // series-level (unrouted / push-wide)
  const [assigned, setAssigned] = useState<AssignedCapture[]>([]); // routed to a member event
  const [data, setData] = useState<SeriesOverviewData | null>(null);
  const [busy, setBusy] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());   // selected in "From Slack"
  const [aSel, setASel] = useState<Set<string>>(new Set());  // selected in "Assigned to events"
  const [lineLabel, setLineLabel] = useState(""); const [lineAmt, setLineAmt] = useState("");
  const [roleDraft, setRoleDraft] = useState("");
  const [notes, setNotes] = useState<PlanItem[]>([]);   // push-wide form & structure
  const [noteDraft, setNoteDraft] = useState("");

  const reloadCaps = () => { void listSeriesCaptures(seriesId).then(setCaps); void listAssignedSeriesCaptures(seriesId).then(setAssigned); };
  const reloadData = () => { void getSeriesOverviewData(seriesId).then(setData); void listSeriesNotes(seriesId).then(setNotes); };
  const reloadAll = () => { reloadCaps(); reloadData(); };
  useEffect(() => {
    reloadAll();
    void runSeriesScrape(seriesId).then((r) => { if (r?.ok) reloadAll(); }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seriesId]);

  const toggle = (set: React.Dispatch<React.SetStateAction<Set<string>>>, id: string) =>
    set((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allOn = (set: React.Dispatch<React.SetStateAction<Set<string>>>, ids: string[], on: boolean) => set(on ? new Set(ids) : new Set());

  const assign = async (capId: string, eventId: string) => {
    setBusy(true);
    try { await assignSeriesCapture(capId, eventId); setSel((p) => { const n = new Set(p); n.delete(capId); return n; }); reloadAll(); } catch { /* ignore */ } finally { setBusy(false); }
  };
  // From Slack (nothing applied yet) → Discard just removes the card.
  const discardFromSlack = async () => { setBusy(true); try { for (const id of sel) await dismissSlackCapture(id); setSel(new Set()); reloadCaps(); } catch { /* ignore */ } finally { setBusy(false); } };
  // Assigned → Discard reverses what each applied (budget line / role) then removes; Keep just clears the cards.
  const discardAssigned = async () => { setBusy(true); try { for (const c of assigned.filter((c) => aSel.has(c.id))) await discardCapture({ id: c.id, eventId: c.eventId, undo: c.undo }); setASel(new Set()); reloadAll(); } catch { /* ignore */ } finally { setBusy(false); } };
  const keepAssigned = async () => { setBusy(true); try { for (const id of aSel) await dismissSlackCapture(id); setASel(new Set()); reloadAll(); } catch { /* ignore */ } finally { setBusy(false); } };

  // Per-card versions — act directly on one card without entering selection.
  const discardOne = async (id: string) => { setBusy(true); try { await dismissSlackCapture(id); setSel((p) => { const n = new Set(p); n.delete(id); return n; }); reloadCaps(); } catch { /* ignore */ } finally { setBusy(false); } };
  const keepOne = async (id: string) => { setBusy(true); try { await dismissSlackCapture(id); setASel((p) => { const n = new Set(p); n.delete(id); return n; }); reloadAll(); } catch { /* ignore */ } finally { setBusy(false); } };
  const discardOneAssigned = async (c: AssignedCapture) => { setBusy(true); try { await discardCapture({ id: c.id, eventId: c.eventId, undo: c.undo }); setASel((p) => { const n = new Set(p); n.delete(c.id); return n; }); reloadAll(); } catch { /* ignore */ } finally { setBusy(false); } };
  const editCap = async (id: string, summary: string, detail: string | null) => { setBusy(true); try { await editSlackCapture(id, { summary, detail }); reloadAll(); } catch { /* ignore */ } finally { setBusy(false); } };
  const moveCap = async (id: string, home: CaptureHome) => { setBusy(true); try { await setCaptureHome(id, home); reloadAll(); } catch { /* ignore */ } finally { setBusy(false); } };

  const addLine = async () => { const l = lineLabel.trim(); if (!l) return; setBusy(true); try { await addSeriesBudgetLine(seriesId, l, lineAmt.trim() === "" ? null : Number(lineAmt)); setLineLabel(""); setLineAmt(""); reloadData(); } catch { /* ignore */ } finally { setBusy(false); } };
  const addRole = async () => { const r = roleDraft.trim(); if (!r) return; setBusy(true); try { await addSeriesRole(seriesId, r); setRoleDraft(""); reloadData(); } catch { /* ignore */ } finally { setBusy(false); } };
  const addNote = async () => { const t = noteDraft.trim(); if (!t) return; setBusy(true); try { await addSeriesNote(seriesId, { text: t }); setNoteDraft(""); reloadData(); } catch { /* ignore */ } finally { setBusy(false); } };
  const removeNote = async (id: string) => { setBusy(true); try { await removeSeriesNote(seriesId, id); setNotes((p) => p.filter((x) => x.id !== id)); } catch { /* ignore */ } finally { setBusy(false); } };
  // "Keep" on a push-wide card routes it into the series-level store (budget / staffing / notes) and clears the card.
  const keepSeriesWide = async (c: SeriesCapture) => { setBusy(true); try { await keepSeriesCapture(seriesId, { id: c.id, home: c.home, summary: c.summary, detail: c.detail, sourceRef: c.sourceRef }); setSel((p) => { const n = new Set(p); n.delete(c.id); return n; }); reloadAll(); } catch { /* ignore */ } finally { setBusy(false); } };
  const keepSeriesBulk = async () => { setBusy(true); try { for (const c of caps.filter((c) => sel.has(c.id))) await keepSeriesCapture(seriesId, { id: c.id, home: c.home, summary: c.summary, detail: c.detail, sourceRef: c.sourceRef }); setSel(new Set()); reloadAll(); } catch { /* ignore */ } finally { setBusy(false); } };

  const committedTotal = (data?.committed ?? []).reduce((s, c) => s + c.committed, 0);
  const seriesLinesTotal = (data?.seriesLines ?? []).reduce((s, l) => s + (l.confirmedAmount ?? 0), 0);
  const cur = campaign.currency || data?.committed[0]?.currency || "USD";
  const roleRows = (() => {
    const m = new Map<string, string[]>();
    for (const r of data?.seriesRoles ?? []) (m.get(r) ?? m.set(r, []).get(r))!.push("series");
    for (const e of data?.events ?? []) for (const r of e.staffRoles) (m.get(r) ?? m.set(r, []).get(r))!.push(e.name);
    return [...m.entries()].map(([role, where]) => ({ role, where }));
  })();
  const learnings = (data?.events ?? []).filter((e) => e.reflections.length > 0);
  const assignedByEvent = events.map((e) => ({ event: e, caps: assigned.filter((c) => c.eventId === e.id) })).filter((g) => g.caps.length > 0);

  return (
    <div className="space-y-6">
      {/* ── From Slack — series-level updates to route ─────────────────────────────── */}
      <section className="bg-white rounded-2xl border border-border p-5">
        <div className="flex items-center gap-2 mb-1">
          <Inbox className="w-4 h-4 text-gray-400" />
          <h3 className="font-medium">From Slack</h3>
          <span className="text-[12px] text-gray-400">push-wide + unrouted updates · assign each to the event it belongs to</span>
        </div>
        <SlackCaptureList
          models={caps.map((c) => ({
            id: c.id, home: c.home, summary: c.summary, detail: c.detail, sourceRef: c.sourceRef,
            badge: <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${c.routing === "series" ? "bg-amber-100 text-amber-700" : "bg-gray-100 text-gray-500"}`}>{c.routing === "series" ? "push-wide" : "no event matched"}</span>,
          }))}
          selected={sel}
          onToggleAll={(on) => allOn(setSel, caps.map((c) => c.id), on)}
          onBulkKeep={keepSeriesBulk}
          onBulkDiscard={discardFromSlack}
          emptyText="Nothing waiting. Updates the scrape couldn't pin to one event land here to assign."
          card={(m) => (
            <SlackCard model={m} selected={sel.has(m.id)} onToggleSelect={() => toggle(setSel, m.id)}
              assignTargets={events.map((e) => ({ id: e.id, name: e.name }))} onAssign={(eid) => assign(m.id, eid)}
              onKeep={() => { const c = caps.find((x) => x.id === m.id); return c ? keepSeriesWide(c) : Promise.resolve(); }}
              onDiscard={() => discardOne(m.id)} onEdit={(s, d) => editCap(m.id, s, d)} onMove={(h) => moveCap(m.id, h)} />
          )}
        />
      </section>

      {/* ── Assigned to events — Slack facts routed to a member event ──────────────── */}
      {assignedByEvent.length > 0 && (
        <section className="bg-white rounded-2xl border border-border p-5">
          <div className="flex items-center gap-2 mb-1">
            <Inbox className="w-4 h-4 text-gray-400" />
            <h3 className="font-medium">Assigned to events</h3>
            <span className="text-[12px] text-gray-400">Slack facts routed to a specific event (also shown on that event)</span>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <button onClick={() => allOn(setASel, assigned.map((c) => c.id), aSel.size !== assigned.length)} className="inline-flex items-center gap-1 text-[12px] text-gray-500 hover:text-gray-800">
              {aSel.size === assigned.length && assigned.length > 0 ? <CheckSquare className="w-4 h-4 text-violet-600" /> : <Square className="w-4 h-4" />} Select all
            </button>
            {aSel.size > 0 && (
              <div className="ml-auto flex items-center gap-1.5">
                <button onClick={keepAssigned} disabled={busy} title="Clear the cards, keep what they added" className="inline-flex items-center gap-1 rounded-md border border-gray-200 px-2.5 py-1 text-[12px] text-gray-600 hover:bg-gray-50 disabled:opacity-50"><X className="w-3.5 h-3.5" /> Keep ({aSel.size})</button>
                <button onClick={discardAssigned} disabled={busy} title="Reverse what they added, then remove" className="inline-flex items-center gap-1 rounded-md border border-red-200 px-2.5 py-1 text-[12px] text-red-600 hover:bg-red-50 disabled:opacity-50"><Trash2 className="w-3.5 h-3.5" /> Discard ({aSel.size})</button>
              </div>
            )}
          </div>
          <div className="mt-3 space-y-4">
            {assignedByEvent.map(({ event, caps: ec }) => (
              <div key={event.id}>
                <button onClick={() => onOpenEvent?.(event.id)} className="text-[12px] font-medium text-gray-600 hover:text-violet-700 hover:underline mb-1">{event.name}</button>
                <ul className="space-y-1.5">
                  {ec.map((c) => (
                    <li key={c.id}>
                      <SlackCard
                        model={{ id: c.id, home: c.home, summary: c.summary, detail: c.detail, sourceRef: c.sourceRef, badge: c.applied ? <span className="text-[10px] text-emerald-700">✓ applied</span> : undefined }}
                        tone="emerald" selected={aSel.has(c.id)} onToggleSelect={() => toggle(setASel, c.id)}
                        onKeep={() => keepOne(c.id)} onDiscard={() => discardOneAssigned(c)}
                        onEdit={(s, d) => editCap(c.id, s, d)} onMove={(h) => moveCap(c.id, h)} />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}

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

      {/* ── Budget · Staffing (stretched across the push + push-wide items) ────────── */}
      <div className="grid md:grid-cols-2 gap-6">
        <section className="bg-white rounded-2xl border border-border p-5">
          <h3 className="font-medium mb-3">Budget</h3>
          <p className="text-2xl font-semibold text-gray-900">{money(committedTotal + seriesLinesTotal, cur)}</p>
          <p className="text-[12px] text-gray-500 mb-3">committed across the push{seriesLinesTotal > 0 ? " (incl. push-wide)" : ""}</p>
          <ul className="space-y-1">
            {(data?.committed ?? []).filter((c) => c.committed > 0).map((c) => (
              <li key={c.eventId} className="flex items-center justify-between text-[13px]">
                <button onClick={() => onOpenEvent?.(c.eventId)} className="text-gray-700 hover:text-violet-700 hover:underline truncate">{c.name}</button>
                <span className="text-gray-600 shrink-0 ml-2">{money(c.committed, c.currency)}</span>
              </li>
            ))}
            {(data?.seriesLines ?? []).map((l) => (
              <li key={l.id} className="flex items-center justify-between text-[13px]">
                <span className="text-gray-700 truncate">{l.label || "—"} <span className="text-[10px] text-amber-600">push-wide</span></span>
                <span className="text-gray-600 shrink-0 ml-2">{money(l.confirmedAmount, cur)}</span>
              </li>
            ))}
          </ul>
          {/* Add a push-wide line directly to the series (not tied to an event). */}
          <div className="mt-3 flex items-center gap-1.5">
            <input value={lineLabel} onChange={(e) => setLineLabel(e.target.value)} placeholder="Add push-wide cost…" className="flex-1 min-w-0 px-2 py-1 border border-gray-200 rounded text-[13px] focus:outline-none focus:ring-2 focus:ring-gray-300" />
            <input value={lineAmt} onChange={(e) => setLineAmt(e.target.value)} placeholder={money(0, cur)} type="number" className="w-20 px-2 py-1 border border-gray-200 rounded text-[13px] text-right focus:outline-none focus:ring-2 focus:ring-gray-300" />
            <button onClick={addLine} disabled={busy || !lineLabel.trim()} className="inline-flex items-center rounded-md bg-gray-900 text-white px-2 py-1 hover:bg-gray-700 disabled:opacity-50"><Plus className="w-3.5 h-3.5" /></button>
          </div>
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
          <div className="mt-3 flex items-center gap-1.5">
            <input value={roleDraft} onChange={(e) => setRoleDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addRole(); }} placeholder="Add push-wide role…" className="flex-1 min-w-0 px-2 py-1 border border-gray-200 rounded text-[13px] focus:outline-none focus:ring-2 focus:ring-gray-300" />
            <button onClick={addRole} disabled={busy || !roleDraft.trim()} className="inline-flex items-center rounded-md bg-gray-900 text-white px-2 py-1 hover:bg-gray-700 disabled:opacity-50"><Plus className="w-3.5 h-3.5" /></button>
          </div>
        </section>
      </div>

      {/* ── Form & structure (push-wide concepts / how the series runs) ─────────────── */}
      <section className="bg-white rounded-2xl border border-border p-5">
        <div className="flex items-center gap-2 mb-3">
          <StickyNote className="w-4 h-4 text-gray-400" />
          <h3 className="font-medium">Form &amp; structure</h3>
          <span className="text-[12px] text-gray-400">push-wide concepts / how the series runs — not deliverables</span>
        </div>
        {notes.length > 0 && (
          <ul className="mb-2 space-y-1.5">
            {notes.map((p) => (
              <li key={p.id} className="flex items-start gap-2 text-sm group">
                <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-gray-300 shrink-0" />
                <span className="flex-1 min-w-0 text-gray-800">
                  {p.text}{p.detail && <span className="text-gray-500"> — {p.detail}</span>}
                  {p.slackRef && <a href={p.slackRef} target="_blank" rel="noreferrer" title="From Slack" className="ml-1 inline-flex items-center text-violet-500 hover:text-violet-700 align-middle"><ArrowUpRight className="w-3 h-3" /></a>}
                </span>
                <button onClick={() => removeNote(p.id)} disabled={busy} title="Remove" className="shrink-0 text-gray-300 hover:text-red-600 opacity-0 group-hover:opacity-100 disabled:opacity-50"><X className="w-3.5 h-3.5" /></button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex items-center gap-1.5">
          <input value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addNote(); }} placeholder="Add a push-wide note…" className="flex-1 min-w-0 px-2 py-1 border border-gray-200 rounded text-[13px] focus:outline-none focus:ring-2 focus:ring-gray-300" />
          <button onClick={addNote} disabled={busy || !noteDraft.trim()} className="inline-flex items-center rounded-md bg-gray-900 text-white px-2 py-1 hover:bg-gray-700 disabled:opacity-50"><Plus className="w-3.5 h-3.5" /></button>
        </div>
      </section>

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
