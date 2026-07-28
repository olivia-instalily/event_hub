import { Request, Response } from 'express';
import { getServiceClient } from '../db.js';

const slackGet = async (method: string, params: Record<string, string>) => {
  const r = await fetch(`https://slack.com/api/${method}?${new URLSearchParams(params)}`, {
    headers: { authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}` },
  });
  return await r.json() as any;
};
const slackPost = async (method: string, body: unknown) => {
  const r = await fetch(`https://slack.com/api/${method}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`, 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
  });
  return await r.json() as any;
};

// POST { eventId, channelId } (link/clear; channelId may be null) OR { eventId, create: { name } }.
export async function handler(req: Request, res: Response) {
  try {
    const { eventId, channelId, create } = req.body ?? {};
    if (!eventId) { res.status(400).json({ error: 'eventId required' }); return; }
    const sb = getServiceClient();
    let id: string | null = channelId ?? null;
    let name = '';
    const skipped: string[] = [];

    if (create?.name) {
      const c = await slackPost('conversations.create', { name: create.name, is_private: true });
      if (!c.ok) { res.status(400).json({ error: c.error ?? 'create failed' }); return; } // e.g. name_taken
      id = c.channel.id; name = c.channel.name;

      // Invite the event's owners by email (best-effort; unresolved ones are skipped, not fatal).
      const { data: owners } = await sb.from('event_owner').select('profile:profile ( name, email )').eq('event_id', eventId);
      const users: string[] = [];
      for (const o of (owners ?? []) as any[]) {
        const email = o.profile?.email;
        if (!email) { if (o.profile?.name) skipped.push(o.profile.name); continue; }
        const u = await slackGet('users.lookupByEmail', { email });
        if (u.ok && u.user?.id) users.push(u.user.id);
        else skipped.push(o.profile?.name ?? email);
      }
      if (users.length) {
        const inv = await slackPost('conversations.invite', { channel: id, users: users.join(',') });
        if (!inv.ok) console.error(JSON.stringify({ fn: 'slack-link-channel', op: 'invite', error: inv.error }));
      }
    } else if (id) {
      // Linking an EXISTING channel → make sure the bot is a member so it receives events.
      // Public channels: conversations.join adds the bot. Private channels can't be joined via the API
      // at all (method_not_supported_for_channel_type) — but they only surface in the picker when the
      // bot is ALREADY a member, so treat that (and already_in_channel) as fine and just link.
      const j = await slackPost('conversations.join', { channel: id });
      const okish = j.ok || j.error === 'already_in_channel' || j.error === 'method_not_supported_for_channel_type';
      if (!okish) { res.status(400).json({ error: j.error ?? 'join failed' }); return; }
    }

    // Set (or clear) the link with the service role.
    const { error } = await sb.from('event').update({ slack_channel: id }).eq('id', eventId);
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.json({ ok: true, id, name, skipped });
  } catch (e) {
    console.error(JSON.stringify({ fn: 'slack-link-channel', error: String((e as Error)?.message ?? e) }));
    res.status(500).json({ error: String((e as Error)?.message ?? e) });
  }
}
