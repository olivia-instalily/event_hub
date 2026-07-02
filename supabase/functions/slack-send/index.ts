// Edge function: post a message to Slack via chat.postMessage. Runs server-side — holds the
// bot token; the browser never sees it.
//
// POST { channel: string, text: string }  → { ok, channel, ts }
// `channel` is a channel ID (e.g. C0123…) the bot has been invited to (preferred), or a name.

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  try {
    const { channel, text } = await req.json();
    if (!channel || !text) return json({ error: 'channel and text are required' }, 400);

    const token = Deno.env.get('SLACK_BOT_TOKEN');
    if (!token) return json({ error: 'SLACK_BOT_TOKEN not configured on the server.' }, 500);

    const res = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ channel, text }),
    });
    const data = await res.json();
    if (!data.ok) return json({ error: `Slack: ${data.error ?? 'unknown error'}` }, 502);
    return json({ ok: true, channel: data.channel, ts: data.ts });
  } catch (e) {
    console.error(JSON.stringify({ fn: "slack-send", error: String((e as Error)?.message ?? e) }));
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});
