import { Request, Response } from 'express';
import { getServiceClient } from '../db.js';

const TZ = process.env.GCAL_TIMEZONE || 'America/New_York';
const CAL_SUMMARY = 'EventHub Events';

async function accessToken(): Promise<string> {
  const clientId     = process.env.GCAL_CLIENT_ID ?? process.env.GOOGLE_CLIENT_ID!;
  const clientSecret = process.env.GCAL_CLIENT_SECRET ?? process.env.GOOGLE_CLIENT_SECRET!;
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId, client_secret: clientSecret,
      refresh_token: process.env.GCAL_REFRESH_TOKEN!,
      grant_type: 'refresh_token',
    }),
  });
  const d = await r.json() as any;
  if (!d.access_token) throw new Error(`Google token error: ${d.error ?? 'no access_token'}${d.error_description ? ` — ${d.error_description}` : ''}`);
  return d.access_token as string;
}

async function ensureCalendar(token: string, sb: ReturnType<typeof getServiceClient>): Promise<string> {
  const envId = process.env.GCAL_CALENDAR_ID;
  if (envId) return envId;
  const { data: row } = await sb.from('app_setting').select('value').eq('key', 'gcal_calendar_id').maybeSingle();
  if ((row as any)?.value) return (row as any).value as string;
  const r = await fetch('https://www.googleapis.com/calendar/v3/calendars', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ summary: CAL_SUMMARY, timeZone: TZ }),
  });
  const cal = await r.json() as any;
  if (!cal.id) throw new Error(`Couldn't create calendar: ${cal.error?.message ?? 'unknown'}`);
  await sb.from('app_setting').upsert({ key: 'gcal_calendar_id', value: cal.id });
  return cal.id as string;
}

function buildBody(ev: any): Record<string, unknown> {
  const addDay = (d: string) => { const x = new Date(d + 'T00:00:00'); x.setDate(x.getDate() + 1); return x.toISOString().slice(0, 10); };
  const descParts = [ev.description, ev.luma_url ? `Luma: ${ev.luma_url}` : null].filter(Boolean);
  const body: Record<string, unknown> = {
    summary: ev.name ?? 'Untitled event',
    location: ev.location ?? undefined,
    description: descParts.join('\n\n') || undefined,
  };
  if (ev.start_time) {
    const end = ev.end_time || ev.start_time;
    body.start = { dateTime: `${ev.event_date}T${ev.start_time}:00`, timeZone: TZ };
    body.end   = { dateTime: `${ev.event_date}T${end}:00`, timeZone: TZ };
  } else {
    body.start = { date: ev.event_date };
    body.end   = { date: addDay(ev.event_date) };
  }
  return body;
}

export async function handler(req: Request, res: Response) {
  try {
    if (!process.env.GCAL_REFRESH_TOKEN) { res.status(400).json({ error: 'Google Calendar not connected (GCAL_REFRESH_TOKEN unset). Run scripts/gcal-auth.mjs.' }); return; }
    const { eventId } = req.body;
    if (!eventId) { res.status(400).json({ error: 'eventId required' }); return; }

    const sb = getServiceClient();
    const { data: ev, error } = await sb.from('event')
      .select('id, name, event_date, start_time, end_time, location, description, luma_url, gcal_event_id')
      .eq('id', eventId).single();
    if (error || !ev) { res.status(404).json({ error: 'event not found' }); return; }
    if (!(ev as any).event_date) { res.status(400).json({ error: 'event has no date — set a date before adding to the calendar' }); return; }

    const token      = await accessToken();
    const calendarId = await ensureCalendar(token, sb);
    const body       = buildBody(ev);

    const base = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;
    const url  = (ev as any).gcal_event_id ? `${base}/${encodeURIComponent((ev as any).gcal_event_id)}` : base;
    const r    = await fetch(url, {
      method: (ev as any).gcal_event_id ? 'PATCH' : 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const created = await r.json() as any;
    if (!created.id) { res.status(500).json({ error: `Calendar write failed: ${created.error?.message ?? 'unknown'}` }); return; }

    await sb.from('event').update({ gcal_event_id: created.id, gcal_html_link: created.htmlLink ?? null }).eq('id', eventId);
    res.json({ ok: true, gcalEventId: created.id, calendarId, htmlLink: created.htmlLink ?? null });
  } catch (e) {
    console.error(JSON.stringify({ fn: 'gcal-sync', error: String((e as Error)?.message ?? e) }));
    res.status(500).json({ error: (e as Error).message ?? String(e) });
  }
}
