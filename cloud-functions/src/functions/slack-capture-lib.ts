export type CaptureType = 'note' | 'status' | 'debrief' | 'people' | 'budget' | 'vendor' | 'other';
export interface SlackMsg { ts: string; text: string; user?: string; thread_ts?: string }
export interface EventRow { id: string; name?: string; event_date?: string | null; slack_channel?: string | null }
export interface Proposal { type: CaptureType; payload: any; confidence?: number; contextTs?: { first: string; last: string }; ambiguity?: { question: string } }
export interface StoredCapture {
  id: string; event_id: string; slack_channel: string; slack_ts: string; type: CaptureType;
  payload: any; status: 'proposed'; confidence: number | null; source_ref: string | null;
  context_ts: any; flags: Record<string, unknown>; reactor_user: string | null;
}

export const CTX_BEFORE = 20, CTX_AFTER = 5, CTX_MAX = 30, CTX_MAX_SPAN_MS = 3 * 60 * 60 * 1000;

export function captureId(eventId: string, channel: string, ts: string, type: CaptureType): string {
  return `${eventId}:${channel}:${ts}:${type}`;
}

// Event linked to this channel; when several share it, the most recent by event_date wins.
export function resolveEvent(events: EventRow[], channelId: string): EventRow | null {
  const linked = events.filter((e) => e.slack_channel === channelId);
  if (linked.length === 0) return null;
  if (linked.length === 1) return linked[0];
  return [...linked].sort((a, b) => String(b.event_date ?? '').localeCompare(String(a.event_date ?? '')))[0];
}

// Trim a fetched window to the cap: within CTX_MAX_SPAN_MS of the pin, at most CTX_MAX messages,
// always keeping the pin, biased backward. Slack ts is "<epoch-seconds>.<seq>".
export function contextBounds(msgs: SlackMsg[], pinnedTs: string, now: number = Date.now()): SlackMsg[] {
  void now;
  const pinSec = Number(pinnedTs);
  const withinSpan = msgs.filter((m) => Math.abs(Number(m.ts) - pinSec) * 1000 <= CTX_MAX_SPAN_MS);
  const sorted = [...withinSpan].sort((a, b) => Number(a.ts) - Number(b.ts));
  if (sorted.length <= CTX_MAX) return sorted;
  const pinIdx = sorted.findIndex((m) => m.ts === pinnedTs);
  const start = Math.max(0, Math.min(pinIdx - CTX_BEFORE, sorted.length - CTX_MAX));
  return sorted.slice(start, start + CTX_MAX);
}

export function detectConflict(p: Proposal, committed: { budget?: boolean }): { field: string } | null {
  if (p.type === 'budget' && committed.budget) return { field: 'budget' };
  return null;
}

export function buildCaptures(
  event: EventRow, channel: string, pinnedTs: string, reactor: string | null,
  sourceRef: string | null, proposals: Proposal[], committed: { budget?: boolean },
): StoredCapture[] {
  return proposals.map((p) => {
    const conflict = detectConflict(p, committed);
    const flags: Record<string, unknown> = {};
    if (p.ambiguity) flags.ambiguity = p.ambiguity;
    if (conflict) flags.conflict = conflict;
    return {
      id: captureId(event.id, channel, pinnedTs, p.type),
      event_id: event.id, slack_channel: channel, slack_ts: pinnedTs, type: p.type,
      payload: p.payload, status: 'proposed' as const, confidence: p.confidence ?? null,
      source_ref: sourceRef, context_ts: p.contextTs ?? null, flags, reactor_user: reactor,
    };
  });
}

export function composeEphemeral(eventName: string, caps: StoredCapture[]): string {
  const lines = [`Captured to *${eventName}* (proposed — edit or dismiss in EventHub):`];
  for (const c of caps) {
    lines.push(`• ${c.type}: ${summarize(c.payload)}`);
    const f = c.flags as any;
    if (f.ambiguity?.question) lines.push(`   ↳ ${f.ambiguity.question}`);
    if (f.conflict?.field) lines.push(`   ↳ ${f.conflict.field} already set — landed as proposed, won't overwrite.`);
  }
  return lines.join('\n');
}

function summarize(payload: any): string {
  if (payload?.text) return String(payload.text).slice(0, 80);
  return Object.entries(payload ?? {}).map(([k, v]) => `${k}=${v}`).join(', ').slice(0, 80);
}
