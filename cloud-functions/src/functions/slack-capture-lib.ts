// One extracted planning fact routed to a single "home" on the event page.
export type Home = 'plan' | 'person' | 'open' | 'budget' | 'vendor';
export const HOME_LABEL: Record<Home, string> = { plan: 'Plan', person: 'Who', open: 'Still open', budget: 'Budget', vendor: 'Vendor' };
// Order homes read in the ephemeral.
const HOME_ORDER: Home[] = ['plan', 'person', 'open', 'budget', 'vendor'];

export interface SlackMsg { ts: string; text: string; user?: string; thread_ts?: string }
export interface EventRow { id: string; name?: string; event_date?: string | null; slack_channel?: string | null }
export interface Proposal { home: Home; summary: string; detail?: string; sourceQuote?: string; usedContext?: { first: string; last: string }; ambiguity?: string }
// planKind splits a 'plan' fact by where it should land: a scheduled time-point → run of show
// ('agenda'), something to produce/do → 'deliverable', or a form/structure concept → 'note' (default).
export type PlanKind = 'note' | 'agenda' | 'deliverable';
// A scrape proposal carries the SOURCE message ts, so re-scraping the same message is idempotent.
export interface ScrapeProposal { home: Home; summary: string; detail?: string; sourceQuote?: string; sourceTs: string; planKind?: PlanKind }
// A person met at/around the event (candidate/contact) — routed to the People list, not an Overview card.
// note = why they matter / their interest; linkedin = a profile URL if one was shared; sourceTs → permalink.
export interface ScrapePerson { name: string; note: string; linkedin?: string; sourceTs: string; sourceQuote?: string }
export interface Removal { label: string }
// Storage home widens Home with 'people' — no-match candidates surfaced on the People page (not an
// Overview card). ('vendor' is now a first-class Home, not a legacy value.)
export type StoredHome = Home | 'people';
export interface StoredCapture {
  id: string; event_id: string | null; series_id: string | null; slack_channel: string; slack_ts: string; home: StoredHome;
  summary: string; detail: string | null; status: 'proposed'; source_ref: string | null;
  source_quote: string | null; context_ts: any; flags: Record<string, unknown>; reactor_user: string | null;
}

export const CTX_BEFORE = 20, CTX_AFTER = 5, CTX_MAX = 30, CTX_MAX_SPAN_MS = 3 * 60 * 60 * 1000;

export function captureId(eventId: string, channel: string, ts: string, home: StoredHome): string {
  return `${eventId}:${channel}:${ts}:${home}`;
}

// A short stable slug of a summary — the discriminator that lets ONE scraped message yield several
// distinct captures in the SAME home without their ids colliding (a brief announcing 6 plan decisions
// must not collapse to one row). Re-scraping the same message with the same summaries → same slugs →
// same ids (still idempotent); the marker makes re-scrape a no-op in the common case regardless.
export function summarySlug(summary: string): string {
  return summary.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'x';
}

// Event linked to this channel; most recent by event_date when several share it.
export function resolveEvent(events: EventRow[], channelId: string): EventRow | null {
  const linked = events.filter((e) => e.slack_channel === channelId);
  if (linked.length === 0) return null;
  if (linked.length === 1) return linked[0];
  return [...linked].sort((a, b) => String(b.event_date ?? '').localeCompare(String(a.event_date ?? '')))[0];
}

// Trim a fetched window to the cap: within CTX_MAX_SPAN_MS of the pin, ≤ CTX_MAX messages, pin kept.
export function contextBounds(msgs: SlackMsg[], pinnedTs: string): SlackMsg[] {
  const pinSec = Number(pinnedTs);
  const inSpan = msgs.filter((m) => Math.abs(Number(m.ts) - pinSec) * 1000 <= CTX_MAX_SPAN_MS);
  const sorted = [...inSpan].sort((a, b) => Number(a.ts) - Number(b.ts));
  if (sorted.length <= CTX_MAX) return sorted;
  const pinIdx = sorted.findIndex((m) => m.ts === pinnedTs);
  const start = Math.max(0, Math.min(pinIdx - CTX_BEFORE, sorted.length - CTX_MAX));
  return sorted.slice(start, start + CTX_MAX);
}

export function buildCaptures(
  event: EventRow, channel: string, pinnedTs: string, reactor: string | null,
  sourceRef: string | null, proposals: Proposal[], committed: { budget?: boolean },
): StoredCapture[] {
  return proposals.map((p) => {
    const flags: Record<string, unknown> = {};
    if (p.ambiguity) flags.ambiguity = p.ambiguity;
    // Budget that would overwrite an already-settled budget stays gated (surfaced, never auto-applied).
    if (p.home === 'budget' && committed.budget) flags.conflict = { field: 'budget' };
    return {
      id: captureId(event.id, channel, pinnedTs, p.home),
      event_id: event.id, series_id: null, slack_channel: channel, slack_ts: pinnedTs, home: p.home,
      summary: p.summary, detail: p.detail ?? null, status: 'proposed' as const,
      source_ref: sourceRef, source_quote: p.sourceQuote ?? null, context_ts: p.usedContext ?? null,
      flags, reactor_user: reactor,
    };
  });
}

// Build stored captures from a whole-channel scrape. Idempotency keys on each fact's SOURCE message
// ts (re-scraping the same message → the same id), not a single pin. Always 'proposed'; sticky
// dismissals/confirmations are enforced by the caller before upsert.
export function buildScrapeCaptures(
  event: EventRow, channel: string, proposals: ScrapeProposal[], permalinks: Record<string, string | null> = {},
): StoredCapture[] {
  return proposals.filter((p) => p.sourceTs && p.summary?.trim()).map((p) => ({
    id: `${captureId(event.id, channel, p.sourceTs, p.home)}:${summarySlug(p.summary)}`,
    event_id: event.id, series_id: null, slack_channel: channel, slack_ts: p.sourceTs, home: p.home,
    summary: p.summary.trim(), detail: p.detail?.trim() || null, status: 'proposed' as const,
    source_ref: permalinks[p.sourceTs] ?? null, source_quote: p.sourceQuote?.trim() || null, context_ts: null,
    flags: p.home === 'plan' ? { planKind: p.planKind ?? 'note' } : {}, reactor_user: null,
  }));
}

// Series scrape: one channel, several member events. Each targeted proposal is stored owned by the
// event it routes to (event_id set — it then applies on that event's page exactly like a per-event
// capture), or owned by the SERIES when push-wide/unassigned (series_id set, event_id null, flags
// carry the routing = 'series' | 'unassigned' so the series Open area can show + let the user assign).
export function buildTargetedCaptures(
  seriesId: string, channel: string, proposals: TargetedProposalLike[], rosterIds: Set<string>, permalinks: Record<string, string | null> = {},
): StoredCapture[] {
  return proposals.filter((p) => p.sourceTs && p.summary?.trim()).map((p) => {
    const toEvent = rosterIds.has(p.eventId);
    const ownerKey = toEvent ? p.eventId : seriesId;
    return {
      id: `${captureId(ownerKey, channel, p.sourceTs, p.home)}:${summarySlug(p.summary)}`,
      event_id: toEvent ? p.eventId : null,
      series_id: toEvent ? null : seriesId,
      slack_channel: channel, slack_ts: p.sourceTs, home: p.home,
      summary: p.summary.trim(), detail: p.detail?.trim() || null, status: 'proposed' as const,
      source_ref: permalinks[p.sourceTs] ?? null, source_quote: p.sourceQuote?.trim() || null, context_ts: null,
      flags: toEvent
        ? (p.home === 'plan' ? { planKind: p.planKind ?? 'note' } : {})
        : { routing: p.eventId === 'series' ? 'series' : 'unassigned' },
      reactor_user: null,
    };
  });
}
export interface TargetedProposalLike { home: Home; eventId: string; summary: string; detail?: string; sourceQuote?: string; sourceTs: string; planKind?: PlanKind }

// Normalize a person name for matching against the People list: trim, lowercase, collapse whitespace.
export function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

// Split extracted people into those with a clear name-match in the People list and those without.
// Dedups by normalized name (a person named in several messages in one scrape → one entry, first seen).
// `attendees` is the existing People list (id + name). Match is exact case-insensitive on normalized name.
export function matchPeople(
  people: ScrapePerson[], attendees: { id: string; name: string }[],
): { matched: { person: ScrapePerson; attendeeId: string }[]; unmatched: ScrapePerson[] } {
  const byName = new Map<string, string>();
  for (const a of attendees) if (a.name) byName.set(normalizeName(a.name), a.id);
  const seen = new Set<string>();
  const matched: { person: ScrapePerson; attendeeId: string }[] = [];
  const unmatched: ScrapePerson[] = [];
  for (const p of people) {
    const key = normalizeName(p.name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const id = byName.get(key);
    if (id) matched.push({ person: p, attendeeId: id });
    else unmatched.push(p);
  }
  return { matched, unmatched };
}

// The comment we leave on a matched candidate: their interest, the quoted message, and a link back to it.
export function candidateNote(person: ScrapePerson, permalink: string | null): string {
  const parts: string[] = [];
  if (person.note) parts.push(person.note);
  if (person.sourceQuote) parts.push(`“${person.sourceQuote}”`);
  if (permalink) parts.push(`— via Slack: ${permalink}`);
  return parts.join('\n');
}

// Unmatched people → stored 'people' captures for the People-page "no match" section. Keyed on the
// person's source message ts + name slug so re-scraping is idempotent. summary=name, detail=note,
// flags carries the linkedin + a noMatch marker; source_ref holds the permalink when resolved.
export function buildPeopleNoMatch(
  event: EventRow, channel: string, people: ScrapePerson[], permalinks: Record<string, string | null> = {},
): StoredCapture[] {
  return people.filter((p) => p.name?.trim() && p.sourceTs).map((p) => ({
    id: `${captureId(event.id, channel, p.sourceTs, 'people')}:${summarySlug(p.name)}`,
    event_id: event.id, series_id: null, slack_channel: channel, slack_ts: p.sourceTs, home: 'people',
    summary: p.name.trim(), detail: p.note?.trim() || null, status: 'proposed' as const,
    source_ref: permalinks[p.sourceTs] ?? null, source_quote: p.sourceQuote?.trim() || null, context_ts: null,
    flags: { noMatch: true, ...(p.linkedin ? { linkedin: p.linkedin } : {}) }, reactor_user: null,
  }));
}

// Which events warrant a "drop the transcript" nudge now: the meeting has happened (event_date is on
// or before today) and we haven't nudged for it yet. `today` is an ISO date (YYYY-MM-DD).
export interface NudgeEvent { id: string; name: string; event_date: string | null; transcript_nudged_at: string | null }
export function meetingsToNudge(events: NudgeEvent[], today: string): NudgeEvent[] {
  return events.filter((e) => e.event_date && e.event_date <= today && !e.transcript_nudged_at);
}

// The channel prompt inviting a transcript for a meeting that happened — pasted text gets ingested by
// the scrape and attributed to this event.
export function transcriptNudgeText(name: string, date: string | null): string {
  const when = date ? ` (${date})` : '';
  return `📝 *${name}*${when} has wrapped — drop the recording link, transcript, or notes here (from Fathom, Granola, Zoom, anywhere) and I'll log them to the event. Paste the text right in this channel.`;
}

// ≤6-line reactor-only summary, grouped by home so a misroute is spottable at a glance.
export function composeEphemeral(eventName: string, eventUrl: string, caps: StoredCapture[], removals: Removal[], radiusNote?: string): string {
  if (caps.length === 0 && removals.length === 0) {
    return `✦ Nothing to capture from that one. Pin a message where something's decided or asked for.`;
  }
  const lines = [`✦ Captured to *${eventName}* — proposed. Review in EventHub.`];
  for (const home of HOME_ORDER) {
    const group = caps.filter((c) => c.home === home);
    if (!group.length) continue;
    const flagged = group.some((c) => (c.flags as any).conflict || (c.flags as any).ambiguity);
    const count = flagged ? 'flagged' : `+${group.length}`;
    const labels = group.map((c) => c.summary).join('; ');
    lines.push(`   ${HOME_LABEL[home].padEnd(11)}${count.padEnd(9)}${labels}`);
  }
  if (removals.length) lines.push(`   ↳ dropped: ${removals.map((r) => r.label).join(', ')}`);
  if (radiusNote) lines.push(`   ${radiusNote}`);
  const amb = caps.map((c) => (c.flags as any).ambiguity).filter(Boolean);
  if (amb.length) lines.push(`   ⚠ wasn't sure: ${amb.join('; ')}`);
  lines.push(`   <${eventUrl}|Open ${eventName} in EventHub →>`);
  return lines.join('\n');
}

// Fuzzy-match dropped labels against existing capture summaries → the ids to dismiss. No match → skip.
export function matchRemovals(existing: { id: string; summary: string }[], removals: Removal[]): string[] {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 2);
  const out: string[] = [];
  for (const r of removals) {
    const rw = norm(r.label);
    if (!rw.length) continue;
    const hit = existing.find((e) => { const ew = new Set(norm(e.summary)); return rw.some((w) => ew.has(w)); });
    if (hit) out.push(hit.id);
  }
  return out;
}
