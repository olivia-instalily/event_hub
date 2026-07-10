// DUAL-MAINTAINED: any changes here must also be made in
// supabase/functions/slack-channels/index.ts
import { Request, Response } from 'express';

// List the Slack channels the bot can post to (the ones it's a member of), so the scoping form can
// offer a by-name picker instead of a raw channel ID. Uses the bot token server-side.
//
// POST {} → { ok, channels: [{ id, name }] }
export async function handler(_req: Request, res: Response) {
  try {
    const token = process.env.SLACK_BOT_TOKEN;
    if (!token) { res.status(500).json({ error: 'SLACK_BOT_TOKEN not configured on the server.' }); return; }
    const channels = await listBotChannels(token);
    res.json({ ok: true, channels });
  } catch (e) {
    console.error(JSON.stringify({ fn: 'slack-channels', error: String((e as Error)?.message ?? e) }));
    res.status(500).json({ error: String((e as Error)?.message ?? e) });
  }
}

async function listBotChannels(token: string): Promise<{ id: string; name: string }[]> {
  const out: { id: string; name: string }[] = [];
  let cursor: string | undefined;
  do {
    const url = new URL('https://slack.com/api/users.conversations');
    url.searchParams.set('types', 'public_channel,private_channel');
    url.searchParams.set('exclude_archived', 'true');
    url.searchParams.set('limit', '200');
    if (cursor) url.searchParams.set('cursor', cursor);
    const r = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
    const data = await r.json() as any;
    if (!data.ok) throw new Error(`Slack: ${data.error ?? 'unknown error'}`);
    for (const c of data.channels ?? []) out.push({ id: c.id as string, name: c.name as string });
    cursor = data.response_metadata?.next_cursor || undefined;
  } while (cursor);
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}
