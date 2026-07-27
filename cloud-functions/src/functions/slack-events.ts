// cloud-functions/src/functions/slack-events.ts
// Slack Events API receiver (POST /functions/v1/slack-events). Public — Slack can't auth through
// any gate, so the signing-secret check IS the security boundary. Mirrors slack-interactions:
// registered with express.raw() BEFORE express.json() so the signature verifies over the raw body.
import { Request, Response } from 'express';
import { verifySlackSignature } from '../lib/slack.js';
import { getServiceClient } from '../db.js';

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

  if (decision.event?.type === 'reaction_added') {
    try { await onReactionAdded(decision.event); }
    catch (e) { console.error(JSON.stringify({ fn: 'slack-events', error: String((e as Error)?.message ?? e) })); }
  }
}

// event shape: { type:'reaction_added', user, reaction, item:{ type:'message', channel, ts }, event_ts }
async function onReactionAdded(event: any) {
  const reaction: string = event.reaction;
  const channel: string | undefined = event.item?.channel;
  const messageTs: string | undefined = event.item?.ts;
  // Logged so the end-to-end flow is visible in Cloud Run logs; the DB client is ready for the
  // business rule (e.g. map an emoji + message to an event/action) once that's specified.
  void getServiceClient;
  console.log(JSON.stringify({ fn: 'slack-events', op: 'reaction_added', reaction, channel, messageTs, user: event.user }));
}
