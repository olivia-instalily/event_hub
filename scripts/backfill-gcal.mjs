#!/usr/bin/env node
// ONE-OFF: backfill existing EventHub events onto Google Calendar.
//
// Safety model (read this before running):
//   • Default mode is --report: reads the DB + Calendar and prints a plan. Writes NOTHING.
//   • The ONLY change ever made to a pre-existing Google Calendar event is APPENDING
//     "EventHub: <link>" to its description. Title, time, location, colour are never touched,
//     and nothing is deleted.
//   • Fresh events are created only where no similar event exists.
//   • Anything uncertain (2+ matches, weak name overlap, or a date off by a day) is reported
//     as AMBIGUOUS and left completely untouched — for a human to adjudicate.
//
// Runs SERVER-SIDE against PRODUCTION, like scripts/luma-sync.mjs:
//   • Postgres via the Cloud SQL Proxy on 127.0.0.1:9470 (DB_PASSWORD from ../.env).
//     Start it first, e.g.:  gcloud sql connect eventhub-db --user=postgres --project=event-499220
//   • Google Calendar via GCAL_REFRESH_TOKEN / GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET from ../.env.
//
// Usage:
//   node scripts/backfill-gcal.mjs                 # report only (safe, no writes) — DEFAULT
//   node scripts/backfill-gcal.mjs --apply         # create + confident-link the clear cases
//   node scripts/backfill-gcal.mjs --apply --decisions decisions.json
//                                                  # also act on adjudicated ambiguous events
//
// decisions.json (for the follow-up apply of ambiguous events):
//   { "<eventId>": { "action": "create" } }
//   { "<eventId>": { "action": "skip" } }
//   { "<eventId>": { "action": "link", "links": { "primary": "<gid>", "<coordCalId>": "<gid>" } } }

import { readFileSync } from "node:fs";
import pg from "pg";
import { classify, EVENTHUB_MARKER } from "./backfill-gcal.classify.mjs";

// ── .env loader — MUST run before pool init ──────────────────────────────────
try {
  for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch { /* rely on shell environment */ }

const APPLY = process.argv.includes("--apply");
const decisionsPath = (() => {
  const i = process.argv.indexOf("--decisions");
  return i >= 0 ? process.argv[i + 1] : null;
})();
const DECISIONS = decisionsPath ? JSON.parse(readFileSync(decisionsPath, "utf8")) : {};

// ── Config (mirrors supabase/functions/gcal-sync/index.ts) ───────────────────
const TZ = process.env.GCAL_TIMEZONE || "America/New_York";
const PRIMARY = "primary";
const COORD =
  process.env.GCAL_COORDINATION_CALENDAR_ID ||
  "c_fad28a2710da5efc5126158eae561ee3107d4afc395bbc595f051f0117a1d0fd@group.calendar.google.com";
const CALENDARS = [PRIMARY, COORD];
const EVENT_COLOR_ID = "9";
const APP_ORIGIN = (process.env.APP_ORIGIN || "https://eventhub-15951963035.us-central1.run.app").replace(/\/+$/, "");

function need(v, name) {
  if (!v) { console.error(`Missing ${name}. Put it in .env`); process.exit(1); }
  return v;
}

const pool = new pg.Pool({
  host: "127.0.0.1", port: 9470, database: "postgres", user: "postgres",
  password: process.env.DB_PASSWORD,
});

// ── Google OAuth (verbatim from gcal-sync) ───────────────────────────────────
async function accessToken() {
  const clientId = process.env.GCAL_CLIENT_ID || process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GCAL_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET;
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId, client_secret: clientSecret,
      refresh_token: process.env.GCAL_REFRESH_TOKEN, grant_type: "refresh_token",
    }),
  });
  const d = await r.json();
  if (!d.access_token) throw new Error(`Google token error: ${d.error ?? "no access_token"}${d.error_description ? ` — ${d.error_description}` : ""}`);
  return d.access_token;
}

// ── Calendar REST + body builder (verbatim from gcal-sync) ───────────────────
const GCAL_BASE = "https://www.googleapis.com/calendar/v3";
const addDay = (d) => { const x = new Date(d + "T00:00:00"); x.setDate(x.getDate() + 1); return x.toISOString().slice(0, 10); };

function gcalTitle(name, location) {
  const n = (name ?? "Untitled event").trim();
  const loc = (location ?? "").trim();
  return loc ? `${n} · ${loc}` : n;
}
function appLink(eventId) { return `${APP_ORIGIN}/?event=${encodeURIComponent(eventId)}`; }

function buildBody(ev) {
  const descParts = [ev.description, ev.luma_url ? `Luma: ${ev.luma_url}` : null, `${EVENTHUB_MARKER} ${appLink(ev.id)}`].filter(Boolean);
  const body = { summary: gcalTitle(ev.name, ev.location), location: ev.location ?? undefined, description: descParts.join("\n\n") || undefined, colorId: EVENT_COLOR_ID };
  if (ev.start_time) {
    const end = ev.end_time || ev.start_time;
    body.start = { dateTime: `${ev.event_date}T${ev.start_time}:00`, timeZone: TZ };
    body.end = { dateTime: `${ev.event_date}T${end}:00`, timeZone: TZ };
  } else {
    body.start = { date: ev.event_date };
    body.end = { date: addDay(ev.event_date) };
  }
  return body;
}

async function gcalListWindow(token, calId, dateFrom, dateTo) {
  const params = new URLSearchParams({ timeMin: `${dateFrom}T00:00:00Z`, timeMax: `${dateTo}T00:00:00Z`, singleEvents: "true", maxResults: "50" });
  const r = await fetch(`${GCAL_BASE}/calendars/${encodeURIComponent(calId)}/events?${params}`, { headers: { Authorization: `Bearer ${token}` } });
  const d = await r.json();
  if (d.error) throw new Error(`list ${calId} failed: ${d.error.message}`);
  return d.items ?? [];
}
async function gcalInsert(token, calId, body) {
  const r = await fetch(`${GCAL_BASE}/calendars/${encodeURIComponent(calId)}/events`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const d = await r.json();
  if (!d.id) throw new Error(`insert ${calId} failed: ${d.error?.message ?? "unknown"}`);
  return d;
}
// Soft-link: append the EventHub marker to a pre-existing event's description. Fetches the current
// description first so nothing already there is lost. Title/time/colour are left untouched.
async function gcalAppendMarker(token, calId, gid, eventId) {
  const g = await fetch(`${GCAL_BASE}/calendars/${encodeURIComponent(calId)}/events/${encodeURIComponent(gid)}`, { headers: { Authorization: `Bearer ${token}` } });
  const cur = await g.json();
  if (!cur.id) throw new Error(`get ${calId}/${gid} failed: ${cur.error?.message ?? "unknown"}`);
  const existing = (cur.description ?? "").trim();
  const description = existing ? `${existing}\n\n${EVENTHUB_MARKER} ${appLink(eventId)}` : `${EVENTHUB_MARKER} ${appLink(eventId)}`;
  const r = await fetch(`${GCAL_BASE}/calendars/${encodeURIComponent(calId)}/events/${encodeURIComponent(gid)}`, { method: "PATCH", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ description }) });
  const d = await r.json();
  if (!d.id) throw new Error(`patch ${calId}/${gid} failed: ${d.error?.message ?? "unknown"}`);
  return d;
}

const windowFor = (date) => {
  const shift = (n) => { const x = new Date(date + "T00:00:00"); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
  return { from: shift(-1), to: shift(2) };
};
const fmt = (ev) => `${ev.name}  [${ev.event_date}${ev.start_time ? " " + ev.start_time : ""}]  ${ev.id}`;

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  need(process.env.DB_PASSWORD, "DB_PASSWORD");
  need(process.env.GCAL_REFRESH_TOKEN, "GCAL_REFRESH_TOKEN");

  console.log(`\n=== Google Calendar backfill — ${APPLY ? "APPLY (writing)" : "REPORT ONLY (no writes)"} ===`);
  console.log(`App origin: ${APP_ORIGIN}`);
  console.log(`Calendars:  primary + coordination\n`);

  const token = await accessToken();

  // event_date is a real DATE (pg → JS Date); to_char it to the 'YYYY-MM-DD' string the shared
  // classifier/body logic expects. start_time/end_time are already 'HH:MM' text.
  const { rows } = await pool.query(
    `SELECT id, name,
            to_char(event_date, 'YYYY-MM-DD') AS event_date,
            start_time, end_time,
            location, description, luma_url,
            gcal_event_id, gcal_event_ids
       FROM event
      WHERE event_date IS NOT NULL AND is_template = false
      ORDER BY event_date`,
  );

  const alreadySynced = [], toCreate = [], toLink = [], ambiguous = [];

  for (const ev of rows) {
    const ids = ev.gcal_event_ids && typeof ev.gcal_event_ids === "object" ? ev.gcal_event_ids : {};
    if (ev.gcal_event_id || Object.keys(ids).length > 0) { alreadySynced.push(ev); continue; }

    // Classify per calendar. If ANY calendar is ambiguous, hold the whole event for review.
    const win = windowFor(ev.event_date);
    const perCal = {};
    let anyAmbiguous = null;
    for (const calId of CALENDARS) {
      const items = await gcalListWindow(token, calId, win.from, win.to);
      const verdict = classify(ev, items);
      perCal[calId] = verdict;
      if (verdict.bucket === "ambiguous") anyAmbiguous = { calId, verdict };
    }

    if (anyAmbiguous) { ambiguous.push({ ev, perCal }); continue; }
    if (Object.values(perCal).some((v) => v.bucket === "confident")) toLink.push({ ev, perCal });
    else toCreate.push({ ev, perCal });
  }

  // ── Ledger ─────────────────────────────────────────────────────────────────
  console.log(`Already synced (skipped): ${alreadySynced.length}`);

  console.log(`\n── WILL CREATE (no similar event found): ${toCreate.length} ──`);
  for (const { ev } of toCreate) console.log(`  + ${fmt(ev)}`);

  console.log(`\n── CONFIDENT LINK (append EventHub marker to an existing event): ${toLink.length} ──`);
  for (const { ev, perCal } of toLink) {
    console.log(`  ~ ${fmt(ev)}`);
    for (const calId of CALENDARS) {
      const v = perCal[calId];
      if (v.bucket === "confident") console.log(`      link → "${v.candidate.summary}" (${calId === PRIMARY ? "primary" : "coord"})  ${v.candidate.htmlLink}`);
      else console.log(`      create on ${calId === PRIMARY ? "primary" : "coord"} (no match there)`);
    }
  }

  console.log(`\n── AMBIGUOUS — NOT TOUCHED, needs your call: ${ambiguous.length} ──`);
  for (const { ev, perCal } of ambiguous) {
    console.log(`  ? ${fmt(ev)}`);
    for (const calId of CALENDARS) {
      const v = perCal[calId];
      const label = calId === PRIMARY ? "primary" : "coord";
      if (v.bucket === "ambiguous") for (const c of v.candidates) console.log(`      ${label} candidate: "${c.summary}" [${c.start.date ?? c.start.dateTime}]  id=${c.id}  ${c.htmlLink}`);
    }
  }

  // ── Apply ────────────────────────────────────────────────────────────────────
  if (!APPLY) {
    console.log(`\n(report only — re-run with --apply to write the CREATE + CONFIDENT LINK actions above)\n`);
    await pool.end();
    return;
  }

  console.log(`\n=== APPLYING ===`);
  const writeBack = async (ev, links, htmlLinks) => {
    const primaryGid = links[PRIMARY] ?? Object.values(links)[0] ?? null;
    const primaryHtml = htmlLinks[PRIMARY] ?? Object.values(htmlLinks)[0] ?? null;
    await pool.query(
      `UPDATE event SET gcal_event_ids = $2, gcal_event_id = $3, gcal_html_link = $4 WHERE id = $1`,
      [ev.id, JSON.stringify(links), primaryGid, primaryHtml],
    );
  };

  const doEvent = async (ev, perCal) => {
    const links = {}, htmlLinks = {};
    for (const calId of CALENDARS) {
      const v = perCal[calId];
      if (v.bucket === "confident") {
        const patched = await gcalAppendMarker(token, calId, v.candidate.id, ev.id);
        links[calId] = v.candidate.id; htmlLinks[calId] = patched.htmlLink ?? v.candidate.htmlLink;
        console.log(`  linked   ${ev.name} → ${calId === PRIMARY ? "primary" : "coord"} (${v.candidate.id})`);
      } else {
        const created = await gcalInsert(token, calId, buildBody(ev));
        links[calId] = created.id; htmlLinks[calId] = created.htmlLink ?? null;
        console.log(`  created  ${ev.name} → ${calId === PRIMARY ? "primary" : "coord"} (${created.id})`);
      }
    }
    await writeBack(ev, links, htmlLinks);
  };

  for (const { ev, perCal } of [...toCreate, ...toLink]) await doEvent(ev, perCal);

  // Adjudicated ambiguous events, only if a decisions file was supplied.
  for (const { ev } of ambiguous) {
    const d = DECISIONS[ev.id];
    if (!d || d.action === "skip") { console.log(`  skipped  ${ev.name} (ambiguous, no decision)`); continue; }
    if (d.action === "create") {
      const links = {}, htmlLinks = {};
      for (const calId of CALENDARS) { const c = await gcalInsert(token, calId, buildBody(ev)); links[calId] = c.id; htmlLinks[calId] = c.htmlLink ?? null; }
      await writeBack(ev, links, htmlLinks);
      console.log(`  created  ${ev.name} (decision: create)`);
    } else if (d.action === "link") {
      // Link on every calendar named in d.links (append marker only); create a fresh copy on any
      // calendar NOT named, so the event still lands on both — matching prod's dual-write.
      const links = {}, htmlLinks = {};
      for (const calId of CALENDARS) {
        const gid = d.links?.[calId];
        if (gid) { const p = await gcalAppendMarker(token, calId, gid, ev.id); links[calId] = gid; htmlLinks[calId] = p.htmlLink ?? null; console.log(`  linked   ${ev.name} → ${calId === PRIMARY ? "primary" : "coord"} (${gid})`); }
        else { const c = await gcalInsert(token, calId, buildBody(ev)); links[calId] = c.id; htmlLinks[calId] = c.htmlLink ?? null; console.log(`  created  ${ev.name} → ${calId === PRIMARY ? "primary" : "coord"} (${c.id})`); }
      }
      await writeBack(ev, links, htmlLinks);
    }
  }

  console.log(`\nDone.\n`);
  await pool.end();
}

main().catch((e) => { console.error(e); pool.end(); process.exit(1); });
