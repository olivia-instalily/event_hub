// DUAL-MAINTAINED: any changes here must also be made in
// cloud-functions/src/functions/gmail-sync.ts
// Edge function: pull recent Gmail messages from an event's vendor domains and file
// them as correspondence on the matching vendor decision. Single-mailbox model — uses
// one stored refresh token. Read-only on Gmail; it never changes a vendor's stage
// (money/stage changes stay human-confirmed via the UI).
//
// POST { eventId, days? }  → { matched, recorded, scannedDomains }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

function domainFromUrl(raw: string | null): string | null {
  if (!raw) return null;
  const s = raw.trim(); if (!s) return null;
  try { return new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`).hostname.toLowerCase().replace(/^www\./, "") || null; } catch { return null; }
}
function emailDomain(addr: string | null): string | null {
  const m = (addr ?? "").toLowerCase().match(/@([^@\s>]+)/); return m ? m[1] : null;
}
const FREE_MAIL = new Set(["gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "yahoo.com", "icloud.com", "me.com", "aol.com", "proton.me", "protonmail.com"]);
function domainsMatch(a: string | null, b: string | null): boolean {
  if (!a || !b) return false; const x = a.toLowerCase(), y = b.toLowerCase();
  if (FREE_MAIL.has(x) || FREE_MAIL.has(y)) return false;
  return x === y || x.endsWith(`.${y}`) || y.endsWith(`.${x}`);
}
const header = (msg: any, name: string): string =>
  (msg.payload?.headers ?? []).find((h: any) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? "";

async function accessToken(): Promise<string> {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: Deno.env.get("GOOGLE_CLIENT_ID")!,
      client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET")!,
      refresh_token: Deno.env.get("GMAIL_REFRESH_TOKEN")!,
      grant_type: "refresh_token",
    }),
  });
  const d = await r.json();
  if (!d.access_token) throw new Error(`Google token error: ${d.error ?? "no access_token"}${d.error_description ? ` — ${d.error_description}` : ""}`);
  return d.access_token;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  try {
    const { eventId, days = 90 } = await req.json();
    if (!eventId) return json({ error: "eventId required" }, 400);
    if (!Deno.env.get("GMAIL_REFRESH_TOKEN")) return json({ error: "Gmail not connected (GMAIL_REFRESH_TOKEN unset). Run scripts/gmail-auth.mjs." }, 400);

    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

    // Vendor domains (in-range) for this event, from candidate links.
    const { data: engRows } = await sb.from("engagement").select("id, category, candidates:engagement_candidate ( vendor_name, link )").eq("event_id", eventId);
    const engByDomain: { id: string; category: string | null; name: string | null; domain: string }[] = [];
    for (const e of engRows ?? []) {
      for (const c of (e as any).candidates ?? []) {
        const d = domainFromUrl(c.link);
        if (d && !FREE_MAIL.has(d)) engByDomain.push({ id: (e as any).id, category: (e as any).category, name: c.vendor_name, domain: d });
      }
    }
    const domains = Array.from(new Set(engByDomain.map((e) => e.domain)));
    if (domains.length === 0) return json({ matched: 0, recorded: 0, scannedDomains: 0, note: "No vendor domains on this event (set vendor links)." });

    const token = await accessToken();
    const gauth = { headers: { Authorization: `Bearer ${token}` } };

    // Gmail search: from any vendor domain, recent.
    const q = `newer_than:${days}d from:(${domains.join(" OR ")})`;
    const listRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=25&q=${encodeURIComponent(q)}`, gauth);
    const list = await listRes.json();
    if (list.error) throw new Error(`Gmail list: ${list.error.message}`);
    const ids: string[] = (list.messages ?? []).map((m: any) => m.id);

    // Already-recorded gmail ids for this event (dedup).
    const { data: seenRows } = await sb.from("event_update").select("external_id").eq("event_id", eventId).not("external_id", "is", null);
    const seen = new Set((seenRows ?? []).map((r: any) => r.external_id));

    let matched = 0, recorded = 0;
    for (const id of ids) {
      if (seen.has(id)) continue;
      const mRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`, gauth);
      const msg = await mRes.json();
      if (msg.error) continue;
      const fromHeader = header(msg, "From");
      const subject = header(msg, "Subject") || "(no subject)";
      const senderDomain = emailDomain(fromHeader);
      const hit = engByDomain.find((e) => domainsMatch(e.domain, senderDomain));
      if (!hit) continue;
      matched++;
      const label = hit.name ?? hit.category ?? "vendor";
      const { error } = await sb.from("event_update").insert({
        id: "upd-" + crypto.randomUUID(),
        event_id: eventId,
        source: "email",
        summary: `${hit.category ?? label}: ${subject}`,
        detail: msg.snippet ?? null,
        link_url: `https://mail.google.com/mail/u/0/#all/${id}`,
        engagement_id: hit.id,
        external_id: id,
      });
      if (!error) recorded++;
    }

    return json({ matched, recorded, scannedDomains: domains.length });
  } catch (e) {
    console.error(JSON.stringify({ fn: "gmail-sync", error: String((e as Error)?.message ?? e) }));
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
