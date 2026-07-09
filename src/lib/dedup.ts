// Duplicate-event detection for the drop→create flow. Pure (no DB): given the fields extracted
// from a drop and the existing event list, decide whether this drop is really an event we already
// have — so the create flow can route the user to it instead of spawning a duplicate.

export interface DupEvent {
  id: string;
  title: string;
  date: string | null;   // event_date (ISO) or null
  tags: string[];        // taxonomy tags/type
  isTemplate: boolean;
}

export interface DupCandidate {
  name: string;
  date: string | null;   // ISO or '' / null
  tag: string | null;    // taxonomy type
  isTemplate: boolean;
}

export type DupReason = "files" | "similar";
export interface DupMatch { event: DupEvent; reason: DupReason; }

const norm = (s: string) => (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
const tokens = (s: string) => norm(s).split(" ").filter(Boolean);

/** Two event titles describe the same event: identical (normalized), one is a superset of the other
 *  ("Building AI for Enterprise" vs "…with InstaLILY x Google"), or they share most of their words. */
export function titlesSimilar(a: string, b: string): boolean {
  const na = norm(a), nb = norm(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  // Superset: the shorter, non-trivial title is fully contained in the longer one.
  const [short, long] = na.length <= nb.length ? [na, nb] : [nb, na];
  if (short.split(" ").length >= 2 && (long === short || long.includes(short + " ") || long.includes(" " + short) || long.startsWith(short))) return true;
  // Otherwise require strong word overlap (Jaccard) so different instances don't collide.
  const ta = new Set(tokens(a)), tb = new Set(tokens(b));
  const inter = [...ta].filter((t) => tb.has(t)).length;
  const union = new Set([...ta, ...tb]).size;
  return union > 0 && inter / union >= 0.6;
}

/** Every dropped file is already attached to the event (matched by filename, case-insensitive). */
export function filesMatch(droppedNames: string[], attachedNames: string[]): boolean {
  const dropped = droppedNames.map((n) => norm(n)).filter(Boolean);
  if (!dropped.length) return false;
  const have = new Set(attachedNames.map((n) => norm(n)));
  return dropped.every((n) => have.has(n));
}

/** The strongest semantic match for a to-be-created event: same date + same type + a very similar
 *  title, within the same class (event↔event, template↔template). Returns null if nothing matches. */
export function findDuplicateEvent(candidate: DupCandidate, events: DupEvent[]): DupMatch | null {
  const cDate = candidate.date || null;
  for (const e of events) {
    if (e.isTemplate !== candidate.isTemplate) continue;
    if (!titlesSimilar(candidate.name, e.title)) continue;
    // Same type: the candidate's tag is one of the event's tags (when a tag is known).
    if (candidate.tag && !e.tags.includes(candidate.tag)) continue;
    // Same date: for dated events both must be set and equal. (Templates have no date to compare.)
    if (!candidate.isTemplate) {
      if (!cDate || !e.date || e.date !== cDate) continue;
    }
    return { event: e, reason: "similar" };
  }
  return null;
}
