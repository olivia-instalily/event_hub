// Edge function: create a brand-new Luma event from an Assembly event's info, then attach it.
// Runs server-side — holds the Luma key, writes with the service role.
//
// POST { eventId, name?, date?, startTime?, endTime?, location?, description?, timezone? }
//  → builds start/end instants, calls Luma create, fetches the new event's url+cover,
//    stores luma_event_id/url/name/cover on the event, returns them.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

// Offset (ms) of a timezone at a given instant.
function tzOffsetMs(date: Date, tz: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
  const p: Record<string, string> = {};
  for (const part of dtf.formatToParts(date)) p[part.type] = part.value;
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return asUTC - date.getTime();
}
// Local "YYYY-MM-DD" + "HH:MM" in tz → absolute UTC ISO.
function zonedToUtcIso(dateStr: string, timeStr: string, tz: string): string {
  const [y, mo, d] = dateStr.split('-').map(Number);
  const [h, mi] = timeStr.split(':').map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const offset = tzOffsetMs(new Date(guess), tz);
  return new Date(guess - offset).toISOString();
}

async function lumaGet(apiKey: string, apiId: string) {
  const url = new URL('https://public-api.luma.com/v1/event/get');
  url.searchParams.set('api_id', apiId);
  const res = await fetch(url, { headers: { 'x-luma-api-key': apiKey, accept: 'application/json' } });
  if (!res.ok) return null;
  const data = await res.json();
  return data.event ?? data ?? null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  try {
    const body = await req.json();
    const { eventId } = body;
    if (!eventId) return json({ error: 'eventId is required' }, 400);

    const lumaKey = Deno.env.get('LUMA_API_KEY');
    if (!lumaKey) return json({ error: 'LUMA_API_KEY not configured on the server.' }, 500);

    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } },
    );

    // Fill any missing fields from the stored event.
    const { data: ev } = await sb.from('event')
      .select('name, event_date, start_time, end_time, location, office, description, cover_image_url')
      .eq('id', eventId).maybeSingle();
    const name = (body.name ?? ev?.name ?? '').trim();
    const date = body.date ?? ev?.event_date ?? null;
    const startTime = body.startTime ?? ev?.start_time ?? '18:00';
    const endTime = body.endTime ?? ev?.end_time ?? null;
    const location = body.location ?? ev?.location ?? ev?.office ?? null;
    const description = body.description ?? ev?.description ?? null;
    const tz = body.timezone ?? 'America/New_York';

    if (!name) return json({ error: 'Event needs a name before creating on Luma.' }, 400);
    if (!date) return json({ error: 'Event needs a date before creating on Luma.' }, 400);

    const start_at = zonedToUtcIso(date, startTime, tz);
    const end_at = endTime ? zonedToUtcIso(date, endTime, tz) : undefined;
    const descParts = [description, location ? `Location: ${location}` : null].filter(Boolean);
    // Only a publicly-fetchable cover can be pushed to Luma — skip data:/local URLs.
    const coverRaw = (body.coverUrl ?? ev?.cover_image_url ?? null) as string | null;
    const inCover = coverRaw && /^https?:\/\//i.test(coverRaw) && !/127\.0\.0\.1|localhost/.test(coverRaw) ? coverRaw : null;

    const baseBody: Record<string, unknown> = {
      name, start_at, timezone: tz,
      ...(end_at ? { end_at } : {}),
      ...(descParts.length ? { description: descParts.join('\n\n') } : {}),
    };
    const doCreate = (body: Record<string, unknown>) => fetch('https://public-api.luma.com/v1/event/create', {
      method: 'POST',
      headers: { 'x-luma-api-key': lumaKey, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
    });
    // Try richest first (private + cover background); fall back field-by-field if Luma rejects
    // a field, so a create never fails just because of visibility/cover.
    const attempts: Record<string, unknown>[] = [
      { ...baseBody, visibility: 'private', ...(inCover ? { cover_url: inCover } : {}) },
      ...(inCover ? [{ ...baseBody, visibility: 'private' }] : []),
      baseBody,
    ];
    let createRes = await doCreate(attempts[0]);
    for (let i = 1; i < attempts.length && !createRes.ok && (createRes.status === 400 || createRes.status === 422); i++) {
      createRes = await doCreate(attempts[i]);
    }
    if (!createRes.ok) return json({ error: `Luma create ${createRes.status}: ${await createRes.text()}` }, 502);
    const created = await createRes.json();
    const apiId = created.api_id ?? created.event?.api_id ?? created.id;
    if (!apiId) return json({ error: 'Luma create returned no event id.' }, 502);

    // Fetch the new event for its public url + cover.
    const full = await lumaGet(lumaKey, apiId);
    const lumaUrl = full?.url ?? created.url ?? null;
    const coverUrl = full?.cover_url ?? null;
    const lumaName = full?.name ?? name;

    const { error } = await sb.from('event')
      .update({ luma_event_id: apiId, luma_url: lumaUrl, luma_name: lumaName, ...(coverUrl ? { cover_image_url: coverUrl, luma_cover_url: coverUrl } : {}) })
      .eq('id', eventId);
    if (error) return json({ error: error.message }, 500);

    return json({ ok: true, lumaEventId: apiId, name: lumaName, lumaUrl, coverImageUrl: coverUrl });
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});
