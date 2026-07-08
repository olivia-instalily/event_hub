import { Request, Response } from 'express';
import { getServiceClient } from '../db.js';

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
  const data = await res.json() as any;
  return data.event ?? data ?? null;
}

export async function handler(req: Request, res: Response) {
  try {
    const body = req.body;
    const { eventId } = body;
    if (!eventId) { res.status(400).json({ error: 'eventId is required' }); return; }

    const lumaKey = process.env.LUMA_API_KEY;
    if (!lumaKey) { res.status(500).json({ error: 'LUMA_API_KEY not configured on the server.' }); return; }

    const sb = getServiceClient();
    const { data: ev } = await sb.from('event')
      .select('name, event_date, start_time, end_time, location, office, description, cover_image_url')
      .eq('id', eventId).maybeSingle();

    const name       = (body.name ?? (ev as any)?.name ?? '').trim();
    const date       = body.date ?? (ev as any)?.event_date ?? null;
    const startTime  = body.startTime ?? (ev as any)?.start_time ?? '18:00';
    const endTime    = body.endTime ?? (ev as any)?.end_time ?? null;
    const location   = body.location ?? (ev as any)?.location ?? (ev as any)?.office ?? null;
    const description = body.description ?? (ev as any)?.description ?? null;
    const tz = body.timezone ?? 'America/New_York';

    if (!name) { res.status(400).json({ error: 'Event needs a name before creating on Luma.' }); return; }
    if (!date) { res.status(400).json({ error: 'Event needs a date before creating on Luma.' }); return; }

    const start_at = zonedToUtcIso(date, startTime, tz);
    const end_at   = endTime ? zonedToUtcIso(date, endTime, tz) : undefined;
    const descParts = [description, location ? `Location: ${location}` : null].filter(Boolean);
    const coverRaw  = (body.coverUrl ?? (ev as any)?.cover_image_url ?? null) as string | null;
    const inCover   = coverRaw && /^https?:\/\//i.test(coverRaw) && !/127\.0\.0\.1|localhost/.test(coverRaw) ? coverRaw : null;

    const baseBody: Record<string, unknown> = {
      name, start_at, timezone: tz,
      ...(end_at ? { end_at } : {}),
      ...(descParts.length ? { description: descParts.join('\n\n') } : {}),
    };
    const doCreate = (b: Record<string, unknown>) => fetch('https://public-api.luma.com/v1/event/create', {
      method: 'POST',
      headers: { 'x-luma-api-key': lumaKey, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(b),
    });

    const attempts: Record<string, unknown>[] = [
      { ...baseBody, visibility: 'private', ...(inCover ? { cover_url: inCover } : {}) },
      ...(inCover ? [{ ...baseBody, visibility: 'private' }] : []),
      baseBody,
    ];
    let createRes = await doCreate(attempts[0]);
    for (let i = 1; i < attempts.length && !createRes.ok && (createRes.status === 400 || createRes.status === 422); i++) {
      createRes = await doCreate(attempts[i]);
    }
    if (!createRes.ok) { res.status(502).json({ error: `Luma create ${createRes.status}: ${await createRes.text()}` }); return; }

    const created = await createRes.json() as any;
    const apiId   = created.api_id ?? created.event?.api_id ?? created.id;
    if (!apiId)   { res.status(502).json({ error: 'Luma create returned no event id.' }); return; }

    const full     = await lumaGet(lumaKey, apiId);
    const lumaUrl  = full?.url ?? created.url ?? null;
    const coverUrl = full?.cover_url ?? null;
    const lumaName = full?.name ?? name;

    const { error } = await sb.from('event')
      .update({ luma_event_id: apiId, luma_url: lumaUrl, luma_name: lumaName, ...(coverUrl ? { cover_image_url: coverUrl, luma_cover_url: coverUrl } : {}) })
      .eq('id', eventId);
    if (error) { res.status(500).json({ error: error.message }); return; }

    res.json({ ok: true, lumaEventId: apiId, name: lumaName, lumaUrl, coverImageUrl: coverUrl });
  } catch (e) {
    console.error(JSON.stringify({ fn: 'create-luma', error: String((e as Error)?.message ?? e) }));
    res.status(500).json({ error: String((e as Error)?.message ?? e) });
  }
}
