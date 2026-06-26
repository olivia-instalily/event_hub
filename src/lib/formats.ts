// Reconcile a format label against the existing format vocabulary: prefer the closest
// existing category (so "Run + coffee" / "Community run" → the existing "Run"), and only
// fall back to a SHORT new label when nothing's close. Shared by the drop ingest (client)
// and createPlanningEvent (server-side safety net) so every create path checks first.
export function matchFormat(raw: string, catalog: string[]): string {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  const r = norm(raw);
  if (!r) return raw.trim();
  const exact = catalog.find((c) => norm(c) === r);
  if (exact) return exact;
  // Best existing match by shared significant words (≥3 chars).
  const rWords = new Set(r.split(" "));
  let best: { fmt: string; score: number } | null = null;
  for (const c of catalog) {
    const shared = norm(c).split(" ").filter((w) => w.length >= 3 && rWords.has(w)).length;
    if (shared > 0 && (!best || shared > best.score)) best = { fmt: c, score: shared };
  }
  if (best) return best.fmt;
  // Nothing close → a short new format: drop filler + trailing "+ activity", cap at 2 words.
  const cleaned = raw
    .replace(/\b(community|company|team|internal|external|social|casual|monthly|weekly|annual)\b/gi, "")
    .replace(/\s*\+\s*.*$/, "")
    .replace(/\s+/g, " ")
    .trim();
  const short = (cleaned || raw).split(" ").slice(0, 2).join(" ");
  return short.charAt(0).toUpperCase() + short.slice(1);
}
