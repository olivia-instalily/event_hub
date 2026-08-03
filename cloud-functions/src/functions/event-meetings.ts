// GET upcoming meetings related to an event, read live from the shared Google calendars. POST { eventId }.
// Finds calendar entries between today and just after the event that name-match the event, excluding
// EventHub's own synced entries and anything the user has detached. Used by the "Upcoming meetings"
// section on the event overview. Read-only; no writes.
import { Request, Response } from 'express';
import { getServiceClient } from '../db.js';
import { nameSimilar, isOwned } from './gcal-helpers.js';

const GCAL_BASE = 'https://www.googleapis.com/calendar/v3';
const PRIMARY = 'primary';
const COORD = () =>
  process.env.GCAL_COORDINATION_CALENDAR_ID ??
  'c_fad28a2710da5efc5126158eae561ee3107d4afc395bbc595f051f0117a1d0fd@group.calendar.google.com';

async function accessToken(): Promise<string> {
  const clientId = process.env.GCAL_CLIENT_ID ?? process.env.GOOGLE_CLIENT_ID!;
  const clientSecret = process.env.GCAL_CLIENT_SECRET ?? process.env.GOOGLE_CLIENT_SECRET!;
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: process.env.GCAL_REFRESH_TOKEN!, grant_type: 'refresh_token' }),
  });
  const d = await r.json() as any;
  if (!d.access_token) throw new Error(`Google token error: ${d.error ?? 'no access_token'}`);
  return d.access_token as string;
}

async function listWindow(token: string, calId: string, fromDate: string, toDate: string): Promise<any[]> {
  const params = new URLSearchParams({ timeMin: `${fromDate}T00:00:00Z`, timeMax: `${toDate}T00:00:00Z`, singleEvents: 'true', orderBy: 'startTime', maxResults: '50' });
  const r = await fetch(`${GCAL_BASE}/calendars/${encodeURIComponent(calId)}/events?${params}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) { console.error(JSON.stringify({ fn: 'event-meetings', cal: calId, status: r.status })); return []; }
  const d = await r.json() as any;
  return (d.items ?? []) as any[];
}

const addDays = (d: string, n: number) => { const x = new Date(d + 'T00:00:00'); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };

export async function handler(req: Request, res: Response) {
  const eventId = String(req.body?.eventId ?? '');
  if (!eventId) { res.status(400).json({ error: 'eventId required' }); return; }
  if (!process.env.GCAL_REFRESH_TOKEN) { res.json({ meetings: [] }); return; }
  const sb = getServiceClient();
  const { data: ev } = await sb.from('event').select('name, event_date, gcal_event_ids, detached_meeting_ids').eq('id', eventId).maybeSingle();
  if (!ev || !(ev as any).event_date || !(ev as any).name) { res.json({ meetings: [] }); return; }

  const today = new Date().toISOString().slice(0, 10);
  const to = addDays((ev as any).event_date, 2);
  if (to < today) { res.json({ meetings: [] }); return; } // event window fully in the past

  const owned = new Set(Object.values(((ev as any).gcal_event_ids ?? {}) as Record<string, string>));
  const detached = new Set(((ev as any).detached_meeting_ids ?? []) as string[]);
  const nowMs = Date.now();

  let token: string;
  try { token = await accessToken(); } catch (e) { console.error(String((e as Error)?.message)); res.json({ meetings: [] }); return; }

  const seen = new Map<string, { id: string; title: string; start: string; htmlLink: string | null }>();
  for (const cal of [PRIMARY, COORD()]) {
    for (const it of await listWindow(token, cal, today, to)) {
      const start = it.start?.dateTime ?? (it.start?.date ? `${it.start.date}T00:00:00Z` : null);
      if (!start || new Date(start).getTime() < nowMs) continue;      // upcoming only
      if (owned.has(it.id) || detached.has(it.id)) continue;          // not EventHub's own / not detached
      if (isOwned(it.description)) continue;                          // skip EventHub-created entries
      if (!it.summary || !nameSimilar((ev as any).name, it.summary)) continue; // must relate to the event
      if (!seen.has(it.id)) seen.set(it.id, { id: it.id, title: it.summary, start, htmlLink: it.htmlLink ?? null });
    }
  }
  const meetings = [...seen.values()].sort((a, b) => a.start.localeCompare(b.start));
  res.json({ meetings });
}
