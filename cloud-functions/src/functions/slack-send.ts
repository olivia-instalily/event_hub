// DUAL-MAINTAINED: any changes here must also be made in
// supabase/functions/slack-send/index.ts
import { Request, Response } from 'express';

export async function handler(req: Request, res: Response) {
  try {
    const { channel, text } = req.body;
    if (!channel || !text) { res.status(400).json({ error: 'channel and text are required' }); return; }

    const token = process.env.SLACK_BOT_TOKEN;
    if (!token) { res.status(500).json({ error: 'SLACK_BOT_TOKEN not configured on the server.' }); return; }

    const r = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ channel, text }),
    });
    const data = await r.json() as any;
    if (!data.ok) { res.status(502).json({ error: `Slack: ${data.error ?? 'unknown error'}` }); return; }
    res.json({ ok: true, channel: data.channel, ts: data.ts });
  } catch (e) {
    console.error(JSON.stringify({ fn: 'slack-send', error: String((e as Error)?.message ?? e) }));
    res.status(500).json({ error: String((e as Error)?.message ?? e) });
  }
}
