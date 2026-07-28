// cloud-functions/src/functions/slack-events.ts
// Slack Events API receiver (POST /functions/v1/slack-events). Public — Slack can't auth through
// any gate, so the signing-secret check IS the security boundary. Mirrors slack-interactions:
// registered with express.raw() BEFORE express.json() so the signature verifies over the raw body.
import { Request, Response } from 'express';
import { verifySlackSignature } from '../lib/slack.js';
import { getServiceClient } from '../db.js';
import { fetchContext, getPermalink, postEphemeral } from '../lib/slack-api.js';
import { extractCaptures } from './slack-extract.js';
import { resolveEvent, contextBounds, buildCaptures, composeEphemeral, type EventRow } from './slack-capture-lib.js';

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
  // Ack within Slack's 3s window before doing any work.
  res.status(decision.status).send(decision.body);

  const ev = decision.event;
  // Diagnostic: surface what Slack actually sent so an emoji-name/type mismatch is visible in logs.
  if (ev) console.log(JSON.stringify({ fn: 'slack-events', op: 'event', type: ev.type, reaction: ev.reaction, item: ev.item?.type, channel: ev.item?.channel }));
  if (ev?.reaction === 'eventhub' && ev?.item?.type === 'message') {
    const work = ev.type === 'reaction_added' ? onReactionAdded(ev)
      : ev.type === 'reaction_removed' ? onReactionRemoved(ev)
      : null;
    if (work) work.catch((e) => console.error(JSON.stringify({ fn: 'slack-events', error: String((e as Error)?.message ?? e) })));
  }
}

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
  const proposals = await extractCaptures(ts, windowMsgs);
  if (proposals.length === 0) { await postEphemeral(channel, reactor, `Pinned to *${target.name}*, but I couldn't pull a clear update from the thread — open it in EventHub to add one.`); return; }

  const permalink = await getPermalink(channel, ts);
  const { data: budgetRows } = await sb.from('budget_line').select('id').eq('event_id', target.id).limit(1);
  const caps = buildCaptures(target, channel, ts, reactor, permalink, proposals, { budget: (budgetRows?.length ?? 0) > 0 });

  await sb.from('slack_capture').upsert(caps, { onConflict: 'id' });
  await postEphemeral(channel, reactor, composeEphemeral(target.name ?? 'the event', caps));
}

// Un-react = undo: delete every capture for this pin, restoring pre-pin state (idempotent).
async function onReactionRemoved(event: any) {
  const channel: string = event.item.channel;
  const ts: string = event.item.ts;
  const sb = getServiceClient();
  await sb.from('slack_capture').delete().eq('slack_channel', channel).eq('slack_ts', ts);
}
