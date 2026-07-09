// DUAL-MAINTAINED: any changes here must also be made in
// cloud-functions/src/functions/generate-page.ts
// Edge function: draft landing-page copy from an event's PUBLIC fields only.
// Claude writes a headline, subhead, and about blurb; falls back to template-fill
// when no API key is set. Sends only public fields (keeps the field boundary).
//
// POST { eventId }  → { headline, subhead, aboutBody }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Anthropic from "npm:@anthropic-ai/sdk";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

// Mirror of src/lib/page.ts PAGE_PUBLIC_FIELDS — only these are read.
const PUBLIC_FIELDS = "name, event_date, location, tags, description, format, audience, luma_url";

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    headline: { type: "string", description: "short punchy hero headline" },
    subhead: { type: "string", description: "one-line supporting subhead" },
    aboutBody: { type: "string", description: "2–4 sentence about paragraph" },
  },
  required: ["headline", "subhead", "aboutBody"],
};

const SYSTEM = `You write concise, polished landing-page copy for an event. Given the event's public info, produce a hero headline, a one-line subhead, and a short About paragraph (2–4 sentences). Warm and professional, specific to the event, no marketing fluff or emojis.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  try {
    const { eventId } = await req.json();
    if (!eventId) return json({ error: "eventId required" }, 400);

    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const { data: ev } = await sb.from("event").select(PUBLIC_FIELDS).eq("id", eventId).maybeSingle();
    if (!ev) return json({ error: "event not found" }, 404);

    const e = ev as any;
    const fallback = {
      headline: e.name ?? "Event",
      subhead: [e.event_date, e.location].filter(Boolean).join(" · "),
      aboutBody: e.description ?? "",
    };

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) return json(fallback);

    const client = new Anthropic({ apiKey });
    const resp = await (client.messages.create as any)({
      model: "claude-haiku-4-5",
      max_tokens: 1024,
      system: SYSTEM,
      messages: [{ role: "user", content: JSON.stringify(e) }],
      output_config: { format: { type: "json_schema", schema: SCHEMA } },
    });
    const tb = (resp.content as any[]).find((b) => b.type === "text");
    return json(tb ? JSON.parse(tb.text) : fallback);
  } catch (e) {
    console.error(JSON.stringify({ fn: "generate-page", error: String((e as Error)?.message ?? e) }));
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
