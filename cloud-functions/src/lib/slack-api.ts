import type { SlackMsg } from '../functions/slack-capture-lib.js';
import { CTX_BEFORE, CTX_AFTER } from '../functions/slack-capture-lib.js';

const api = async (method: string, params: Record<string, string>) => {
  const url = `https://slack.com/api/${method}?${new URLSearchParams(params)}`;
  const r = await fetch(url, { headers: { authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}` } });
  return await r.json() as any;
};

// Thread → whole thread; else a window around the pin (biased backward). Caller trims via contextBounds.
export async function fetchContext(channel: string, ts: string, threadTs: string | undefined): Promise<SlackMsg[]> {
  if (threadTs) {
    const r = await api('conversations.replies', { channel, ts: threadTs, limit: '100' });
    return (r.messages ?? []).map((m: any) => ({ ts: m.ts, text: m.text ?? '', user: m.user, thread_ts: m.thread_ts }));
  }
  const before = await api('conversations.history', { channel, latest: ts, inclusive: 'true', limit: String(CTX_BEFORE + 1) });
  const after = await api('conversations.history', { channel, oldest: ts, inclusive: 'false', limit: String(CTX_AFTER) });
  const merged = [...(before.messages ?? []), ...(after.messages ?? [])];
  return merged.map((m: any) => ({ ts: m.ts, text: m.text ?? '', user: m.user, thread_ts: m.thread_ts }));
}

export async function getPermalink(channel: string, ts: string): Promise<string | null> {
  const r = await api('chat.getPermalink', { channel, message_ts: ts });
  return r.ok ? r.permalink : null;
}

export async function postEphemeral(channel: string, user: string, text: string): Promise<void> {
  const r = await fetch('https://slack.com/api/chat.postEphemeral', {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`, 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ channel, user, text }),
  });
  const j = await r.json() as any;
  if (!j.ok) console.error(JSON.stringify({ fn: 'slack-api', op: 'postEphemeral', error: j.error }));
}
