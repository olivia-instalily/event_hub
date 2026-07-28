// cloud-functions/src/functions/slack-events.ts
// Slack Events API receiver (POST /functions/v1/slack-events). Public — Slack can't auth through
// any gate, so the signing-secret check IS the security boundary. Mirrors slack-interactions:
// registered with express.raw() BEFORE express.json() so the signature verifies over the raw body.
import { Request, Response } from 'express';
import { verifySlackSignature } from '../lib/slack.js';
import { getServiceClient } from '../db.js';
import { fetchContext, getPermalink, postEphemeral } from '../lib/slack-api.js';
import { extractCaptures } from './slack-extract.js';
import { resolveEvent, contextBounds, buildCaptures, composeEphemeral, matchRemovals, type EventRow } from './slack-capture-lib.js';

export interface SlackEventDecision {
  status: number;
  body: string;     // response payload (the challenge, or empty)
  event?: any;      // the inner event to process after acking, when present
}

// Pure routing decision — no I/O, so it's unit-testable. `nowMs` is injectable for tests.
export function routeSlackEvent(
  rawBody: string,
  headers: { timestamp?: string; signature?: string },
  secret: string,
  nowMs?: number,
): SlackEventDecision {
  if (!verifySlackSignature(rawBody, headers.timestamp, headers.signature, secret, nowMs)) {
    return { status: 401, body: 'bad signature' };
  }
  let payload: any;
  try { payload = JSON.parse(rawBody); } catch { return { status: 400, body: 'bad payload' }; }

  // Events API setup handshake — echo the challenge so Slack can verify the endpoint.
  if (payload.type === 'url_verification') return { status: 200, body: String(payload.challenge ?? '') };
  // Real event — ack fast, hand the inner event to async processing.
  if (payload.type === 'event_callback') return { status: 200, body: '', event: payload.event };
  return { status: 200, body: '' }; // ack anything else so Slack doesn't retry-storm
}

export async function handler(req: Request, res: Response) {
  const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : String(req.body ?? '');
  const decision = routeSlackEvent(
    raw,
    { timestamp: req.header('x-slack-request-timestamp'), signature: req.header('x-slack-signature') },
    process.env.SLACK_SIGNING_SECRET ?? '',
  );
  const ev = decision.event;
  // Diagnostic (BEFORE the ack, so it flushes during the request even under CPU throttling).
  if (ev) console.log(JSON.stringify({ fn: 'slack-events', op: 'event', type: ev.type, reaction: ev.reaction, item: ev.item?.type, channel: ev.item?.channel }));
  // Ack within Slack's 3s window before doing any work.
  res.status(decision.status).send(decision.body);

  // Un-react is a NO-OP (removal is ambiguous; misfires are handled by dismiss on the event page).
  if (ev?.type === 'reaction_added' && ev?.reaction === 'eventhub' && ev?.item?.type === 'message') {
    onReactionAdded(ev).catch((e) => console.error(JSON.stringify({ fn: 'slack-events', error: String((e as Error)?.message ?? e) })));
  }
}

const APP_URL = 'https://eventhub-licvsmaspa-uc.a.run.app';

// event shape: { type:'reaction_added', user, reaction, item:{ type:'message', channel, ts, thread_ts? }, event_ts }
async function onReactionAdded(event: any) {
  const channel: string = event.item.channel;
  const ts: string = event.item.ts;
  const reactor: string = event.user;
  const sb = getServiceClient();

  const { data: events } = await sb.from('event').select('id, name, event_date, slack_channel').eq('slack_channel', channel);
  const target = resolveEvent((events ?? []) as EventRow[], channel);
  if (!target) { await postEphemeral(channel, reactor, "This channel isn't linked to an EventHub event yet — link it from the event, then re-pin."); return; }

  const raw = await fetchContext(channel, ts, event.item.thread_ts);
  const windowMsgs = contextBounds(raw, ts);
  const { captures, removals, radiusNote } = await extractCaptures(ts, windowMsgs);
  // Diagnostic: what the extraction actually produced (empty result here = the miss to investigate).
  console.log(JSON.stringify({ fn: 'slack-events', op: 'extracted', event_id: target.id, window: windowMsgs.length, captures: captures.length, homes: captures.map((c) => c.home), removals: removals.length }));

  const permalink = await getPermalink(channel, ts);
  const { data: budgetRows } = await sb.from('budget_line').select('id').eq('event_id', target.id).limit(1);
  const caps = buildCaptures(target, channel, ts, reactor, permalink, captures, { budget: (budgetRows?.length ?? 0) > 0 });
  if (caps.length) await sb.from('slack_capture').upsert(caps, { onConflict: 'id' });

  // Removals: fuzzy-match dropped things against this event's existing captures → mark dismissed.
  if (removals.length) {
    const { data: existing } = await sb.from('slack_capture').select('id, summary').eq('event_id', target.id).eq('status', 'proposed');
    const ids = matchRemovals((existing ?? []) as { id: string; summary: string }[], removals);
    if (ids.length) await sb.from('slack_capture').update({ status: 'dismissed' }).in('id', ids);
  }

  const url = `${APP_URL}/?event=${encodeURIComponent(target.id)}`;
  await postEphemeral(channel, reactor, composeEphemeral(target.name ?? 'the event', url, caps, removals, radiusNote));
}
