// DUAL-MAINTAINED: any changes here must also be made in
// cloud-functions/src/functions/gcal-sync.ts
// Edge function: push one EventHub event onto a single, toggleable Google Calendar that lives
// under the company calendar account (calendar@instalily.ai). All events land on that one
// secondary calendar, so in Google Calendar it's a single checkbox you can show/hide.
//
// Auth reuses the existing Google OAuth app (GOOGLE_CLIENT_ID/SECRET) + a refresh token for
// calendar@instalily.ai (GCAL_REFRESH_TOKEN). The dedicated calendar is auto-created on first
// sync and its id is cached in app_setting.gcal_calendar_id.
//
// POST { eventId }  → { ok, gcalEventId, calendarId, htmlLink }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const TZ = Deno.env.get("GCAL_TIMEZONE") || "America/New_York";
const CAL_SUMMARY = "EventHub Events";

async function accessToken(): Promise<string> {
  // Calendar can use its own OAuth client (GCAL_CLIENT_ID/SECRET) so it can live in a
  // GCP project you control; falls back to the shared Google client when unset.
  const clientId = Deno.env.get("GCAL_CLIENT_ID") ?? Deno.env.get("GOOGLE_CLIENT_ID")!;
  const clientSecret = Deno.env.get("GCAL_CLIENT_SECRET") ?? Deno.env.get("GOOGLE_CLIENT_SECRET")!;
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: Deno.env.get("GCAL_REFRESH_TOKEN")!,
      grant_type: "refresh_token",
    }),
  });
  const d = await r.json();
  if (!d.access_token) throw new Error(`Google token error: ${d.error ?? "no access_token"}${d.error_description ? ` — ${d.error_description}` : ""}`);
  return d.access_token as string;
}

// The single dedicated calendar: env override → cached in app_setting → auto-create once.
async function ensureCalendar(token: string, sb: ReturnType<typeof createClient>): Promise<string> {
  const envId = Deno.env.get("GCAL_CALENDAR_ID");
  if (envId) return envId;
  const { data: row } = await sb.from("app_setting").select("value").eq("key", "gcal_calendar_id").maybeSingle();
  if (row?.value) return row.value as string;
  const r = await fetch("https://www.googleapis.com/calendar/v3/calendars", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ summary: CAL_SUMMARY, timeZone: TZ }),
  });
  const cal = await r.json();
  if (!cal.id) throw new Error(`Couldn't create calendar: ${cal.error?.message ?? "unknown"}`);
  await sb.from("app_setting").upsert({ key: "gcal_calendar_id", value: cal.id });
  return cal.id as string;
}

// Build a Calendar event body from the EventHub row. Timed if start_time present, else all-day.
function buildBody(ev: any): Record<string, unknown> {
  const addDay = (d: string) => { const x = new Date(d + "T00:00:00"); x.setDate(x.getDate() + 1); return x.toISOString().slice(0, 10); };
  const descParts = [ev.description, ev.luma_url ? `Luma: ${ev.luma_url}` : null].filter(Boolean);
  const body: Record<string, unknown> = {
    summary: ev.name ?? "Untitled event",
    location: ev.location ?? undefined,
    description: descParts.join("\n\n") || undefined,
  };
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    if (!Deno.env.get("GCAL_REFRESH_TOKEN")) return json({ error: "Google Calendar not connected (GCAL_REFRESH_TOKEN unset). Run scripts/gcal-auth.mjs." }, 400);
    const { eventId } = await req.json();
    if (!eventId) return json({ error: "eventId required" }, 400);

    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const { data: ev, error } = await sb.from("event").select("id, name, event_date, start_time, end_time, location, description, luma_url, gcal_event_id").eq("id", eventId).single();
    if (error || !ev) return json({ error: "event not found" }, 404);
    if (!ev.event_date) return json({ error: "event has no date — set a date before adding to the calendar" }, 400);

    const token = await accessToken();
    const calendarId = await ensureCalendar(token, sb);
    const body = buildBody(ev);

    const base = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;
    const url = ev.gcal_event_id ? `${base}/${encodeURIComponent(ev.gcal_event_id)}` : base;
    const r = await fetch(url, {
      method: ev.gcal_event_id ? "PATCH" : "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const created = await r.json();
    if (!created.id) return json({ error: `Calendar write failed: ${created.error?.message ?? "unknown"}` }, 500);

    // Persist the id (idempotency) + web link (so the UI can deep-link to the event).
    await sb.from("event").update({ gcal_event_id: created.id, gcal_html_link: created.htmlLink ?? null }).eq("id", eventId);
    return json({ ok: true, gcalEventId: created.id, calendarId, htmlLink: created.htmlLink ?? null });
  } catch (e) {
    console.error(JSON.stringify({ fn: "gcal-sync", error: String((e as Error)?.message ?? e) }));
    return json({ error: (e as Error).message ?? String(e) }, 500);
  }
});
