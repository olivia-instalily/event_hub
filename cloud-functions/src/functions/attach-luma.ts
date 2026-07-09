// DUAL-MAINTAINED: any changes here must also be made in
// supabase/functions/attach-luma/index.ts
import { Request, Response } from 'express';
import { getServiceClient } from '../db.js';

function slugOf(raw: string): string | null {
  try {
    const u = new URL(raw.trim());
    return u.pathname.split('/').filter(Boolean).pop()?.toLowerCase() ?? null;
  } catch { return null; }
}

async function findLumaEventBySlug(apiKey: string, slug: string) {
  let cursor: string | undefined;
  do {
    const url = new URL('https://public-api.luma.com/v1/calendar/list-events');
    url.searchParams.set('pagination_limit', '100');
    if (cursor) url.searchParams.set('pagination_cursor', cursor);
    const res = await fetch(url, { headers: { 'x-luma-api-key': apiKey, accept: 'application/json' } });
    if (!res.ok) throw new Error(`Luma list-events ${res.status}: ${await res.text()}`);
    const data = await res.json() as any;
    const entries = data.entries ?? data.data ?? [];
    for (const entry of entries) {
      const ev = entry.event ?? entry;
      if (ev.url && slugOf(ev.url) === slug) {
        return { id: ev.api_id ?? ev.id, name: ev.name ?? null, cover_url: ev.cover_url ?? null, url: ev.url };
      }
    }
    cursor = data.has_more ? (data.next_cursor ?? data.pagination_cursor) : undefined;
  } while (cursor);
  return null;
}

export async function handler(req: Request, res: Response) {
  try {
    const { eventId, url } = req.body;
    if (!eventId || !url) { res.status(400).json({ error: 'eventId and url are required' }); return; }

    const slug = slugOf(url);
    if (!slug) { res.status(400).json({ error: 'Could not parse that URL.' }); return; }

    const lumaKey = process.env.LUMA_API_KEY;
    if (!lumaKey) { res.status(500).json({ error: 'LUMA_API_KEY not configured on the server.' }); return; }

    const match = await findLumaEventBySlug(lumaKey, slug);
    if (!match) { res.status(404).json({ error: 'No Luma event on this calendar matches that link.' }); return; }

    const sb = getServiceClient();
    const { error } = await sb.from('event')
      .update({ luma_event_id: match.id, cover_image_url: match.cover_url, luma_cover_url: match.cover_url, luma_url: match.url, luma_name: match.name })
      .eq('id', eventId);
    if (error) { res.status(500).json({ error: error.message }); return; }

    res.json({ ok: true, lumaEventId: match.id, name: match.name, coverImageUrl: match.cover_url, lumaUrl: match.url });
  } catch (e) {
    console.error(JSON.stringify({ fn: 'attach-luma', error: String((e as Error)?.message ?? e) }));
    res.status(500).json({ error: String((e as Error)?.message ?? e) });
  }
}
