// DUAL-MAINTAINED: any changes here must also be made in
// cloud-functions/src/functions/attach-luma.ts
// Edge function: attach a Luma event to an Assembly event from a pasted public link.
// Runs server-side — holds the Luma key, writes with the service role. The browser
// never sees the Luma key and can't write the DB directly.
//
// POST { eventId: string, url: string }
//  → resolves the link's slug against this calendar's Luma events,
//    stores luma_event_id + cover image, returns the resolved event.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

// last non-empty path segment, lowercased: https://luma.com/ttw-instalily → "ttw-instalily"
function slugOf(raw: string): string | null {
  try {
    const u = new URL(raw.trim());
    return u.pathname.split('/').filter(Boolean).pop()?.toLowerCase() ?? null;
  } catch {
    return null;
  }
}

async function findLumaEventBySlug(apiKey: string, slug: string) {
  let cursor: string | undefined;
  do {
    const url = new URL('https://public-api.luma.com/v1/calendar/list-events');
    url.searchParams.set('pagination_limit', '100');
    if (cursor) url.searchParams.set('pagination_cursor', cursor);
    const res = await fetch(url, { headers: { 'x-luma-api-key': apiKey, accept: 'application/json' } });
    if (!res.ok) throw new Error(`Luma list-events ${res.status}: ${await res.text()}`);
    const data = await res.json();
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  try {
    const { eventId, url, force } = await req.json();
    if (!eventId || !url) return json({ error: 'eventId and url are required' }, 400);

    const slug = slugOf(url);
    if (!slug) return json({ error: 'Could not parse that URL.' }, 400);

    const lumaKey = Deno.env.get('LUMA_API_KEY');
    if (!lumaKey) return json({ error: 'LUMA_API_KEY not configured on the server.' }, 500);

    const match = await findLumaEventBySlug(lumaKey, slug);
    if (!match) return json({ error: 'No Luma event on this calendar matches that link.' }, 404);

    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } },
    );
    // Guard: don't silently duplicate a Luma that's already another event — surface it (see Express twin).
    if (!force) {
      const { data: dupes } = await sb.from('event').select('id, name').eq('luma_event_id', match.id).neq('id', eventId).limit(1);
      if (dupes && dupes.length) return json({ conflict: { eventId: dupes[0].id, name: dupes[0].name ?? match.name } });
    }
    const { error } = await sb
      .from('event')
      .update({ luma_event_id: match.id, cover_image_url: match.cover_url, luma_cover_url: match.cover_url, luma_url: match.url, luma_name: match.name })
      .eq('id', eventId);
    if (error) return json({ error: error.message }, 500);

    return json({ ok: true, lumaEventId: match.id, name: match.name, coverImageUrl: match.cover_url, lumaUrl: match.url });
  } catch (e) {
    console.error(JSON.stringify({ fn: "attach-luma", error: String((e as Error)?.message ?? e) }));
    return json({ error: String(e) }, 500);
  }
});
