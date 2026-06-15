#!/usr/bin/env node
// Luma → Assembly guest-list sync. Runs SERVER-SIDE with the service-role key.
// Host-only guest emails never touch the browser. Dedupes attendees by email.
//
// Secrets come from .env (gitignored, NO VITE_ prefix so Vite can't bundle them):
//   LUMA_API_KEY=...
//   SUPABASE_URL=http://127.0.0.1:54321        (optional; this is the default)
//   SUPABASE_SERVICE_KEY=...                    (from `supabase status` -> SERVICE_ROLE_KEY)
//
// Usage:
//   node scripts/luma-sync.mjs list                       # list your Luma events (id + name)
//   node scripts/luma-sync.mjs link <eventId> <lumaId>    # store the mapping
//   node scripts/luma-sync.mjs inspect <eventId>          # dump 1 raw guest (lock field paths)
//   node scripts/luma-sync.mjs sync [eventId]             # pull guests -> upsert attendees+links
//   node scripts/luma-sync.mjs sync --drop-aggregate      # also remove the 20-30 placeholder pool

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

// ── tiny .env loader (avoids a dotenv dep; only sets vars not already in the env) ──
try {
  for (const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch { /* no .env file — rely on the shell environment */ }

const LUMA_API_KEY = process.env.LUMA_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL || 'http://127.0.0.1:54321';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const LUMA_BASE = 'https://public-api.luma.com/v1';

function need(v, name) {
  if (!v) { console.error(`Missing ${name}. Put it in .env (see comment at top of this file).`); process.exit(1); }
  return v;
}

async function luma(path, params = {}) {
  need(LUMA_API_KEY, 'LUMA_API_KEY');
  const url = new URL(LUMA_BASE + path);
  for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, v);
  const res = await fetch(url, { headers: { 'x-luma-api-key': LUMA_API_KEY, accept: 'application/json' } });
  if (res.status === 429) { console.error('Luma rate limit (300/min) hit — wait a minute and retry.'); process.exit(1); }
  if (!res.ok) { console.error(`Luma ${path} -> ${res.status}: ${await res.text()}`); process.exit(1); }
  return res.json();
}

// Page through any Luma list endpoint that uses entries + has_more + next_cursor.
async function lumaAll(path, params = {}) {
  const out = [];
  let cursor = undefined;
  do {
    const data = await luma(path, { ...params, pagination_limit: 100, pagination_cursor: cursor });
    out.push(...(data.entries ?? data.data ?? []));
    cursor = data.has_more ? (data.next_cursor ?? data.pagination_cursor) : undefined;
  } while (cursor);
  return out;
}

function db() {
  need(SUPABASE_SERVICE_KEY, 'SUPABASE_SERVICE_KEY');
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
}

// Defensive field extraction — the live shape gets confirmed via `inspect` before we trust it.
// Pull profile fields out of Luma's free-form registration_answers (labels vary per
// event, so match on keywords). LinkedIn is rarely asked — captured only if present.
function extractProfile(answers) {
  const p = { title: null, org: null, school: null, city: null, industry: null, linkedin: null };
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

function readGuest(entry) {
  const g = entry.guest ?? entry.user ?? entry;
  const email = (g.email ?? g.user_email ?? g.guest_email ?? g.user?.email ?? '').trim().toLowerCase() || null;
  const name = g.name ?? g.user_name ?? g.guest_name ?? g.user?.name ?? null;
  const approval = g.approval_status ?? g.status ?? null;
  const checkedIn = Boolean(g.checked_in_at ?? g.checked_in_at_timestamp ?? g.checked_in === true);
  const profile = extractProfile(g.registration_answers);
  return { email, name, approval, checkedIn, profile };
}

const idFromEmail = (email) => 'att-' + createHash('sha1').update(email).digest('hex').slice(0, 16);

// ── commands ────────────────────────────────────────────────────────────────
async function cmdList() {
  const events = await lumaAll('/calendar/list-events');
  if (!events.length) return console.log('No Luma events returned for this key.');
  for (const e of events) {
    const ev = e.event ?? e;
    console.log(`${ev.api_id ?? e.api_id}\t${ev.start_at ?? ''}\t${ev.name ?? ''}`);
  }
}

async function cmdImportEvents() {
  const sb = db();
  const { data: existing } = await sb.from('event').select('luma_event_id');
  const linked = new Set((existing ?? []).map((r) => r.luma_event_id).filter(Boolean));

  const events = await lumaAll('/calendar/list-events');
  const rows = [];
  for (const entry of events) {
    const ev = entry.event ?? entry;
    const apiId = ev.api_id ?? ev.id;
    if (!apiId || linked.has(apiId)) continue; // skip events already in the DB
    let location = null;
    try {
      const g = typeof ev.geo_address_json === 'string' ? JSON.parse(ev.geo_address_json) : ev.geo_address_json;
      location = g?.city || g?.address || g?.full_address || null;
    } catch { /* no geo */ }
    rows.push({
      id: 'evt-luma-' + apiId.replace(/^evt-/, ''),
      name: ev.name,
      luma_event_id: apiId,
      luma_url: ev.url ?? null,
      cover_image_url: ev.cover_url ?? null,
      event_date: ev.start_at ? ev.start_at.slice(0, 10) : null,
      location,
    });
  }
  if (!rows.length) return console.log('Nothing new to import — all Luma events already in the DB.');
  const { error } = await sb.from('event').upsert(rows, { onConflict: 'id' });
  if (error) { console.error(error); process.exit(1); }
  console.log(`Imported ${rows.length} Luma events.`);
}

async function cmdLink(eventId, lumaId) {
  if (!eventId || !lumaId) { console.error('usage: link <eventId> <lumaId>'); process.exit(1); }
  const { error } = await db().from('event').update({ luma_event_id: lumaId }).eq('id', eventId);
  if (error) { console.error(error); process.exit(1); }
  console.log(`Linked ${eventId} -> ${lumaId}`);
}

async function cmdInspect(eventId) {
  const { data: ev } = await db().from('event').select('id, luma_event_id').eq('id', eventId).maybeSingle();
  if (!ev?.luma_event_id) { console.error(`${eventId} has no luma_event_id — run \`link\` first.`); process.exit(1); }
  const data = await luma('/event/get-guests', { event_api_id: ev.luma_event_id, pagination_limit: 1 });
  console.log(JSON.stringify(data, null, 2));
}

async function cmdSync(only, dropAggregate) {
  const sb = db();
  let q = sb.from('event').select('id, name, luma_event_id').not('luma_event_id', 'is', null);
  if (only) q = q.eq('id', only);
  const { data: events, error } = await q;
  if (error) { console.error(error); process.exit(1); }
  if (!events?.length) return console.log('No linked events to sync. Run `link` first.');

  for (const ev of events) {
    const raw = await lumaAll('/event/get-guests', { event_api_id: ev.luma_event_id });
    const guests = raw.map(readGuest).filter((g) => g.email);
    const skipped = raw.length - guests.length;

    // Preserve existing type (don't clobber Partner/Hire) — only set type on brand-new rows.
    const emails = guests.map((g) => g.email);
    const { data: existing } = await sb.from('attendee').select('email').in('email', emails);
    const known = new Set((existing ?? []).map((r) => r.email));

    const attendees = guests.map((g) => {
      const row = {
        id: idFromEmail(g.email),
        email: g.email,
        name: g.name,
        title: g.profile.title,
        org: g.profile.org,
        school: g.profile.school,
        city: g.profile.city,
        industry: g.profile.industry,
      };
      if (!known.has(g.email)) row.type = 'Unknown'; // Luma can't tell us Client/Hire/Partner
      if (g.profile.linkedin) row.linkedin_url = g.profile.linkedin; // never overwrite a manual one with null
      return row;
    });
    const links = guests.map((g) => ({
      id: `ae-${idFromEmail(g.email)}-${ev.id}`,
      attendee_id: idFromEmail(g.email),
      event_id: ev.id,
      role_at_event: 'attendee',
      registration_status: g.approval ?? null,
      checked_in: g.checkedIn,
    }));

    const e1 = (await sb.from('attendee').upsert(attendees, { onConflict: 'email' })).error;
    const e2 = (await sb.from('attendee_event').upsert(links, { onConflict: 'attendee_id,event_id' })).error;
    if (e1 || e2) { console.error(e1 ?? e2); process.exit(1); }

    console.log(`${ev.id} (${ev.name}): ${guests.length} guests upserted${skipped ? `, ${skipped} skipped (no email)` : ''}.`);
  }

  if (dropAggregate) {
    const sb2 = db();
    await sb2.from('attendee_event').delete().eq('attendee_id', 'att-candidates-pool');
    await sb2.from('attendee').delete().eq('id', 'att-candidates-pool');
    console.log('Dropped the aggregate candidate pool (att-candidates-pool).');
  }
}

// ── dispatch ──────────────────────────────────────────────────────────────────
const [cmd, ...rest] = process.argv.slice(2);
const dropAggregate = rest.includes('--drop-aggregate');
const positional = rest.filter((a) => !a.startsWith('--'));

switch (cmd) {
  case 'list': await cmdList(); break;
  case 'import-events': await cmdImportEvents(); break;
  case 'link': await cmdLink(positional[0], positional[1]); break;
  case 'inspect': await cmdInspect(positional[0]); break;
  case 'sync': await cmdSync(positional[0], dropAggregate); break;
  default:
    console.log('commands: list | link <eventId> <lumaId> | inspect <eventId> | sync [eventId] [--drop-aggregate]');
}
