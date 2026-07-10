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

const slackApi = async (method: string, body: unknown) => {
  const r = await fetch(`https://slack.com/api/${method}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`, 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
  });
  return await r.json() as any;
};

async function onAction(payload: any, res: Response) {
  const action = payload.actions?.[0];
  const eventId = action?.value;
  const meta = JSON.stringify({ eventId, channel: payload.channel?.id, ts: payload.message?.ts });
  // Ack the button click immediately (empty 200) — the modal is opened via the trigger_id.
  res.status(200).send('');
  if (action?.action_id === 'approve') {
    await slackApi('views.open', { trigger_id: payload.trigger_id, view: {
      type: 'modal', callback_id: 'approve_modal', private_metadata: meta,
      title: { type: 'plain_text', text: 'Approve budget' },
      submit: { type: 'plain_text', text: 'Approve' },
      blocks: [{ type: 'input', block_id: 'amt', label: { type: 'plain_text', text: 'Assigned amount (USD)' },
        element: { type: 'number_input', is_decimal_allowed: false, action_id: 'value' } }],
    } });
  } else if (action?.action_id === 'decline') {
    await slackApi('views.open', { trigger_id: payload.trigger_id, view: {
      type: 'modal', callback_id: 'decline_modal', private_metadata: meta,
      title: { type: 'plain_text', text: 'Decline budget' },
      submit: { type: 'plain_text', text: 'Decline' },
      blocks: [{ type: 'input', block_id: 'reason', label: { type: 'plain_text', text: 'Reason (required)' },
        element: { type: 'plain_text_input', multiline: true, action_id: 'value' } }],
    } });
  }
}

// onSubmit is added in Task 5.
async function onSubmit(_payload: any, res: Response) { res.status(200).send(''); }
