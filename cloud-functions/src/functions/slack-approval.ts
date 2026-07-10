// cloud-functions/src/functions/slack-approval.ts
import { Request, Response } from 'express';

export async function handler(req: Request, res: Response) {
  try {
    const { channel, eventId, summary, link, requestedAmount } = req.body ?? {};
    if (!channel || !eventId) { res.status(400).json({ error: 'channel and eventId are required' }); return; }
    const token = process.env.SLACK_BOT_TOKEN;
    if (!token) { res.status(500).json({ error: 'SLACK_BOT_TOKEN not configured' }); return; }

    const blocks = [
      { type: 'section', text: { type: 'mrkdwn', text: String(summary || `Budget request for event ${eventId}`) } },
      { type: 'actions', elements: [
        { type: 'button', style: 'primary', text: { type: 'plain_text', text: 'Approve' }, action_id: 'approve', value: String(eventId) },
        { type: 'button', style: 'danger', text: { type: 'plain_text', text: 'Decline' }, action_id: 'decline', value: String(eventId) },
        ...(link ? [{ type: 'button', text: { type: 'plain_text', text: 'Open in EventHub' }, url: String(link) }] : []),
      ] },
    ];
    const r = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ channel, text: `Budget request${requestedAmount != null ? ` — $${requestedAmount}` : ''}`, blocks }),
    });
    const data = await r.json() as any;
    if (!data.ok) { res.status(502).json({ error: `Slack: ${data.error ?? 'unknown error'}` }); return; }
    res.json({ ok: true, channel: data.channel, ts: data.ts });
  } catch (e) {
    console.error(JSON.stringify({ fn: 'slack-approval', error: String((e as Error)?.message ?? e) }));
    res.status(500).json({ error: String((e as Error)?.message ?? e) });
  }
}
