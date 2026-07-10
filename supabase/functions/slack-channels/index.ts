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
    const data = await r.json();
    if (!data.ok) throw new Error(`Slack: ${data.error ?? 'unknown error'}`);
    for (const c of data.channels ?? []) out.push({ id: c.id as string, name: c.name as string });
    cursor = data.response_metadata?.next_cursor || undefined;
  } while (cursor);
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  try {
    const token = Deno.env.get('SLACK_BOT_TOKEN');
    if (!token) return json({ error: 'SLACK_BOT_TOKEN not configured on the server.' }, 500);
    const channels = await listBotChannels(token);
    return json({ ok: true, channels });
  } catch (e) {
    console.error(JSON.stringify({ fn: 'slack-channels', error: String((e as Error)?.message ?? e) }));
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});
