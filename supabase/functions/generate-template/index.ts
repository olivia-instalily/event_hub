// Edge function: turn a free-text event description into a starter planning template
// via the Claude API. Runs server-side so the ANTHROPIC_API_KEY never reaches the browser.
//
// POST { description: string }
//  → { name, location, date, vendorCategories: string[], budgetLines: [{label, estimate}], progressCategories: string[] }

import Anthropic from "npm:@anthropic-ai/sdk";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

// Structured-output schema — constrains Claude's response to exactly this shape.
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    name: { type: ["string", "null"], description: "concise event name/title if the user stated one, else null" },
    location: { type: ["string", "null"], description: "full normalized city name (e.g. New York), else null" },
    date: { type: ["string", "null"], description: "ISO YYYY-MM-DD if a specific date is stated, else null" },
    vendorCategories: { type: "array", items: { type: "string" } },
    budgetLines: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          label: { type: "string" },
          estimate: { type: "number", description: "rough USD planning estimate; 0 if unknown" },
        },
        required: ["label", "estimate"],
      },
    },
    progressCategories: { type: "array", items: { type: "string" } },
  },
  required: ["name", "location", "date", "vendorCategories", "budgetLines", "progressCategories"],
};

const SYSTEM = `You are an event-operations planner for InstaLILY's internal event tool.
Given a short description of an event the company is planning, produce a STARTER template with three lists:
1. vendorCategories — the external vendor categories this event will likely need (e.g. Venue, Catering, A/V, Photography).
2. budgetLines — the budget make-up: each a category label with a rough USD estimate (integer; 0 if genuinely unknown). These are the lines that get filled in with real numbers as planning proceeds.
3. progressCategories — the workstreams to track to completion (e.g. Attendee outreach, Venue coordination, Speaker outreach, Marketing & promotion, Day-of logistics, Vendor coordination).
Keep each list concise (roughly 4-8 items) and specific to the described event. Estimates are rough planning numbers, not quotes.

Also extract these fields from the description when the user makes them clear (otherwise null):
- name: a concise event name/title the user named, e.g. "title NYC fireside" → "NYC fireside". Strip leading words like "title:" / "called". Do NOT invent a name from generic descriptions.
- location: the city, normalized to its full common name — "NYC"/"nyc" → "New York", "SF" → "San Francisco", "LA" → "Los Angeles". If only a venue is given, use its city. Null if no place is mentioned.
- date: a specific calendar date as ISO YYYY-MM-DD. Null if no specific date is given (don't resolve vague phrases like "next quarter").`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  try {
    const { description } = await req.json();
    if (!description || !String(description).trim()) return json({ error: "description is required" }, 400);

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) return json({ error: "ANTHROPIC_API_KEY not configured on the server." }, 500);

    const client = new Anthropic({ apiKey });
    // Haiku 4.5 — cheapest model; supports structured outputs. (No thinking/effort: those
    // error on Haiku, and this is a light, well-scoped generation.)
    const resp = await (client.messages.create as any)({
      model: "claude-haiku-4-5",
      max_tokens: 2048,
      system: SYSTEM,
      messages: [{ role: "user", content: `Event description:\n${description}` }],
      output_config: { format: { type: "json_schema", schema: SCHEMA } },
    });

    const textBlock = (resp.content as any[]).find((b) => b.type === "text");
    if (!textBlock) return json({ error: "No template returned." }, 502);
    return json(JSON.parse(textBlock.text));
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
