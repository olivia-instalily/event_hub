#!/usr/bin/env node
// Luma → EventHub guest-list sync. Runs SERVER-SIDE with direct Postgres connection.
// Connects via Cloud SQL Proxy on localhost:9470.
//
// Secrets come from .env (gitignored):
//   LUMA_API_KEY=...
//   DB_PASSWORD=...    (from GCP Secret Manager: eventhub-db-password)
//
// Make sure Cloud SQL Proxy is running first:
//   gcloud sql connect eventhub-db --user=postgres --project=event-499220
//   (or run the proxy directly on port 9470)
//
// Usage:
//   node scripts/luma-sync.mjs list                       # list your Luma events
//   node scripts/luma-sync.mjs import-events              # import Luma events into DB
//   node scripts/luma-sync.mjs link <eventId> <lumaId>    # store the mapping
//   node scripts/luma-sync.mjs inspect <eventId>          # dump 1 raw guest
//   node scripts/luma-sync.mjs sync [eventId]             # pull guests -> upsert attendees
//   node scripts/luma-sync.mjs sync --drop-aggregate      # also remove placeholder pool

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import pg from 'pg';

// ── .env loader — MUST run before pool init so DB_PASSWORD is available ──
try {
  for (const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch { /* no .env file — rely on shell environment */ }

const pool = new pg.Pool({
  host: '127.0.0.1',
  port: 9470,
  database: 'postgres',
  user: 'postgres',
  password: process.env.DB_PASSWORD,
});

const LUMA_API_KEY = process.env.LUMA_API_KEY;
const LUMA_BASE = 'https://public-api.luma.com/v1';

function need(v, name) {
  if (!v) { console.error(`Missing ${name}. Put it in .env`); process.exit(1); }
  return v;
}

// ── Luma API helpers (unchanged) ──────────────────────────────────────────────

async function luma(path, params = {}) {
  need(LUMA_API_KEY, 'LUMA_API_KEY');
  const url = new URL(LUMA_BASE + path);
  for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, v);
  const res = await fetch(url, { headers: { 'x-luma-api-key': LUMA_API_KEY, accept: 'application/json' } });
  if (res.status === 429) throw new Error(`Luma rate limit (300/min) hit on ${path} — wait a minute and retry.`);
  if (!res.ok) throw new Error(`Luma ${path} -> ${res.status}: ${await res.text()}`);
  return res.json();
}

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

// ── commands ──────────────────────────────────────────────────────────────────

async function cmdList() {
  const events = await lumaAll('/calendar/list-events');
  if (!events.length) return console.log('No Luma events returned for this key.');
  for (const e of events) {
    const ev = e.event ?? e;
    console.log(`${ev.api_id ?? e.api_id}\t${ev.start_at ?? ''}\t${ev.name ?? ''}`);
  }
}

async function cmdImportEvents() {
  need(process.env.DB_PASSWORD, 'DB_PASSWORD');

  const { rows: existing } = await pool.query('SELECT luma_event_id FROM event WHERE luma_event_id IS NOT NULL');
  const linked = new Set(existing.map(r => r.luma_event_id));
  const today = new Date().toISOString().slice(0, 10);

  const events = await lumaAll('/calendar/list-events');
  // Policy (mirrors cloud-functions/src/functions/luma-sync.ts):
  //   • Past events (start_at < today)  → SKIP. They're wrapped; never re-import or touch.
  //   • Future events already linked    → REFRESH the Luma-owned fields in place.
  //   • Future events not yet linked     → ADD (with macro_stage 'Planning' so they route to the
  //     full planning view). macro_stage is only ever set on insert, never on refresh.
  let imported = 0, updated = 0;
  for (const entry of events) {
    const ev = entry.event ?? entry;
    const apiId = ev.api_id ?? ev.id;
    if (!apiId) continue;
    const eventDate = ev.start_at ? ev.start_at.slice(0, 10) : null;
    if (eventDate && eventDate < today) continue; // skip past — leave wrapped events frozen
    let location = null;
    try {
      const g = typeof ev.geo_address_json === 'string' ? JSON.parse(ev.geo_address_json) : ev.geo_address_json;
      location = g?.city || g?.address || g?.full_address || null;
    } catch { /* no geo */ }

    if (linked.has(apiId)) {
      // Refresh Luma-owned fields only; match on luma_event_id so a custom-id attach updates its row.
      await pool.query(
        `UPDATE event SET name = $1, luma_url = $2, cover_image_url = $3, event_date = $4, location = $5
         WHERE luma_event_id = $6`,
        [ev.name, ev.url ?? null, ev.cover_url ?? null, eventDate, location, apiId]
      );
      updated++;
    } else {
      // New future event → 'Concept' (untouched, status "future"); graduates to 'Planning' once
      // someone completes setup. Mirrors cloud-functions/src/functions/luma-sync.ts.
      await pool.query(
        `INSERT INTO event (id, name, luma_event_id, luma_url, cover_image_url, event_date, location, macro_stage)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'Concept')`,
        ['evt-luma-' + apiId.replace(/^evt-/, ''), ev.name, apiId, ev.url ?? null, ev.cover_url ?? null, eventDate, location]
      );
      imported++;
    }
  }
  console.log(`Import complete: ${imported} added, ${updated} refreshed (past events skipped).`);
}

async function cmdLink(eventId, lumaId) {
  if (!eventId || !lumaId) { console.error('usage: link <eventId> <lumaId>'); process.exit(1); }
  need(process.env.DB_PASSWORD, 'DB_PASSWORD');
  await pool.query('UPDATE event SET luma_event_id = $1 WHERE id = $2', [lumaId, eventId]);
  console.log(`Linked ${eventId} -> ${lumaId}`);
}

async function cmdInspect(eventId) {
  need(process.env.DB_PASSWORD, 'DB_PASSWORD');
  const { rows } = await pool.query('SELECT id, luma_event_id FROM event WHERE id = $1 LIMIT 1', [eventId]);
  const ev = rows[0];
  if (!ev?.luma_event_id) { console.error(`${eventId} has no luma_event_id — run \`link\` first.`); process.exit(1); }
  const data = await luma('/event/get-guests', { event_api_id: ev.luma_event_id, pagination_limit: 1 });
  console.log(JSON.stringify(data, null, 2));
}

async function cmdSync(only, dropAggregate) {
  need(process.env.DB_PASSWORD, 'DB_PASSWORD');

  let query = 'SELECT id, name, luma_event_id, event_date FROM event WHERE luma_event_id IS NOT NULL';
  const params = [];
  if (only) { query += ' AND id = $1'; params.push(only); }
  const { rows: events } = await pool.query(query, params);

  if (!events.length) return console.log('No linked events to sync. Run `link` first.');

  // On a full run, skip past events — their guest lists are wrapped, don't re-pull/overwrite.
  // An explicit `sync <eventId>` still runs (manual override for a specific past event).
  const today = new Date().toISOString().slice(0, 10);
  let ok = 0, failed = 0, totalGuests = 0;
  for (const ev of events) {
    if (!only && ev.event_date && ev.event_date < today) continue;
    try {
      const raw = await lumaAll('/event/get-guests', { event_api_id: ev.luma_event_id });
      const guests = raw.map(readGuest).filter(g => g.email);
      const skipped = raw.length - guests.length;

      // Find existing attendees to preserve their type
      const emails = guests.map(g => g.email);
      const { rows: existing } = await pool.query(
        'SELECT email FROM attendee WHERE email = ANY($1)',
        [emails]
      );
      const known = new Set(existing.map(r => r.email));

      // Upsert attendees
      for (const g of guests) {
        const isNew = !known.has(g.email);
        await pool.query(
          `INSERT INTO attendee (id, email, name, title, org, school, city, industry, linkedin_url, type)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           ON CONFLICT (email) DO UPDATE SET
             name = EXCLUDED.name,
             title = EXCLUDED.title,
             org = EXCLUDED.org,
             school = EXCLUDED.school,
             city = EXCLUDED.city,
             industry = EXCLUDED.industry,
             linkedin_url = COALESCE(EXCLUDED.linkedin_url, attendee.linkedin_url)`,
          [
            idFromEmail(g.email),
            g.email,
            g.name,
            g.profile.title,
            g.profile.org,
            g.profile.school,
            g.profile.city,
            g.profile.industry,
            g.profile.linkedin,
            isNew ? 'Unknown' : null, // type: set for new rows only, ignored in UPDATE SET
          ]
        );
      }

      // Upsert attendee_event links
      for (const g of guests) {
        const attendeeId = idFromEmail(g.email);
        const linkId = `ae-${attendeeId}-${ev.id}`;
        await pool.query(
          `INSERT INTO attendee_event (id, attendee_id, event_id, role_at_event, registration_status, checked_in)
           VALUES ($1, $2, $3, 'attendee', $4, $5)
           ON CONFLICT (attendee_id, event_id) DO UPDATE SET
             registration_status = EXCLUDED.registration_status,
             checked_in = EXCLUDED.checked_in`,
          [linkId, attendeeId, ev.id, g.approval ?? null, g.checkedIn]
        );
      }

      ok++; totalGuests += guests.length;
      console.log(`ok  ${ev.id} (${ev.name}): ${guests.length} guests upserted${skipped ? `, ${skipped} skipped (no email)` : ''}.`);
    } catch (err) {
      failed++;
      console.error(`FAIL ${ev.id} (${ev.name}): ${err?.message ?? err}`);
    }
  }

  console.log(`Sync complete: ${ok}/${events.length} events ok, ${failed} failed, ${totalGuests} guests upserted.`);
  if (failed) process.exitCode = 1;

  if (dropAggregate) {
    await pool.query(`DELETE FROM attendee_event WHERE attendee_id = 'att-candidates-pool'`);
    await pool.query(`DELETE FROM attendee WHERE id = 'att-candidates-pool'`);
    console.log('Dropped the aggregate candidate pool (att-candidates-pool).');
  }
}

// ── dispatch ──────────────────────────────────────────────────────────────────
const [cmd, ...rest] = process.argv.slice(2);
const dropAggregate = rest.includes('--drop-aggregate');
const positional = rest.filter(a => !a.startsWith('--'));

try {
  switch (cmd) {
    case 'list':          await cmdList(); break;
    case 'import-events': await cmdImportEvents(); break;
    case 'link':          await cmdLink(positional[0], positional[1]); break;
    case 'inspect':       await cmdInspect(positional[0]); break;
    case 'sync':          await cmdSync(positional[0], dropAggregate); break;
    default:
      console.log('commands: list | import-events | link <eventId> <lumaId> | inspect <eventId> | sync [eventId] [--drop-aggregate]');
  }
} catch (err) {
  console.error(`luma-sync ${cmd ?? ''} failed: ${err?.message ?? err}`);
  process.exit(1);
} finally {
  await pool.end();
}