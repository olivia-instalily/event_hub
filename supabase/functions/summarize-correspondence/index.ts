// Edge function: Claude-summarize the correspondence (synced emails + notes) on one
// vendor decision into a short "where things stand" digest. Returns { summary: null }
// when no API key is set so the client can show a hint.
//
// POST { eventId, engagementId }  → { summary: string | null }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Anthropic from "npm:@anthropic-ai/sdk";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: { summary: { type: "string", description: "2–3 sentence digest of the vendor correspondence" } },
  required: ["summary"],
};

const SYSTEM = `You summarize the back-and-forth with a single event vendor. Given a chronological list of correspondence (emails/notes with subjects and snippets), write 2–3 plain sentences: what's been discussed, where it stands, and any open item or next step. Use specifics. No preamble or headings.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  try {
    const { eventId, engagementId } = await req.json();
    if (!eventId || !engagementId) return json({ error: "eventId and engagementId required" }, 400);

    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const { data: rows } = await sb
      .from("event_update")
      .select("source, summary, detail, created_at")
      .eq("event_id", eventId)
      .eq("engagement_id", engagementId)
      .order("created_at", { ascending: true });

    if (!rows || rows.length === 0) return json({ summary: null });

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) return json({ summary: null });

    const client = new Anthropic({ apiKey });
    const items = rows.map((r: any) => ({ source: r.source, subject: r.summary, snippet: r.detail, date: r.created_at }));
    const resp = await (client.messages.create as any)({
      model: "claude-haiku-4-5",
      max_tokens: 1024,
      system: SYSTEM,
      messages: [{ role: "user", content: JSON.stringify(items) }],
      output_config: { format: { type: "json_schema", schema: SCHEMA } },
    });
    const tb = (resp.content as any[]).find((b) => b.type === "text");
    return json({ summary: tb ? JSON.parse(tb.text).summary : null });
  } catch (e) {
    return json({ summary: null, error: String((e as Error)?.message ?? e) });
  }
});
