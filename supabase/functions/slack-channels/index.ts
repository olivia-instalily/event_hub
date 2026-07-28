// DUAL-MAINTAINED: any changes here must also be made in
// cloud-functions/src/functions/slack-channels.ts
// Edge function: list the Slack channels the bot can post to (the ones it's a member of), so the
// scoping form can offer a by-name picker instead of a raw channel ID. Holds the bot token
// server-side; the browser never sees it.
//
// POST {} → { ok, channels: [{ id, name }] }

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

async function paginate(token: string, method: string, params: Record<string, string>, onPage: (channels: any[]) => void): Promise<void> {
  let cursor: string | undefined;
  do {
    const url = new URL(`https://slack.com/api/${method}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    url.searchParams.set('limit', '200');
    if (cursor) url.searchParams.set('cursor', cursor);
    const r = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
    const data = await r.json();
    if (!data.ok) throw new Error(`Slack: ${data.error ?? 'unknown error'}`);
    onPage(data.channels ?? []);
    cursor = data.response_metadata?.next_cursor || undefined;
  } while (cursor);
}

async function listChannels(token: string): Promise<{ id: string; name: string; isMember: boolean }[]> {
  const out = new Map<string, { id: string; name: string; isMember: boolean }>();
  await paginate(token, 'conversations.list', { types: 'public_channel', exclude_archived: 'true' },
    (chs) => { for (const c of chs) out.set(c.id, { id: c.id, name: c.name, isMember: !!c.is_member }); });
  await paginate(token, 'users.conversations', { types: 'private_channel', exclude_archived: 'true' },
    (chs) => { for (const c of chs) out.set(c.id, { id: c.id, name: c.name, isMember: true }); });
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  try {
    const token = Deno.env.get('SLACK_BOT_TOKEN');
    if (!token) return json({ error: 'SLACK_BOT_TOKEN not configured on the server.' }, 500);
    const channels = await listChannels(token);
    return json({ ok: true, channels });
  } catch (e) {
    console.error(JSON.stringify({ fn: 'slack-channels', error: String((e as Error)?.message ?? e) }));
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});
