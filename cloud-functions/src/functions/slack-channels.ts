// DUAL-MAINTAINED: any changes here must also be made in
// supabase/functions/slack-channels/index.ts
import { Request, Response } from 'express';

// Channels for the by-name picker. Lists EVERY public channel (the bot need not be a member —
// it can auto-join on pick, see slack-link-channel) plus the private channels the bot is already
// in (private ones it isn't in are invisible to the API). Uses the bot token server-side.
// Needs scopes: channels:read (public list) + groups:read/history for the bot's private channels.
//
// POST {} → { ok, channels: [{ id, name, isMember }] }
export async function handler(_req: Request, res: Response) {
  try {
    const token = process.env.SLACK_BOT_TOKEN;
    if (!token) { res.status(500).json({ error: 'SLACK_BOT_TOKEN not configured on the server.' }); return; }
    const channels = await listChannels(token);
    res.json({ ok: true, channels });
  } catch (e) {
    console.error(JSON.stringify({ fn: 'slack-channels', error: String((e as Error)?.message ?? e) }));
    res.status(500).json({ error: String((e as Error)?.message ?? e) });
  }
}

async function paginate(token: string, method: string, params: Record<string, string>, onPage: (channels: any[]) => void): Promise<void> {
  let cursor: string | undefined;
  do {
    const url = new URL(`https://slack.com/api/${method}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    url.searchParams.set('limit', '200');
    if (cursor) url.searchParams.set('cursor', cursor);
    const r = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
    const data = await r.json() as any;
    if (!data.ok) throw new Error(`Slack: ${data.error ?? 'unknown error'}`);
    onPage(data.channels ?? []);
    cursor = data.response_metadata?.next_cursor || undefined;
  } while (cursor);
}

async function listChannels(token: string): Promise<{ id: string; name: string; isMember: boolean }[]> {
  const out = new Map<string, { id: string; name: string; isMember: boolean }>();
  // All public channels workspace-wide — searchable regardless of bot membership.
  await paginate(token, 'conversations.list', { types: 'public_channel', exclude_archived: 'true' },
    (chs) => { for (const c of chs) out.set(c.id, { id: c.id, name: c.name, isMember: !!c.is_member }); });
  // Private channels the bot is already in (the only private ones the API will reveal).
  await paginate(token, 'users.conversations', { types: 'private_channel', exclude_archived: 'true' },
    (chs) => { for (const c of chs) out.set(c.id, { id: c.id, name: c.name, isMember: true }); });
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
}
