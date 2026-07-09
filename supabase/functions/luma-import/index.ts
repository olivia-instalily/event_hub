// DUAL-MAINTAINED: any changes here must also be made in
// cloud-functions/src/functions/luma-import.ts
// Edge function: import Luma guests onto EventHub events as attendees (+ attendee_event links).
// Server-side (Luma key + Supabase service role from env). One-shot backfill for past linked
// events, or a single event. People are de-duped by email; links de-duped by (attendee,event).
//
// POST { eventId: string }        → import that event's Luma guests
// POST { all: true }              → import every event that has a Luma id but no attendees yet
//   → { events: [{ id, name, imported, linked }], error? }

import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

interface Guest { name: string | null; email: string | null; status: string | null; checkedIn: boolean }

// Page through Luma's guest list for one event.
async function lumaGuests(apiKey: string, apiId: string): Promise<Guest[]> {
  const out: Guest[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < 50; i++) { // safety bound on pages
    const url = new URL("https://public-api.luma.com/v1/event/get-guests");
    url.searchParams.set("event_api_id", apiId);
    if (cursor) url.searchParams.set("pagination_cursor", cursor);
    const res = await fetch(url, { headers: { "x-luma-api-key": apiKey, accept: "application/json" } });
    if (!res.ok) break;
    const data = await res.json();
    const entries: any[] = data.entries ?? [];
    for (const e of entries) {
      const g = e.guest ?? e;
      out.push({
        name: g.name ?? g.user_name ?? null,
        email: (g.email ?? g.user_email ?? null)?.toLowerCase() ?? null,
        status: (g.approval_status ?? g.status ?? null)?.toLowerCase() ?? null,
        checkedIn: !!(g.checked_in_at ?? g.checked_in),
      });
    }
    if (!data.has_more || !data.next_cursor) break;
    cursor = data.next_cursor;
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  try {
    const { eventId, all } = await req.json();
    const apiKey = Deno.env.get("LUMA_API_KEY");
    if (!apiKey) return json({ error: "LUMA_API_KEY not configured on the server." }, 500);
    const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Ensure the "Internal" person label exists — auto-applied to @instalily.ai emails.
    let internalLabelId: string | null = null;
    {
      const { data } = await supa.from("label").select("id").eq("scope", "person").ilike("name", "internal").limit(1);
      internalLabelId = data?.[0]?.id ?? null;
      if (!internalLabelId) { internalLabelId = "lbl-internal"; await supa.from("label").insert({ id: internalLabelId, name: "Internal", scope: "person" }).then(() => {}, () => {}); }
    }
    const labelInternal = async (attendeeId: string, email: string) => {
      if (!internalLabelId || !email.endsWith("@instalily.ai")) return;
      const { data } = await supa.from("attendee_label").select("attendee_id").eq("attendee_id", attendeeId).eq("label_id", internalLabelId).limit(1);
      if (!data?.length) await supa.from("attendee_label").insert({ attendee_id: attendeeId, label_id: internalLabelId });
    };

    // Resolve target events.
    let targets: { id: string; name: string; luma_event_id: string }[] = [];
    if (eventId) {
      const { data } = await supa.from("event").select("id, name, luma_event_id").eq("id", eventId).maybeSingle();
      if (data?.luma_event_id) targets = [data as any];
    } else if (all) {
      const { data: evs } = await supa.from("event").select("id, name, luma_event_id").not("luma_event_id", "is", null);
      // Only events with NO attendees yet (don't clobber already-populated events).
      const out: any[] = [];
      for (const e of evs ?? []) {
        const { count } = await supa.from("attendee_event").select("attendee_id", { count: "exact", head: true }).eq("event_id", e.id);
        if (!count) out.push(e);
      }
      targets = out;
    }
    if (targets.length === 0) return json({ events: [] });

    const results: { id: string; name: string; imported: number; linked: number }[] = [];
    for (const ev of targets) {
      let imported = 0, linked = 0;
      const guests = await lumaGuests(apiKey, ev.luma_event_id);
      for (const g of guests) {
        if (!g.email) continue; // need an email to de-dupe a person
        // Find or create the person (one attendee per email, across events).
        const { data: existing } = await supa.from("attendee").select("id").ilike("email", g.email).limit(1);
        let attendeeId = existing?.[0]?.id as string | undefined;
        if (!attendeeId) {
          attendeeId = `att-${crypto.randomUUID()}`;
          const { error } = await supa.from("attendee").insert({ id: attendeeId, name: g.name, email: g.email, type: "Unknown" });
          if (error) continue;
          imported++;
        }
        await labelInternal(attendeeId, g.email);
        // Link to this event if not already linked.
        const { data: link } = await supa.from("attendee_event").select("attendee_id").eq("event_id", ev.id).eq("attendee_id", attendeeId).limit(1);
        if (!link?.length) {
          const { error } = await supa.from("attendee_event").insert({ id: `ae-${crypto.randomUUID()}`, attendee_id: attendeeId, event_id: ev.id, role_at_event: "attendee", registration_status: g.status, checked_in: g.checkedIn });
          if (!error) linked++;
        }
      }
      results.push({ id: ev.id, name: ev.name, imported, linked });
    }
    return json({ events: results });
  } catch (e) {
    console.error(JSON.stringify({ fn: "luma-import", error: String((e as Error)?.message ?? e) }));
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
