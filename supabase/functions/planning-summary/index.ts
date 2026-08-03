// DUAL-MAINTAINED: any changes here must also be made in
// cloud-functions/src/functions/planning-summary.ts
// Edge function: a short at-a-glance status digest for an event's planning home tab.
// The client passes already-computed facts; Claude phrases them into 2–3 sentences.
// Returns { summary: null } when no API key is set so the client can fall back to its
// own deterministic digest.
//
// POST { facts: {...} }  → { summary: string | null }

import Anthropic from "npm:@anthropic-ai/sdk";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: { summary: { type: "string", description: "3–5 bullet points, one per line, each starting with '- '" } },
  required: ["summary"],
};

const SYSTEM = `You write a brief, concrete status digest for an event the team is planning.
Given structured facts (stage, days out, confirmed vendor decisions, pending items, budget, deliverable progress, what's coming up), write 3–5 short bullet points a planner can scan at a glance: what's locked, what's still open, what's imminent or overdue. Use the real numbers/names.
Facts may include \`notes\` — loose planned concepts/decisions pulled from Slack. Only fold in the genuinely significant ones (a headline decision like the event format or venue) as a bullet; skip minor/operational notes. Don't just list them.
Format as one bullet per line, each line starting with "- ". Keep each bullet to a single short clause. No preamble, no headings.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  try {
    const { facts } = await req.json();
    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) return json({ summary: null }); // client falls back to its own digest

    const client = new Anthropic({ apiKey });
    const resp = await (client.messages.create as any)({
      model: "claude-haiku-4-5",
      max_tokens: 1024,
      system: SYSTEM,
      messages: [{ role: "user", content: JSON.stringify(facts) }],
      output_config: { format: { type: "json_schema", schema: SCHEMA } },
    });
    const textBlock = (resp.content as any[]).find((b) => b.type === "text");
    return json({ summary: textBlock ? JSON.parse(textBlock.text).summary : null });
  } catch (e) {
    console.error(JSON.stringify({ fn: "planning-summary", error: String((e as Error)?.message ?? e) }));
    return json({ summary: null, error: String((e as Error)?.message ?? e) });
  }
});
