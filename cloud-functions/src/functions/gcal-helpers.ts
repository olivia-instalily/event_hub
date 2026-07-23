export const EVENTHUB_MARKER = "EventHub:";
export interface Span { start: string; end: string; allDay: boolean }

export function gcalTitle(name: string | null, location: string | null): string {
  const n = (name ?? "Untitled event").trim();
  const loc = (location ?? "").trim();
  return loc ? `${n} · ${loc}` : n;
}

export function isEligible(ev: { event_date: string | null; is_template: boolean }): boolean {
  return !!ev.event_date && !ev.is_template;
}

export function isOwned(description: string | null | undefined): boolean {
  return !!description && description.includes(EVENTHUB_MARKER);
}

// Millisecond bounds; all-day dates parse at local midnight. Overlap is half-open [start,end).
function ms(iso: string): number { return new Date(iso.length === 10 ? iso + "T00:00:00" : iso).getTime(); }
export function timeOverlap(a: Span, b: Span): boolean {
  return ms(a.start) < ms(b.end) && ms(b.start) < ms(a.end);
}

// Normalized token-set similarity: lowercased, punctuation stripped. Match when every token of the
// shorter title appears in the longer (token-level containment), or Jaccard overlap of the word sets
// ≥ 0.5. Containment is token-based (not letter-concatenated) so "Ana" does NOT match "Banana Split".
function tokens(s: string): Set<string> {
  return new Set(s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean));
}
export function nameSimilar(a: string, b: string): boolean {
  const ta = tokens(a), tb = tokens(b);
  if (!ta.size || !tb.size) return false;
  const [small, big] = ta.size <= tb.size ? [ta, tb] : [tb, ta];
  let inter = 0; for (const t of small) if (big.has(t)) inter++;
  if (inter === small.size) return true;      // every token of the shorter title is in the longer
  const union = ta.size + tb.size - inter;
  return union > 0 && inter / union >= 0.5;    // else fall back to Jaccard overlap
}

// Full containment only — the "strong" signal separating a confident match from an ambiguous one.
export function nameContained(a: string, b: string): boolean {
  const tok = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean));
  const ta = tok(a), tb = tok(b);
  if (!ta.size || !tb.size) return false;
  const [small, big] = ta.size <= tb.size ? [ta, tb] : [tb, ta];
  for (const t of small) if (!big.has(t)) return false;
  return true;
}
