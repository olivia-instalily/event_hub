// DUAL-MAINTAINED: any changes here must also be made in
// supabase/functions/generate-template/index.ts
import { Request, Response } from 'express';
import Anthropic from '@anthropic-ai/sdk';

// Structured-output schema — constrains Claude's response to exactly this shape.
const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    name:               { type: ['string', 'null'], description: 'concise event name/title if the user stated one, else null' },
    location:           { type: ['string', 'null'], description: 'full normalized city name (e.g. New York), else null' },
    date:               { type: ['string', 'null'], description: 'ISO YYYY-MM-DD if a specific date is stated, else null' },
    vendorCategories:   { type: 'array', items: { type: 'string' } },
    budgetLines: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: { label: { type: 'string' }, estimate: { type: 'number', description: 'rough USD planning estimate; 0 if unknown' } },
        required: ['label', 'estimate'],
      },
    },
    progressCategories: { type: 'array', items: { type: 'string' } },
  },
  required: ['name', 'location', 'date', 'vendorCategories', 'budgetLines', 'progressCategories'],
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

export async function handler(req: Request, res: Response) {
  try {
    const { description } = req.body;
    if (!description || !String(description).trim()) { res.status(400).json({ error: 'description is required' }); return; }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) { res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured on the server.' }); return; }

    const client = new Anthropic({ apiKey });
    const resp = await (client.messages.create as any)({
      model: 'claude-haiku-4-5',
      max_tokens: 2048,
      system: SYSTEM,
      messages: [{ role: 'user', content: `Event description:\n${description}` }],
      output_config: { format: { type: 'json_schema', schema: SCHEMA } },
    });

    const tb = (resp.content as any[]).find((b: any) => b.type === 'text');
    if (!tb) { res.status(502).json({ error: 'No template returned.' }); return; }
    res.json(JSON.parse(tb.text));
  } catch (e) {
    console.error(JSON.stringify({ fn: 'generate-template', error: String((e as Error)?.message ?? e) }));
    res.status(500).json({ error: String((e as Error)?.message ?? e) });
  }
}
