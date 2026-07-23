// Pure classification logic for the one-off Google Calendar backfill (scripts/backfill-gcal.mjs).
// Kept separate + framework-free so it can be unit-tested (tests/backfill-gcal.test.ts).
//
// The similarity/span/marker helpers are ported VERBATIM from supabase/functions/gcal-sync/index.ts
// (itself dual-maintained with cloud-functions/src/functions/gcal-sync.ts) so the backfill matches
// events exactly the way the live sync does. Do not "improve" them here in isolation.

export const EVENTHUB_MARKER = "EventHub:";

// ── Title similarity (verbatim from gcal-sync) ────────────────────────────────
function tokens(s) {
  return new Set(String(s).toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean));
}

/** Token-set containment (every token of the shorter title is in the longer) OR Jaccard ≥ 0.5. */
export function nameSimilar(a, b) {
  const ta = tokens(a), tb = tokens(b);
  if (!ta.size || !tb.size) return false;
  const [small, big] = ta.size <= tb.size ? [ta, tb] : [tb, ta];
  let inter = 0; for (const t of small) if (big.has(t)) inter++;
  if (inter === small.size) return true;
  const union = ta.size + tb.size - inter;
  return union > 0 && inter / union >= 0.5;
}

/** Full containment only — the "strong" signal that separates confident from ambiguous. */
function nameContained(a, b) {
  const ta = tokens(a), tb = tokens(b);
  if (!ta.size || !tb.size) return false;
  const [small, big] = ta.size <= tb.size ? [ta, tb] : [tb, ta];
  for (const t of small) if (!big.has(t)) return false;
  return true;
}

/** An event/candidate we already own carries the EventHub marker in its description. */
export function isOwned(description) {
  return !!description && String(description).includes(EVENTHUB_MARKER);
}

// ── Spans + overlap (verbatim from gcal-sync) ─────────────────────────────────
function ms(iso) { return new Date(iso.length === 10 ? iso + "T00:00:00" : iso).getTime(); }
function timeOverlap(a, b) { return ms(a.start) < ms(b.end) && ms(b.start) < ms(a.end); }

function addDay(d) { const x = new Date(d + "T00:00:00"); x.setDate(x.getDate() + 1); return x.toISOString().slice(0, 10); }

function eventSpan(ev) {
  if (ev.start_time) {
    const end = ev.end_time || ev.start_time;
    return { start: `${ev.event_date}T${ev.start_time}:00`, end: `${ev.event_date}T${end}:00`, allDay: false };
  }
  return { start: ev.event_date, end: addDay(ev.event_date), allDay: true };
}

function candidateSpan(item) {
  if (item.start.dateTime) return { start: item.start.dateTime, end: item.end.dateTime, allDay: false };
  return { start: item.start.date, end: item.end.date, allDay: true };
}

/** Calendar date (YYYY-MM-DD) of a candidate, regardless of all-day vs timed. */
function candidateDate(item) {
  return item.start.date ?? String(item.start.dateTime).slice(0, 10);
}

// ── Classification ────────────────────────────────────────────────────────────
//
// Given an event and the raw GCal items in its ±1-day window, decide one of:
//   • create    — no live event looks like this one; make a fresh copy
//   • confident — exactly one strong match (full title containment + same date); soft-link it
//   • ambiguous — anything less certain (2+ matches, Jaccard-only, or date off by a day); ask a human
//
// Matching mirrors gcal-sync.findCandidate: time overlap + nameSimilar + not already owned.
export function classify(ev, windowItems) {
  const eSpan = eventSpan(ev);
  // Candidates = name-similar, not-already-ours items in the window. We deliberately do NOT
  // require time overlap here (unlike gcal-sync.findCandidate): a same-name event a day off is
  // a near-miss we want a human to look at, not something to silently duplicate.
  const matches = (windowItems ?? []).filter(
    (item) => nameSimilar(ev.name ?? "", item.summary ?? "") && !isOwned(item.description),
  );

  if (matches.length === 0) return { bucket: "create" };

  if (matches.length === 1) {
    const only = matches[0];
    // Confident only when the match is unmistakable: full title containment, same calendar date,
    // and (for timed events) actual time overlap.
    const strong =
      nameContained(ev.name ?? "", only.summary ?? "") &&
      candidateDate(only) === ev.event_date &&
      timeOverlap(eSpan, candidateSpan(only));
    if (strong) return { bucket: "confident", candidate: only };
  }

  // Ambiguous — explain why so the UI can flag it.
  let reason;
  if (matches.length > 1) {
    reason = `${matches.length} possible matches nearby`;
  } else {
    const only = matches[0];
    reason = candidateDate(only) !== ev.event_date
      ? `"${only.summary}" is on ${candidateDate(only)}, a day off`
      : `title only loosely matches "${only.summary}"`;
  }
  return { bucket: "ambiguous", candidates: matches, reason };
}
