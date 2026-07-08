import { Request, Response } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { getServiceClient } from '../db.js';

const PUBLIC_FIELDS = 'name, event_date, location, tags, description, format, audience, luma_url';

const SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    headline:  { type: 'string' },
    subhead:   { type: 'string' },
    aboutBody: { type: 'string' },
  },
  required: ['headline', 'subhead', 'aboutBody'],
};

const SYSTEM = `You write concise, polished landing-page copy for an event. Given the event's public info, produce a hero headline, a one-line subhead, and a short About paragraph (2–4 sentences). Warm and professional, specific to the event, no marketing fluff or emojis.`;

export async function handler(req: Request, res: Response) {
  try {
    const { eventId } = req.body;
    if (!eventId) { res.status(400).json({ error: 'eventId required' }); return; }

    const sb = getServiceClient();
    const { data: ev } = await sb.from('event').select(PUBLIC_FIELDS).eq('id', eventId).maybeSingle();
    if (!ev) { res.status(404).json({ error: 'event not found' }); return; }

    const e = ev as any;
    const fallback = {
      headline:  e.name ?? 'Event',
      subhead:   [e.event_date, e.location].filter(Boolean).join(' · '),
      aboutBody: e.description ?? '',
    };

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) { res.json(fallback); return; }

    const client = new Anthropic({ apiKey });
    const resp = await (client.messages.create as any)({
      model: 'claude-haiku-4-5',
      max_tokens: 1024,
      system: SYSTEM,
      messages: [{ role: 'user', content: JSON.stringify(e) }],
      output_config: { format: { type: 'json_schema', schema: SCHEMA } },
    });
    const tb = (resp.content as any[]).find((b: any) => b.type === 'text');
    res.json(tb ? JSON.parse(tb.text) : fallback);
  } catch (e) {
    console.error(JSON.stringify({ fn: 'generate-page', error: String((e as Error)?.message ?? e) }));
    res.status(500).json({ error: String((e as Error)?.message ?? e) });
  }
}
