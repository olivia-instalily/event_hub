import { useEffect, useState } from "react";
import { ListChecks, X, ArrowUpRight, Plus } from "lucide-react";
import { listPlanItems, addPlanItem, removePlanItem, type PlanItem } from "../lib/db";

// The event's "Plan" — things planned to happen (format, venue, timing, decided elements) that don't
// need a deliverable. Confirmed Slack 'plan' captures land here; also manually add/remove. `reloadKey`
// bumps when captures apply so the list refreshes.
export function PlanList({ eventId, reloadKey = 0 }: { eventId: string; reloadKey?: number }) {
  const [items, setItems] = useState<PlanItem[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  const reload = () => { void listPlanItems(eventId).then(setItems); };
  useEffect(() => { reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [eventId, reloadKey]);

  const add = async () => { const t = draft.trim(); if (!t) return; setBusy(true); try { await addPlanItem(eventId, { text: t }); setDraft(""); reload(); } catch { /* ignore */ } finally { setBusy(false); } };
  const remove = async (id: string) => { setBusy(true); try { await removePlanItem(eventId, id); setItems((p) => p.filter((x) => x.id !== id)); } catch { /* ignore */ } finally { setBusy(false); } };

  return (
    <section className="bg-white rounded-2xl border border-border p-5">
      <div className="flex items-center gap-2 mb-3">
        <ListChecks className="w-4 h-4 text-gray-400" />
        <h3 className="font-medium">Plan</h3>
        <span className="text-[12px] text-gray-400">what's planned to happen</span>
      </div>
      {items.length === 0 ? (
        <p className="text-[13px] text-gray-400 mb-2">Nothing yet. Decided details from Slack land here, or add your own.</p>
      ) : (
        <ul className="mb-2 space-y-1.5">
          {items.map((p) => (
            <li key={p.id} className="flex items-start gap-2 text-sm group">
              <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-gray-300 shrink-0" />
              <span className="flex-1 min-w-0 text-gray-800">
                {p.text}{p.detail && <span className="text-gray-500"> — {p.detail}</span>}
                {p.slackRef && <a href={p.slackRef} target="_blank" rel="noreferrer" title="From Slack" className="ml-1 inline-flex items-center text-violet-500 hover:text-violet-700 align-middle"><ArrowUpRight className="w-3 h-3" /></a>}
              </span>
              <button onClick={() => remove(p.id)} disabled={busy} title="Remove" className="shrink-0 text-gray-300 hover:text-red-600 opacity-0 group-hover:opacity-100 disabled:opacity-50"><X className="w-3.5 h-3.5" /></button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center gap-1.5">
        <input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add(); }} placeholder="Add a planned detail…" className="flex-1 min-w-0 px-2 py-1 border border-gray-200 rounded text-[13px] focus:outline-none focus:ring-2 focus:ring-gray-300" />
        <button onClick={add} disabled={busy || !draft.trim()} className="inline-flex items-center rounded-md bg-gray-900 text-white px-2 py-1 hover:bg-gray-700 disabled:opacity-50"><Plus className="w-3.5 h-3.5" /></button>
      </div>
    </section>
  );
}
