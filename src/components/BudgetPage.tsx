import { useEffect, useState } from "react";
import { ChevronRight, AlertCircle, X } from "lucide-react";
import { getConsolidatedBudget, type ConsolidatedBudget, type EventBudgetRollup, type EventStatus } from "../lib/db";
import { TAG_CATEGORIES } from "../lib/tags";

function money(n: number | null | undefined, currency = "USD"): string {
  return n == null ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(n);
}

// Bucket membership, derived from the tag taxonomy + format.
const HOSTED_TAGS = TAG_CATEGORIES.find((c) => c.name === "Hosted")?.tags ?? [];
const INTERNAL_TAGS = TAG_CATEGORIES.find((c) => c.name === "Internal")?.tags ?? [];
const isExternal = (r: EventBudgetRollup) => r.tags.some((t) => HOSTED_TAGS.includes(t));
const isInternal = (r: EventBudgetRollup) => r.tags.some((t) => INTERNAL_TAGS.includes(t));
const isHappyHour = (r: EventBudgetRollup) => /happy\s*hour/i.test(r.format ?? "") || /happy\s*hour/i.test(r.name);

// The buckets shown in the breakdown. Each carries a matcher used both to roll up totals
// and to filter the per-event list when its row is clicked. "Informal happy hour" is a
// subcategory of External (external events that are also happy hours).
const BUCKET_DEFS: { key: string; name: string; level: number; match: (r: EventBudgetRollup) => boolean }[] = [
  { key: "external", name: "External Events", level: 0, match: isExternal },
  { key: "happy_hour", name: "Informal happy hour", level: 1, match: (r) => isExternal(r) && isHappyHour(r) },
  { key: "internal", name: "Internal Events", level: 0, match: isInternal },
];

function sumRollup(rows: EventBudgetRollup[]) {
  return rows.reduce(
    (a, r) => ({ estimate: a.estimate + r.estimate, paid: a.paid + r.paid, count: a.count + 1 }),
    { estimate: 0, paid: 0, count: 0 },
  );
}

// Event status display, matched to StatusControl's labels/colors.
const STATUS_META: Record<EventStatus, { label: string; dot: string }> = {
  future: { label: "Future", dot: "bg-blue-500" },
  "in-process": { label: "In-Process", dot: "bg-amber-500" },
  past: { label: "Past", dot: "bg-gray-400" },
};

/** Consolidated budget across every event: one row per event with its full estimate and
 *  the actual amount paid, summed against a period-level target. Laid out like a single
 *  event's budget tracker, but each line is a whole event. */
// Period-level target lives client-side for now (changes quarter to quarter).
const TARGET_KEY = "consolidated_budget_target_q3_2026";

export function BudgetPage({ onOpenEvent }: { onOpenEvent?: (eventId: string) => void }) {
  const [data, setData] = useState<ConsolidatedBudget | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState<number>(250_000);
  const [targetInput, setTargetInput] = useState("250000");
  const [bucketFilter, setBucketFilter] = useState<string | null>(null); // bucket key the event list is filtered to

  useEffect(() => {
    let cancelled = false;
    getConsolidatedBudget()
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e) => { if (!cancelled) setError(e?.message ?? String(e)); });
    return () => { cancelled = true; };
  }, []);

  // Restore the saved target on mount.
  useEffect(() => {
    const saved = localStorage.getItem(TARGET_KEY);
    if (saved != null && saved.trim() !== "") { setTarget(Number(saved)); setTargetInput(saved); }
  }, []);

  const saveTarget = (raw: string) => {
    const n = raw.trim() === "" ? 0 : Number(raw);
    setTarget(n);
    localStorage.setItem(TARGET_KEY, String(n));
  };

  const cur = data?.currency ?? "USD";
  const remaining = data ? target - data.totalEstimate : 0;
  const over = remaining < 0;

  const tiles = data
    ? [
        { label: "Estimated total", value: data.totalEstimate, ring: "ring-gray-300" },
        { label: "Paid to date", value: data.totalPaid, ring: "ring-green-400" },
        { label: over ? "Over target" : "Remaining", value: Math.abs(remaining), ring: over ? "ring-red-400" : "ring-amber-400" },
      ]
    : [];

  // Spend grouped into buckets — always shown, even when a bucket is empty.
  const buckets = data ? BUCKET_DEFS.map((d) => ({ ...d, ...sumRollup(data.rows.filter(d.match)) })) : [];

  // Per-event rows, optionally narrowed to the bucket the user clicked.
  const activeBucket = BUCKET_DEFS.find((d) => d.key === bucketFilter) ?? null;
  const eventRows = data ? (activeBucket ? data.rows.filter(activeBucket.match) : data.rows) : [];

  return (
    <div>
      <div className="flex items-start justify-between mb-6 gap-4">
        <div>
          <h1 className="text-2xl">Q3 2026</h1>
          <p className="text-sm text-gray-500 mt-1">Consolidated budget across all events.</p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-sm text-gray-500 mb-1">Total target</p>
          <div className="inline-flex items-center gap-1">
            <span className="text-gray-400 text-lg">$</span>
            <input
              type="number"
              value={targetInput}
              onChange={(e) => setTargetInput(e.target.value)}
              onBlur={(e) => saveTarget(e.target.value)}
              placeholder="—"
              style={{ width: `${Math.max(9, targetInput.length + 4)}ch` }}
              className="px-2 py-1 text-lg text-right border border-black rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-300"
            />
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-black p-6">
        {error ? (
          <p className="text-sm text-red-600">{error}</p>
        ) : !data ? (
          <p className="text-sm text-gray-400">Loading budget…</p>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-5">
              {tiles.map((t) => (
                <div key={t.label} className={`rounded-2xl ring-2 ring-inset ${t.ring} p-4`}>
                  <p className="text-gray-500 text-sm mb-1">{t.label}</p>
                  <p className="text-2xl">{money(t.value, cur)}</p>
                </div>
              ))}
            </div>

            {/* Bucket breakdown — spend grouped by event type. Click a bucket to filter
                the per-event list below to that category. */}
            <p className="text-sm font-medium mb-2">By bucket</p>
            <div className="rounded-lg border border-gray-200 overflow-hidden mb-6">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-500">
                  <tr>
                    <th className="text-left px-3 py-2 font-normal">Bucket</th>
                    <th className="text-right px-3 py-2 font-normal">Events</th>
                    <th className="text-right px-3 py-2 font-normal">Estimate</th>
                    <th className="text-right px-3 py-2 font-normal">Paid</th>
                  </tr>
                </thead>
                <tbody>
                  {buckets.map((b) => (
                    <tr
                      key={b.key}
                      className={`border-t border-gray-100 cursor-pointer hover:bg-gray-50 ${bucketFilter === b.key ? "bg-gray-100" : ""}`}
                      onClick={() => setBucketFilter((cur) => (cur === b.key ? null : b.key))}
                      title={`Show ${b.name}`}
                    >
                      <td className={`px-3 py-2 ${b.level === 1 ? "pl-8 text-gray-500" : "font-medium"}`}>
                        {b.level === 1 && <span className="text-gray-300 mr-1">↳</span>}{b.name}
                      </td>
                      <td className="px-3 py-2 text-right text-gray-500">{b.count}</td>
                      <td className="px-3 py-2 text-right">{money(b.estimate, cur)}</td>
                      <td className="px-3 py-2 text-right">{b.paid > 0 ? money(b.paid, cur) : <span className="text-gray-300">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex items-center gap-2 mb-2">
              <p className="text-sm font-medium">By event</p>
              {activeBucket && (
                <button onClick={() => setBucketFilter(null)} className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-900 bg-gray-100 rounded-full px-2 py-0.5">
                  {activeBucket.name} <X className="w-3 h-3" />
                </button>
              )}
            </div>
            <div className="rounded-lg border border-gray-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-500">
                  <tr>
                    <th className="text-left px-3 py-2 font-normal">Event</th>
                    <th className="text-left px-3 py-2 font-normal">Status</th>
                    <th className="text-right px-3 py-2 font-normal">Estimate</th>
                    <th className="text-right px-3 py-2 font-normal">Paid</th>
                    <th className="px-3 py-2 font-normal"></th>
                  </tr>
                </thead>
                <tbody>
                  {eventRows.length === 0 && <tr><td colSpan={5} className="px-3 py-3 text-gray-400">{activeBucket ? `No ${activeBucket.name.toLowerCase()} yet.` : "No events yet."}</td></tr>}
                  {eventRows.map((r) => {
                    const sm = STATUS_META[r.status];
                    return (
                      <tr
                        key={r.eventId}
                        className={`border-t border-gray-100 ${onOpenEvent ? "hover:bg-gray-50 cursor-pointer" : ""}`}
                        onClick={onOpenEvent ? () => onOpenEvent(r.eventId) : undefined}
                        title={onOpenEvent ? "Open event" : undefined}
                      >
                        <td className="px-3 py-2">{r.name}</td>
                        <td className="px-3 py-2">
                          <span className="inline-flex items-center gap-1.5 text-gray-600">
                            <span className={`w-2 h-2 rounded-full ${sm.dot}`} />{sm.label}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right">{r.estimate > 0 ? money(r.estimate, cur) : <span className="text-gray-300">—</span>}</td>
                        <td className="px-3 py-2 text-right">{r.paid > 0 ? money(r.paid, cur) : <span className="text-gray-300">—</span>}</td>
                        <td className="px-3 py-2 text-right text-gray-400">{onOpenEvent && <ChevronRight className="w-3.5 h-3.5 inline" />}</td>
                      </tr>
                    );
                  })}
                </tbody>
                {eventRows.length > 0 && (
                  <tfoot>
                    <tr className="border-t-2 border-gray-200 font-medium">
                      <td className="px-3 py-2">Total</td>
                      <td className="px-3 py-2 text-gray-400">{eventRows.length} event{eventRows.length === 1 ? "" : "s"}</td>
                      <td className="px-3 py-2 text-right">{money(eventRows.reduce((s, r) => s + r.estimate, 0), cur)}</td>
                      <td className="px-3 py-2 text-right">{money(eventRows.reduce((s, r) => s + r.paid, 0), cur)}</td>
                      <td className="px-3 py-2"></td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>

            <p className="text-xs text-gray-400 mt-4 flex items-start gap-1">
              <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              Estimate is the sum of every budget line; paid counts only lines marked Paid. Edit amounts on each event's Budget tab.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
