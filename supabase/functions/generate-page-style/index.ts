// Edge function: infer visual STYLE TOKENS from a design reference image (a Figma mock,
// screenshot, or template). Claude (vision) returns a structured theme — fonts, accent,
// heading treatment, colors, agenda layout — which the builder merges into the page draft.
// Page CONTENT stays sourced from the event plan; this only sets the look.
//
// POST { images: [{ media_type, data }] }  (base64, sent by the client so no server-side
// fetch is needed) → { headingFont, bodyFont, accent, accentOn, headingStyle, bgColor, textColor, agendaLayout }

import Anthropic from "npm:@anthropic-ai/sdk";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const FONT = { type: "string", enum: ["inter", "serif", "grotesk"] };
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    headingFont: { ...FONT, description: "font family for headings: inter=clean sans, serif=editorial serif, grotesk=mono/technical" },
    bodyFont: { ...FONT, description: "font family for body copy" },
    accent: { type: "string", description: "primary accent color as a #RRGGBB hex" },
    accentOn: { type: "string", enum: ["marker", "title"], description: "whether the accent colors a small square marker beside headings, or the heading text itself" },
    headingStyle: { type: "string", enum: ["plain", "marker"], description: "plain=large title; marker=small uppercase tracked label with a colored square (technical/brand look)" },
    bgColor: { type: ["string", "null"], description: "page background as #RRGGBB, or null for white" },
    textColor: { type: ["string", "null"], description: "body text color as #RRGGBB, or null for near-black default" },
    agendaLayout: { type: "string", enum: ["list", "timeline", "cards"], description: "agenda presentation that best matches the reference" },
  },
  required: ["headingFont", "bodyFont", "accent", "accentOn", "headingStyle", "bgColor", "textColor", "agendaLayout"],
};

const SYSTEM = `You are a brand and web-design analyst. You are shown one or more reference images of web pages or design mocks. Infer a single cohesive visual style as structured design tokens using ONLY the allowed values in the schema. Judge the dominant accent color, whether headings are large/plain or small uppercase labels with a colored marker, the heading and body type feel (clean sans, editorial serif, or technical mono), the background and text colors, and which agenda layout the design would suit. If multiple images are given, synthesize one consistent style. Pick the closest match; do not invent values outside the enums. Return hex colors as #RRGGBB.`;

const FALLBACK = { headingFont: "inter", bodyFont: "inter", accent: "#111827", accentOn: "marker", headingStyle: "plain", bgColor: null, textColor: null, agendaLayout: "list" };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  try {
    const { images } = await req.json();
    if (!Array.isArray(images) || !images.length) return json({ error: "images required" }, 400);

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) return json(FALLBACK);

    const client = new Anthropic({ apiKey });
    const resp = await (client.messages.create as any)({
      model: "claude-haiku-4-5",
      max_tokens: 1024,
      system: SYSTEM,
      messages: [{
        role: "user",
        content: [
          ...images.map((im: { media_type: string; data: string }) => ({ type: "image", source: { type: "base64", media_type: im.media_type, data: im.data } })),
          { type: "text", text: "Infer the design tokens for these reference image(s)." },
        ],
      }],
      output_config: { format: { type: "json_schema", schema: SCHEMA } },
    });
    const tb = (resp.content as any[]).find((b) => b.type === "text");
    return json(tb ? JSON.parse(tb.text) : FALLBACK);
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
