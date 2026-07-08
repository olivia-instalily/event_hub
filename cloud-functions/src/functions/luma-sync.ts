// Background Luma sync — fired (fire-and-forget) from the app on page load.
//
// Ports the Luma-fetch + upsert logic from scripts/luma-sync.mjs (cmdImportEvents + cmdSync),
// but writes through the shared Supabase client (see db.ts) instead of a raw pg pool, matching
// every other function here.
//
// IMPORTANT — Luma has no "changed since" filter. Neither /calendar/list-events nor
// /event/get-guests accepts a created/updated-since parameter (list-events' before/after filter
// on the event's start_at, not on change time; get-guests exposes no timestamp at all). So
// `luma_last_synced` can't be pushed down to Luma to fetch "only what changed" — the upserts are
// idempotent and we simply re-sync. What luma_last_synced DOES buy us is a throttle: page load
// fires this on every mount, and Luma rate-limits at 300 req/min, so we skip if we synced very
// recently. See the notes returned to the caller for the full picture.

import { Request, Response } from 'express';
import { createHash } from 'node:crypto';
import { getServiceClient } from '../db.js';

const LUMA_BASE = 'https://public-api.luma.com/v1';
// Skip the sync if we already synced within this window — keeps every page load from hammering
// Luma's 300/min limit. Set to 0 to force a sync on every call.
const THROTTLE_MS = 5 * 60 * 1000;

type Supa = ReturnType<typeof getServiceClient>;

// ── Luma API helpers (ported verbatim from scripts/luma-sync.mjs) ───────────────

async function luma(apiKey: string, path: string, params: Record<string, unknown> = {}): Promise<any> {
  const url = new URL(LUMA_BASE + path);
  for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, String(v));
  const res = await fetch(url, { headers: { 'x-luma-api-key': apiKey, accept: 'application/json' } });
  if (res.status === 429) throw new Error(`Luma rate limit (300/min) hit on ${path} — wait a minute and retry.`);
  if (!res.ok) throw new Error(`Luma ${path} -> ${res.status}: ${await res.text()}`);
  return res.json();
}

async function lumaAll(apiKey: string, path: string, params: Record<string, unknown> = {}): Promise<any[]> {
  const out: any[] = [];
  let cursor: string | undefined = undefined;
  do {
    const data = await luma(apiKey, path, { ...params, pagination_limit: 100, pagination_cursor: cursor });
    out.push(...(data.entries ?? data.data ?? []));
    cursor = data.has_more ? (data.next_cursor ?? data.pagination_cursor) : undefined;
  } while (cursor);
  return out;
}

interface Profile { title: string | null; org: string | null; school: string | null; city: string | null; industry: string | null; linkedin: string | null }

function extractProfile(answers: any[]): Profile {
  const p: Profile = { title: null, org: null, school: null, city: null, industry: null, linkedin: null };
  for (const a of answers ?? []) {
    const label = (a.label ?? '').toLowerCase();
    const val = (a.answer ?? (typeof a.value === 'string' ? a.value : '') ?? '').trim();
    if (a.question_type === 'company' || label.includes('company')) {
      if (a.answer_company) p.org = a.answer_company;
      if (a.answer_job_title) p.title = a.answer_job_title;
    } else if (label.includes('school')) { if (val) p.school = val; }
    else if (label.includes('industry')) { if (val) p.industry = val; }
    else if (label.includes('city')) { if (val) p.city = val; }
    else if (label.includes('linkedin')) { if (val) p.linkedin = val; }
  }
  return p;
}

interface Guest { email: string | null; name: string | null; approval: string | null; checkedIn: boolean; profile: Profile }

function readGuest(entry: any): Guest {
  const g = entry.guest ?? entry.user ?? entry;
  const email = (g.email ?? g.user_email ?? g.guest_email ?? g.user?.email ?? '').trim().toLowerCase() || null;
  const name = g.name ?? g.user_name ?? g.guest_name ?? g.user?.name ?? null;
  const approval = g.approval_status ?? g.status ?? null;
  const checkedIn = Boolean(g.checked_in_at ?? g.checked_in_at_timestamp ?? g.checked_in === true);
  const profile = extractProfile(g.registration_answers);
  return { email, name, approval, checkedIn, profile };
}

const idFromEmail = (email: string) => 'att-' + createHash('sha1').update(email).digest('hex').slice(0, 16);

// ── Import / refresh Luma events (port of cmdImportEvents) ──────────────────────
// Fetches the full event list (cheap — one paginated endpoint). Policy:
//   • Past events (start_at < today)  → SKIP entirely. They're wrapped; never re-import or touch.
//   • Future events already linked    → REFRESH the Luma-owned fields (name/date/location/cover/url).
//   • Future events not yet linked     → ADD them.
// We can't narrow this by luma_last_synced (list-events' after/before filter on start_at, and there's
// no changed-since filter), so we walk the list and decide per event.
async function importEvents(supa: Supa, apiKey: string): Promise<{ imported: number; updated: number }> {
  const { data: existing } = await supa.from('event').select('luma_event_id').not('luma_event_id', 'is', null);
  const linked = new Set((existing ?? []).map((r: any) => r.luma_event_id));
  const today = new Date().toISOString().slice(0, 10);

  const events = await lumaAll(apiKey, '/calendar/list-events');
  let imported = 0, updated = 0;
  for (const entry of events) {
    const ev = entry.event ?? entry;
    const apiId = ev.api_id ?? ev.id;
    if (!apiId) continue;
    const eventDate = ev.start_at ? String(ev.start_at).slice(0, 10) : null;
    // Skip past events — leave wrapped events frozen. (Undated events have no start_at, so they're
    // never "past" and fall through as future.)
    if (eventDate && eventDate < today) continue;

    let location: string | null = null;
    try {
      const g = typeof ev.geo_address_json === 'string' ? JSON.parse(ev.geo_address_json) : ev.geo_address_json;
      location = g?.city || g?.address || g?.full_address || null;
    } catch { /* no geo */ }

    // Luma-owned fields only — never touch macro_stage or other in-app fields on an existing event.
    const lumaFields = {
      name: ev.name,
      luma_url: ev.url ?? null,
      cover_image_url: ev.cover_url ?? null,
      event_date: eventDate,
      location,
    };

    if (linked.has(apiId)) {
      // Existing future event — refresh Luma fields in place. Match on luma_event_id (not the derived
      // id) so an event that was attached with a custom id updates its own row instead of duplicating.
      const { error } = await supa.from('event').update(lumaFields).eq('luma_event_id', apiId);
      if (!error) updated++;
    } else {
      // New future event — starts in 'Concept' (drawn from Luma, nobody's touched it yet → status
      // "future"). It graduates to 'Planning' (→ "in-process") once someone completes the essentials
      // setup flow. It still routes to the planning view, which opens on the setup steps until then.
      const { error } = await supa.from('event').insert({
        id: 'evt-luma-' + String(apiId).replace(/^evt-/, ''),
        luma_event_id: apiId,
        ...lumaFields,
        macro_stage: 'Concept',
      });
      if (!error) imported++;
    }
  }
  return { imported, updated };
}

// ── Sync guests for every linked event (port of cmdSync) ────────────────────────
// No incremental option exists on get-guests, so we pull the full guest list per event each
// time. The upserts are idempotent, so a full re-sync is correct, just not cheap — hence the
// caller-side throttle.
async function syncGuests(supa: Supa, apiKey: string): Promise<{ events: number; guests: number }> {
  const { data: events } = await supa.from('event').select('id, name, luma_event_id, event_date').not('luma_event_id', 'is', null);
  const today = new Date().toISOString().slice(0, 10);
  // Skip past events here too — their guest lists are wrapped, don't re-pull/overwrite them.
  const active = (events ?? []).filter((e: any) => !(e.event_date && e.event_date < today));
  let totalGuests = 0;
  for (const ev of active as any[]) {
    try {
      const raw = await lumaAll(apiKey, '/event/get-guests', { event_api_id: ev.luma_event_id });
      const guests = raw.map(readGuest).filter((g) => g.email) as (Guest & { email: string })[];
      if (!guests.length) continue;

      // Preserve the type of attendees we already know (only new rows get 'Unknown').
      const emails = guests.map((g) => g.email);
      const { data: known } = await supa.from('attendee').select('email').in('email', emails);
      const seen = new Set((known ?? []).map((r: any) => r.email));

      for (const g of guests) {
        if (seen.has(g.email)) {
          // Existing: refresh profile; keep type, and only overwrite linkedin when we have a new value (COALESCE).
          const patch: Record<string, unknown> = {
            name: g.name, title: g.profile.title, org: g.profile.org,
            school: g.profile.school, city: g.profile.city, industry: g.profile.industry,
          };
          if (g.profile.linkedin) patch.linkedin_url = g.profile.linkedin;
          await supa.from('attendee').update(patch).eq('email', g.email);
        } else {
          await supa.from('attendee').insert({
            id: idFromEmail(g.email), email: g.email, name: g.name,
            title: g.profile.title, org: g.profile.org, school: g.profile.school,
            city: g.profile.city, industry: g.profile.industry, linkedin_url: g.profile.linkedin,
            type: 'Unknown',
          });
        }
      }

      for (const g of guests) {
        const attendeeId = idFromEmail(g.email);
        await supa.from('attendee_event').upsert(
          {
            id: `ae-${attendeeId}-${ev.id}`, attendee_id: attendeeId, event_id: ev.id,
            role_at_event: 'attendee', registration_status: g.approval ?? null, checked_in: g.checkedIn,
          },
          { onConflict: 'attendee_id,event_id' },
        );
      }
      totalGuests += guests.length;
    } catch (err) {
      console.error(JSON.stringify({ fn: 'luma-sync', event: ev.id, error: String((err as Error)?.message ?? err) }));
    }
  }
  return { events: active.length, guests: totalGuests };
}

// Manual, add-only resync of ONE event's guests. The background sync skips past (wrapped) events;
// this powers the "Resync" button so an owner can pull LATE additions into a wrapped event without
// ever overwriting or removing existing data — only guests/links we don't already have get inserted.
async function resyncEventAddOnly(supa: Supa, apiKey: string, eventId: string): Promise<{ added: number; linked: number }> {
  const { data: ev } = await supa.from('event').select('id, luma_event_id').eq('id', eventId).maybeSingle();
  if (!ev) throw new Error('Event not found.');
  if (!(ev as any).luma_event_id) throw new Error('This event is not linked to Luma.');

  const raw = await lumaAll(apiKey, '/event/get-guests', { event_api_id: (ev as any).luma_event_id });
  const guests = raw.map(readGuest).filter((g) => g.email) as (Guest & { email: string })[];
  if (!guests.length) return { added: 0, linked: 0 };

  // Add-only attendees: insert emails we don't already have; existing rows are left untouched.
  const emails = guests.map((g) => g.email);
  const { data: known } = await supa.from('attendee').select('email').in('email', emails);
  const knownEmails = new Set((known ?? []).map((r: any) => r.email));
  const newGuests = guests.filter((g) => !knownEmails.has(g.email));
  if (newGuests.length) {
    await supa.from('attendee').insert(newGuests.map((g) => ({
      id: idFromEmail(g.email), email: g.email, name: g.name,
      title: g.profile.title, org: g.profile.org, school: g.profile.school,
      city: g.profile.city, industry: g.profile.industry, linkedin_url: g.profile.linkedin,
      type: 'Unknown',
    })));
  }

  // Add-only links: insert attendee_event rows not already present for this event (no overwrite).
  const attendeeIds = guests.map((g) => idFromEmail(g.email));
  const { data: existingLinks } = await supa.from('attendee_event').select('attendee_id').eq('event_id', (ev as any).id).in('attendee_id', attendeeIds);
  const linkedSet = new Set((existingLinks ?? []).map((r: any) => r.attendee_id));
  const newLinks = guests.filter((g) => !linkedSet.has(idFromEmail(g.email)));
  if (newLinks.length) {
    await supa.from('attendee_event').insert(newLinks.map((g) => {
      const attendeeId = idFromEmail(g.email);
      return { id: `ae-${attendeeId}-${(ev as any).id}`, attendee_id: attendeeId, event_id: (ev as any).id, role_at_event: 'attendee', registration_status: g.approval ?? null, checked_in: g.checkedIn };
    }));
  }

  return { added: newGuests.length, linked: newLinks.length };
}

// The actual work — runs after the HTTP response is sent (fire-and-forget).
async function runSync(supa: Supa, apiKey: string): Promise<void> {
  const { imported, updated } = await importEvents(supa, apiKey);
  const { events, guests } = await syncGuests(supa, apiKey);
  await supa.from('app_setting').upsert({ key: 'luma_last_synced', value: new Date().toISOString() });
  console.log(JSON.stringify({ fn: 'luma-sync', done: true, imported, updated, events, guests }));
}

export async function handler(req: Request, res: Response) {
  try {
    const apiKey = process.env.LUMA_API_KEY;
    if (!apiKey) { res.status(500).json({ error: 'LUMA_API_KEY not configured on the server.' }); return; }

    const supa = getServiceClient();

    // Manual per-event add-only resync (the "Resync" button on wrapped events). Runs synchronously
    // and returns counts; bypasses both the throttle and the past-event skip.
    const eventId = req.body && typeof req.body.eventId === 'string' ? req.body.eventId : null;
    if (eventId) {
      try {
        const r = await resyncEventAddOnly(supa, apiKey, eventId);
        res.json({ status: 'resynced', ...r });
      } catch (e) {
        res.status(400).json({ error: String((e as Error)?.message ?? e) });
      }
      return;
    }

    const force = !!(req.body && req.body.force);

    // Throttle: skip if we synced within THROTTLE_MS. null value = never synced → always run.
    const { data: row } = await supa.from('app_setting').select('value').eq('key', 'luma_last_synced').maybeSingle();
    const last = (row as any)?.value ? Date.parse((row as any).value) : NaN;
    if (!force && !Number.isNaN(last) && Date.now() - last < THROTTLE_MS) {
      res.json({ status: 'skipped', reason: 'synced recently', last_synced: (row as any).value });
      return;
    }

    // Kick off the work and return immediately — the browser never waits.
    void runSync(supa, apiKey).catch((e) =>
      console.error(JSON.stringify({ fn: 'luma-sync', error: String((e as Error)?.message ?? e) })),
    );
    res.json({ status: 'syncing' });
  } catch (e) {
    console.error(JSON.stringify({ fn: 'luma-sync', error: String((e as Error)?.message ?? e) }));
    res.status(500).json({ error: String((e as Error)?.message ?? e) });
  }
}
