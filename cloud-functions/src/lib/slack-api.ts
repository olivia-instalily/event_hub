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

// Messages strictly AFTER oldestTs (or the most recent `cap` when no marker yet), chronological.
// Paginates conversations.history; caps total so a first scrape of a huge channel stays bounded.
export async function fetchSince(channel: string, oldestTs: string | null, cap = 200): Promise<SlackMsg[]> {
  const raw: any[] = [];
  let cursor: string | undefined;
  do {
    const params: Record<string, string> = { channel, limit: '200' };
    if (oldestTs) params.oldest = oldestTs;
    if (cursor) params.cursor = cursor;
    const r = await api('conversations.history', params);
    if (!r.ok) { console.error(JSON.stringify({ fn: 'slack-api', op: 'fetchSince', error: r.error })); break; }
    raw.push(...(r.messages ?? []));
    cursor = r.response_metadata?.next_cursor || undefined;
  } while (cursor && raw.length < cap);
  return raw
    .filter((m: any) => m.type === 'message' && !m.subtype && m.text && (!oldestTs || Number(m.ts) > Number(oldestTs)))
    .map((m: any) => ({ ts: m.ts, text: m.text ?? '', user: m.user, thread_ts: m.thread_ts }))
    .sort((a, b) => Number(a.ts) - Number(b.ts))
    .slice(-cap);
}

export async function getPermalink(channel: string, ts: string): Promise<string | null> {
  const r = await api('chat.getPermalink', { channel, message_ts: ts });
  return r.ok ? r.permalink : null;
}

// Post a normal channel message (used for the "drop the transcript" nudge). Returns the ts, or null.
export async function postMessage(channel: string, text: string): Promise<string | null> {
  const r = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`, 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ channel, text }),
  });
  const j = await r.json() as any;
  if (!j.ok) { console.error(JSON.stringify({ fn: 'slack-api', op: 'postMessage', error: j.error })); return null; }
  return j.ts as string;
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

// Reply to a slash command / interaction via its response_url (no bot token needed; valid ~30 min,
// up to 5 responses). response_type 'ephemeral' → only the invoking user sees it; 'in_channel' → all.
export async function postToResponseUrl(responseUrl: string, text: string, responseType: 'ephemeral' | 'in_channel' = 'ephemeral'): Promise<void> {
  const r = await fetch(responseUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ response_type: responseType, text }),
  });
  if (!r.ok) console.error(JSON.stringify({ fn: 'slack-api', op: 'postToResponseUrl', status: r.status }));
}
