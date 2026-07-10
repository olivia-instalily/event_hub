// cloud-functions/src/functions/slack-interactions.ts
import { Request, Response } from 'express';
import { verifySlackSignature } from '../lib/slack.js';

export async function handler(req: Request, res: Response) {
  const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : String(req.body ?? '');
  const secret = process.env.SLACK_SIGNING_SECRET;
  const ok = verifySlackSignature(raw, req.header('x-slack-request-timestamp'), req.header('x-slack-signature'), secret ?? '');
  if (!ok) { res.status(401).send('bad signature'); return; }

  let payload: any;
  try { payload = JSON.parse(new URLSearchParams(raw).get('payload') ?? '{}'); }
  catch { res.status(400).send('bad payload'); return; }

  try {
    if (payload.type === 'block_actions') { await onAction(payload, res); return; }
    if (payload.type === 'view_submission') { await onSubmit(payload, res); return; }
    res.status(200).send(''); // ignore other interaction types
  } catch (e) {
    console.error(JSON.stringify({ fn: 'slack-interactions', error: String((e as Error)?.message ?? e) }));
    res.status(200).send(''); // ack even on error so Slack doesn't retry-storm; logged above
  }
}

// onAction / onSubmit are added in Tasks 4 and 5.
async function onAction(_payload: any, res: Response) { res.status(200).send(''); }
async function onSubmit(_payload: any, res: Response) { res.status(200).send(''); }
