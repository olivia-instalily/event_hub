// DUAL-MAINTAINED: any changes here must also be made in
// cloud-functions/src/functions/gcal-sync.ts

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ── Inlined from cloud-functions/src/functions/gcal-helpers.ts ───────────────
// (Deno cannot import Node modules; keep these verbatim with the Node source.)

export const EVENTHUB_MARKER = "EventHub:";
export interface Span { start: string; end: string; allDay: boolean }

export function gcalTitle(name: string | null, location: string | null): string {
  const n = (name ?? "Untitled event").trim();
  const loc = (location ?? "").trim();
  return loc ? `${n} · ${loc}` : n;
}

export function isEligible(ev: { event_date: string | null; is_template: boolean }): boolean {
  return !!ev.event_date && !ev.is_template;
}

export function isOwned(description: string | null | undefined): boolean {
  return !!description && description.includes(EVENTHUB_MARKER);
}

// Millisecond bounds; all-day dates parse at local midnight. Overlap is half-open [start,end).
function ms(iso: string): number { return new Date(iso.length === 10 ? iso + "T00:00:00" : iso).getTime(); }
export function timeOverlap(a: Span, b: Span): boolean {
  return ms(a.start) < ms(b.end) && ms(b.start) < ms(a.end);
}

// Normalized token-set similarity: lowercased, punctuation stripped. Match when every token of the
// shorter title appears in the longer (token-level containment), or Jaccard overlap of the word sets
// ≥ 0.5. Containment is token-based (not letter-concatenated) so "Ana" does NOT match "Banana Split".
function tokens(s: string): Set<string> {
  return new Set(s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean));
}
export function nameSimilar(a: string, b: string): boolean {
  const ta = tokens(a), tb = tokens(b);
  if (!ta.size || !tb.size) return false;
  const [small, big] = ta.size <= tb.size ? [ta, tb] : [tb, ta];
  let inter = 0; for (const t of small) if (big.has(t)) inter++;
  if (inter === small.size) return true;      // every token of the shorter title is in the longer
  const union = ta.size + tb.size - inter;
  return union > 0 && inter / union >= 0.5;    // else fall back to Jaccard overlap
}

// ── End inlined helpers ───────────────────────────────────────────────────────

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const TZ = Deno.env.get("GCAL_TIMEZONE") || "America/New_York";
const PRIMARY = "primary";
const COORD = () =>
  Deno.env.get("GCAL_COORDINATION_CALENDAR_ID") ??
  "c_fad28a2710da5efc5126158eae561ee3107d4afc395bbc595f051f0117a1d0fd@group.calendar.google.com";
const CALENDARS = () => [PRIMARY, COORD()];
const EVENT_COLOR_ID = "9";

// ── OAuth ────────────────────────────────────────────────────────────────────

async function accessToken(): Promise<string> {
  const clientId     = Deno.env.get("GCAL_CLIENT_ID") ?? Deno.env.get("GOOGLE_CLIENT_ID")!;
  const clientSecret = Deno.env.get("GCAL_CLIENT_SECRET") ?? Deno.env.get("GOOGLE_CLIENT_SECRET")!;
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId, client_secret: clientSecret,
      refresh_token: Deno.env.get("GCAL_REFRESH_TOKEN")!,
      grant_type: "refresh_token",
    }),
  });
  const d = await r.json() as any;
  if (!d.access_token) throw new Error(`Google token error: ${d.error ?? "no access_token"}${d.error_description ? ` — ${d.error_description}` : ""}`);
  return d.access_token as string;
}

// ── Deep link ────────────────────────────────────────────────────────────────

// Derives the EventHub deep link from body.appOrigin if provided, else from request headers.
function appLinkFor(req: Request, eventId: string): string | null {
  let origin = req.headers.get("origin") || "";
  if (!origin) { try { origin = new URL(req.headers.get("referer") || "").origin; } catch { origin = ""; } }
  return origin ? `${origin.replace(/\/+$/, "")}/?event=${encodeURIComponent(eventId)}` : null;
}

function makeAppLink(req: Request, eventId: string, appOrigin?: string): string | null {
  if (appOrigin) return `${appOrigin.replace(/\/+$/, "")}/?event=${encodeURIComponent(eventId)}`;
  return appLinkFor(req, eventId);
}

// ── Body builder ─────────────────────────────────────────────────────────────

function buildBody(ev: any, appLink: string | null): Record<string, unknown> {
  const addDay = (d: string) => { const x = new Date(d + "T00:00:00"); x.setDate(x.getDate() + 1); return x.toISOString().slice(0, 10); };
  const descParts = [ev.description, ev.luma_url ? `Luma: ${ev.luma_url}` : null, appLink ? `EventHub: ${appLink}` : null].filter(Boolean);
  const body: Record<string, unknown> = {
    summary: gcalTitle(ev.name, ev.location),
    location: ev.location ?? undefined,
    description: descParts.join("\n\n") || undefined,
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

const GCAL_BASE = "https://www.googleapis.com/calendar/v3";

async function gcalInsert(token: string, calId: string, body: Record<string, unknown>): Promise<any> {
  const r = await fetch(`${GCAL_BASE}/calendars/${encodeURIComponent(calId)}/events`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return r.json();
}

async function gcalPatch(token: string, calId: string, gid: string, body: Record<string, unknown>): Promise<any> {
  const r = await fetch(`${GCAL_BASE}/calendars/${encodeURIComponent(calId)}/events/${encodeURIComponent(gid)}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return r.json();
}

async function gcalDelete(token: string, calId: string, gid: string): Promise<void> {
  const r = await fetch(`${GCAL_BASE}/calendars/${encodeURIComponent(calId)}/events/${encodeURIComponent(gid)}`, {
    method: "DELETE",
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
    singleEvents: "true",
    maxResults: "50",
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
  const addDay = (d: string) => { const x = new Date(d + "T00:00:00"); x.setDate(x.getDate() + 1); return x.toISOString().slice(0, 10); };
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
  const addDays = (d: string, n: number) => { const x = new Date(d + "T00:00:00"); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
  const dateFrom = addDays(date, -1);
  const dateTo   = addDays(date, 2); // exclusive upper bound → +2 so window covers date+1 fully
  // Fix 3: timeMin/timeMax are Z-anchored but the ±1-day window is a 3-day UTC span, wider than any real timezone offset, so events dated D always fall inside it regardless of local time.

  const items = await gcalListWindow(token, calId, dateFrom, dateTo);
  const eSpan = eventSpan(ev);

  for (const item of items) {
    const cSpan = candidateSpan(item);
    if (
      timeOverlap(eSpan, cSpan) &&
      nameSimilar(ev.name ?? "", item.summary ?? "") &&
      !isOwned(item.description)
    ) {
      return {
        gcalEventId: item.id,
        summary: item.summary,
        start: item.start.dateTime ?? item.start.date ?? "",
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
  if (!result.id) throw new Error(`Calendar write failed on ${calId}: ${result.error?.message ?? "unknown"}`);
  return { calId, gid: result.id, htmlLink: result.htmlLink ?? null };
}

// ── Handler ───────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    // Guard: OAuth token must be configured
    if (!Deno.env.get("GCAL_REFRESH_TOKEN")) {
      return json({ error: "Google Calendar not connected (GCAL_REFRESH_TOKEN unset). Run scripts/gcal-auth.mjs." }, 400);
    }

    const { eventId, action = "auto", appOrigin } = await req.json() as {
      eventId?: string;
      action?: "auto" | "link" | "create" | "delete";
      appOrigin?: string;
    };
    if (!eventId) return json({ error: "eventId required" }, 400);

    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const { data: ev, error } = await sb
      .from("event")
      .select("id, name, event_date, start_time, end_time, location, description, luma_url, is_template, gcal_event_ids, gcal_match_pending")
      .eq("id", eventId)
      .single();
    if (error || !ev) return json({ error: "event not found" }, 404);

    const ids: Record<string, string> = (ev as any).gcal_event_ids ?? {};
    // Fix 2: capture calendar ids once so coordId is provably the same key used in
    // gcal_match_pending, upsert loops, and write-back (no repeated env reads).
    const cals = CALENDARS(); // cals[0] = primary, cals[1] = coordination

    // ── action: delete (before eligibility guard so any event can be un-synced) ──
    if (action === "delete") {
      const token = await accessToken();
      for (const [calId, gid] of Object.entries(ids)) {
        await gcalDelete(token, calId, gid);
      }
      await sb.from("event").update({
        gcal_event_ids: {},
        gcal_event_id: null,
        gcal_html_link: null,
        gcal_match_pending: null,
      }).eq("id", eventId);
      return json({ ok: true, status: "deleted" });
    }

    // ── Eligibility guard ─────────────────────────────────────────────────────
    if (!isEligible(ev as any)) {
      return json({ error: "event has no date, or is a template — not synced" }, 400);
    }

    const token   = await accessToken();
    const appLink = makeAppLink(req, eventId, appOrigin);

    // ── action: auto (first sync) — look for candidates before creating ───────
    if (action === "auto" && Object.keys(ids).length === 0) {
      const [candP, candC] = await Promise.all([
        findCandidate(token, cals[0], ev),
        findCandidate(token, cals[1], ev),
      ]);

      if (candP !== null || candC !== null) {
        const pending: Record<string, Candidate | null> = {
          [cals[0]]: candP,
          [cals[1]]: candC,
        };
        await sb.from("event").update({ gcal_match_pending: pending }).eq("id", eventId);
        return json({ ok: true, status: "needs_confirmation", candidates: pending });
      }
      // No candidates found — fall through to create on both calendars below
    }

    // ── action: link — adopt pending candidates, create where none ────────────
    if (action === "link") {
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
                if (!patched.id) throw new Error(`gcalPatch failed on ${calId}: ${patched.error?.message ?? "unknown"}`);
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
        if (outcome.status === "fulfilled") {
          const r = outcome.value;
          nextIds[r.calId] = r.gid;
          if (r.calId === PRIMARY) primaryHtmlLink = r.htmlLink;
        } else {
          errors.push(String((outcome.reason as any)?.message ?? outcome.reason));
        }
      }
      await sb.from("event").update({
        gcal_event_ids: nextIds,
        gcal_event_id: nextIds[PRIMARY] ?? null,
        gcal_html_link: primaryHtmlLink ?? (ev as any).gcal_html_link ?? null,
        gcal_match_pending: null,
      }).eq("id", eventId);

      if (errors.length > 0) {
        return json({ ok: false, status: "partial", gcalEventIds: nextIds, errors }, 207);
      } else {
        return json({ ok: true, status: "synced", gcalEventIds: nextIds, htmlLink: primaryHtmlLink });
      }
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
      if (outcome.status === "fulfilled") {
        const r = outcome.value;
        nextIds[r.calId] = r.gid;
        if (r.calId === PRIMARY) primaryHtmlLink = r.htmlLink;
      } else {
        errors.push(String((outcome.reason as any)?.message ?? outcome.reason));
      }
    }
    await sb.from("event").update({
      gcal_event_ids: nextIds,
      gcal_event_id: nextIds[PRIMARY] ?? null,
      gcal_html_link: primaryHtmlLink ?? (ev as any).gcal_html_link ?? null,
      gcal_match_pending: null,
    }).eq("id", eventId);

    if (errors.length > 0) {
      return json({ ok: false, status: "partial", gcalEventIds: nextIds, errors }, 207);
    } else {
      return json({ ok: true, status: "synced", gcalEventIds: nextIds, htmlLink: primaryHtmlLink });
    }

  } catch (e) {
    console.error(JSON.stringify({ fn: "gcal-sync", error: String((e as Error)?.message ?? e) }));
    return json({ error: (e as Error).message ?? String(e) }, 500);
  }
});
