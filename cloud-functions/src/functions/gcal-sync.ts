// DUAL-MAINTAINED: any changes here must also be made in
// supabase/functions/gcal-sync/index.ts
import { Request, Response } from 'express';
import { getServiceClient } from '../db.js';
import { gcalTitle, isEligible, timeOverlap, nameSimilar, isOwned, Span } from './gcal-helpers.js';

const TZ = process.env.GCAL_TIMEZONE || 'America/New_York';
const PRIMARY = "primary";
const COORD = () =>
  process.env.GCAL_COORDINATION_CALENDAR_ID ??
  "c_fad28a2710da5efc5126158eae561ee3107d4afc395bbc595f051f0117a1d0fd@group.calendar.google.com";
const CALENDARS = () => [PRIMARY, COORD()];
const EVENT_COLOR_ID = "9";

// ── OAuth ────────────────────────────────────────────────────────────────────

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

// ── Deep link ────────────────────────────────────────────────────────────────

// Derives the EventHub deep link from body.appOrigin if provided, else from request headers.
function appLinkFor(req: Request, eventId: string): string | null {
  const hdr = (k: string) => { const v = (req.headers as any)[k]; return Array.isArray(v) ? v[0] : (v ?? ''); };
  let origin = hdr('origin');
  if (!origin) { try { origin = new URL(hdr('referer')).origin; } catch { origin = ''; } }
  return origin ? `${origin.replace(/\/+$/, '')}/?event=${encodeURIComponent(eventId)}` : null;
}

function makeAppLink(req: Request, eventId: string, appOrigin?: string): string | null {
  if (appOrigin) return `${appOrigin.replace(/\/+$/, '')}/?event=${encodeURIComponent(eventId)}`;
  return appLinkFor(req, eventId);
}

// ── Body builder ─────────────────────────────────────────────────────────────

function buildBody(ev: any, appLink: string | null): Record<string, unknown> {
  const addDay = (d: string) => { const x = new Date(d + 'T00:00:00'); x.setDate(x.getDate() + 1); return x.toISOString().slice(0, 10); };
  const descParts = [ev.description, ev.luma_url ? `Luma: ${ev.luma_url}` : null, appLink ? `EventHub: ${appLink}` : null].filter(Boolean);
  const body: Record<string, unknown> = {
    summary: gcalTitle(ev.name, ev.location),
    location: ev.location ?? undefined,
    description: descParts.join('\n\n') || undefined,
    colorId: EVENT_COLOR_ID,
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

// ── Google REST wrappers ──────────────────────────────────────────────────────

const GCAL_BASE = 'https://www.googleapis.com/calendar/v3';

async function gcalInsert(token: string, calId: string, body: Record<string, unknown>): Promise<any> {
  const r = await fetch(`${GCAL_BASE}/calendars/${encodeURIComponent(calId)}/events`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return r.json();
}

async function gcalPatch(token: string, calId: string, gid: string, body: Record<string, unknown>): Promise<any> {
  const r = await fetch(`${GCAL_BASE}/calendars/${encodeURIComponent(calId)}/events/${encodeURIComponent(gid)}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return r.json();
}

async function gcalDelete(token: string, calId: string, gid: string): Promise<void> {
  const r = await fetch(`${GCAL_BASE}/calendars/${encodeURIComponent(calId)}/events/${encodeURIComponent(gid)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok && r.status !== 404 && r.status !== 410) {
    const body = await r.text();
    throw new Error(`gcalDelete failed (${r.status}): ${body}`);
  }
}

interface GCalListItem {
  id: string;
  summary: string;
  description: string;
  start: { date?: string; dateTime?: string };
  end:   { date?: string; dateTime?: string };
  htmlLink: string;
}

async function gcalListWindow(token: string, calId: string, dateFrom: string, dateTo: string): Promise<GCalListItem[]> {
  const params = new URLSearchParams({
    timeMin: `${dateFrom}T00:00:00Z`,
    timeMax: `${dateTo}T00:00:00Z`,
    singleEvents: 'true',
    maxResults: '50',
  });
  const r = await fetch(`${GCAL_BASE}/calendars/${encodeURIComponent(calId)}/events?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const d = await r.json() as any;
  return (d.items ?? []) as GCalListItem[];
}

// ── Span helpers ──────────────────────────────────────────────────────────────

function eventSpan(ev: { event_date: string; start_time?: string | null; end_time?: string | null }): Span {
  if (ev.start_time) {
    const end = ev.end_time || ev.start_time;
    return { start: `${ev.event_date}T${ev.start_time}:00`, end: `${ev.event_date}T${end}:00`, allDay: false };
  }
  const addDay = (d: string) => { const x = new Date(d + 'T00:00:00'); x.setDate(x.getDate() + 1); return x.toISOString().slice(0, 10); };
  return { start: ev.event_date, end: addDay(ev.event_date), allDay: true };
}

function candidateSpan(item: GCalListItem): Span {
  if (item.start.dateTime) {
    return { start: item.start.dateTime, end: item.end.dateTime!, allDay: false };
  }
  return { start: item.start.date!, end: item.end.date!, allDay: true };
}

// ── Match-and-adopt ───────────────────────────────────────────────────────────

interface Candidate {
  gcalEventId: string;
  summary: string;
  start: string;
  htmlLink: string;
}

async function findCandidate(token: string, calId: string, ev: any): Promise<Candidate | null> {
  const date: string = ev.event_date;
  // window: event_date − 1 day … event_date + 1 day
  const addDays = (d: string, n: number) => { const x = new Date(d + 'T00:00:00'); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
  const dateFrom = addDays(date, -1);
  const dateTo   = addDays(date, 2); // exclusive upper bound → +2 so window covers date+1 fully
  // Fix 3: timeMin/timeMax are Z-anchored but the ±1-day window is a 3-day UTC span, wider than any real timezone offset, so events dated D always fall inside it regardless of local time.

  const items = await gcalListWindow(token, calId, dateFrom, dateTo);
  const eSpan = eventSpan(ev);

  for (const item of items) {
    const cSpan = candidateSpan(item);
    if (
      timeOverlap(eSpan, cSpan) &&
      nameSimilar(ev.name ?? '', item.summary ?? '') &&
      !isOwned(item.description)
    ) {
      return {
        gcalEventId: item.id,
        summary: item.summary,
        start: item.start.dateTime ?? item.start.date ?? '',
        htmlLink: item.htmlLink,
      };
    }
  }
  return null;
}

// ── Upsert helper ─────────────────────────────────────────────────────────────

interface UpsertResult { calId: string; gid: string; htmlLink: string | null }

async function upsertOn(token: string, calId: string, ev: any, ids: Record<string, string>, appLink: string | null): Promise<UpsertResult> {
  const body = buildBody(ev, appLink);
  const existingGid = ids[calId];
  let result: any;
  if (existingGid) {
    result = await gcalPatch(token, calId, existingGid, body);
  } else {
    result = await gcalInsert(token, calId, body);
  }
  if (!result.id) throw new Error(`Calendar write failed on ${calId}: ${result.error?.message ?? 'unknown'}`);
  return { calId, gid: result.id, htmlLink: result.htmlLink ?? null };
}

// ── Handler ───────────────────────────────────────────────────────────────────

export async function handler(req: Request, res: Response) {
  try {
    // Guard: OAuth token must be configured
    if (!process.env.GCAL_REFRESH_TOKEN) {
      res.status(400).json({ error: 'Google Calendar not connected (GCAL_REFRESH_TOKEN unset). Run scripts/gcal-auth.mjs.' });
      return;
    }

    const { eventId, action = 'auto', appOrigin } = req.body as {
      eventId?: string;
      action?: 'auto' | 'link' | 'create' | 'delete';
      appOrigin?: string;
    };
    if (!eventId) { res.status(400).json({ error: 'eventId required' }); return; }

    const sb = getServiceClient();
    const { data: ev, error } = await sb
      .from('event')
      .select('id, name, event_date, start_time, end_time, location, description, luma_url, is_template, gcal_event_ids, gcal_match_pending')
      .eq('id', eventId)
      .single();
    if (error || !ev) { res.status(404).json({ error: 'event not found' }); return; }

    const ids: Record<string, string> = (ev as any).gcal_event_ids ?? {};
    // Fix 2: capture calendar ids once so coordId is provably the same key used in
    // gcal_match_pending, upsert loops, and write-back (no repeated process.env reads).
    const cals = CALENDARS(); // cals[0] = primary, cals[1] = coordination

    // ── action: delete (before eligibility guard so any event can be un-synced) ──
    if (action === 'delete') {
      const token = await accessToken();
      for (const [calId, gid] of Object.entries(ids)) {
        await gcalDelete(token, calId, gid);
      }
      await sb.from('event').update({
        gcal_event_ids: {},
        gcal_event_id: null,
        gcal_html_link: null,
        gcal_match_pending: null,
      }).eq('id', eventId);
      res.json({ ok: true, status: 'deleted' });
      return;
    }

    // ── Eligibility guard ─────────────────────────────────────────────────────
    if (!isEligible(ev as any)) {
      res.status(400).json({ error: 'event has no date, or is a template — not synced' });
      return;
    }

    const token   = await accessToken();
    const appLink = makeAppLink(req, eventId, appOrigin);

    // ── action: auto (first sync) — look for candidates before creating ───────
    if (action === 'auto' && Object.keys(ids).length === 0) {
      const [candP, candC] = await Promise.all([
        findCandidate(token, cals[0], ev),
        findCandidate(token, cals[1], ev),
      ]);

      if (candP !== null || candC !== null) {
        const pending: Record<string, Candidate | null> = {
          [cals[0]]: candP,
          [cals[1]]: candC,
        };
        await sb.from('event').update({ gcal_match_pending: pending }).eq('id', eventId);
        res.json({ ok: true, status: 'needs_confirmation', candidates: pending });
        return;
      }
      // No candidates found — fall through to create on both calendars below
    }

    // ── action: link — adopt pending candidates, create where none ────────────
    if (action === 'link') {
      const pending: Record<string, Candidate | null> = (ev as any).gcal_match_pending ?? {};

      // Fix 1: use allSettled so a coordination-calendar failure doesn't discard
      // a successfully written primary id, preventing orphan-event duplicates.
      const settled = await Promise.allSettled(
        cals.map(calId => {
          const cand = pending[calId];
          if (cand) {
            // Adopt: patch the candidate so it gains our title, color, and ownership marker
            return gcalPatch(token, calId, cand.gcalEventId, buildBody(ev, appLink))
              .then(patched => {
                if (!patched.id) throw new Error(`gcalPatch failed on ${calId}: ${patched.error?.message ?? 'unknown'}`);
                return { calId, gid: patched.id as string, htmlLink: (patched.htmlLink ?? null) as string | null };
              });
          } else {
            return upsertOn(token, calId, ev, ids, appLink);
          }
        })
      );

      // Persist whatever succeeded; always write back to DB.
      const nextIds: Record<string, string> = { ...ids };
      let primaryHtmlLink: string | null = null;
      const errors: string[] = [];
      for (const outcome of settled) {
        if (outcome.status === 'fulfilled') {
          const r = outcome.value;
          nextIds[r.calId] = r.gid;
          if (r.calId === PRIMARY) primaryHtmlLink = r.htmlLink;
        } else {
          errors.push(String(outcome.reason?.message ?? outcome.reason));
        }
      }
      await sb.from('event').update({
        gcal_event_ids: nextIds,
        gcal_event_id: nextIds[PRIMARY] ?? null,
        gcal_html_link: primaryHtmlLink ?? (ev as any).gcal_html_link ?? null,
        gcal_match_pending: null,
      }).eq('id', eventId);

      if (errors.length > 0) {
        res.status(207).json({ ok: false, status: 'partial', gcalEventIds: nextIds, errors });
      } else {
        res.json({ ok: true, status: 'synced', gcalEventIds: nextIds, htmlLink: primaryHtmlLink });
      }
      return;
    }

    // ── action: create, OR auto with existing ids (patch) ────────────────────
    // Also handles: auto after finding no candidates above (ids still empty, falls here)
    // Fix 1: use allSettled so a coordination-calendar failure doesn't discard
    // a successfully written primary id, preventing orphan-event duplicates.
    const settled = await Promise.allSettled(
      cals.map(calId => upsertOn(token, calId, ev, ids, appLink))
    );

    // Persist whatever succeeded; always write back to DB.
    const nextIds: Record<string, string> = { ...ids };
    let primaryHtmlLink: string | null = null;
    const errors: string[] = [];
    for (const outcome of settled) {
      if (outcome.status === 'fulfilled') {
        const r = outcome.value;
        nextIds[r.calId] = r.gid;
        if (r.calId === PRIMARY) primaryHtmlLink = r.htmlLink;
      } else {
        errors.push(String(outcome.reason?.message ?? outcome.reason));
      }
    }
    await sb.from('event').update({
      gcal_event_ids: nextIds,
      gcal_event_id: nextIds[PRIMARY] ?? null,
      gcal_html_link: primaryHtmlLink ?? (ev as any).gcal_html_link ?? null,
      gcal_match_pending: null,
    }).eq('id', eventId);

    if (errors.length > 0) {
      res.status(207).json({ ok: false, status: 'partial', gcalEventIds: nextIds, errors });
    } else {
      res.json({ ok: true, status: 'synced', gcalEventIds: nextIds, htmlLink: primaryHtmlLink });
    }

  } catch (e) {
    console.error(JSON.stringify({ fn: 'gcal-sync', error: String((e as Error)?.message ?? e) }));
    res.status(500).json({ error: (e as Error).message ?? String(e) });
  }
}
