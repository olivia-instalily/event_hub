import { Request, Response } from 'express';
import Anthropic from '@anthropic-ai/sdk';

const FONT = { type: 'string', enum: ['inter', 'serif', 'grotesk'] };
const SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    headingFont:   { ...FONT },
    bodyFont:      { ...FONT },
    accent:        { type: 'string' },
    accentOn:      { type: 'string', enum: ['marker', 'title'] },
    headingStyle:  { type: 'string', enum: ['plain', 'marker'] },
    bgColor:       { type: ['string', 'null'] },
    textColor:     { type: ['string', 'null'] },
    agendaLayout:  { type: 'string', enum: ['list', 'timeline', 'cards'] },
  },
  required: ['headingFont', 'bodyFont', 'accent', 'accentOn', 'headingStyle', 'bgColor', 'textColor', 'agendaLayout'],
};

const SYSTEM = `You are a brand and web-design analyst. You are shown one or more reference images of web pages or design mocks. Infer a single cohesive visual style as structured design tokens using ONLY the allowed values in the schema. Judge the dominant accent color, whether headings are large/plain or small uppercase labels with a colored marker, the heading and body type feel (clean sans, editorial serif, or technical mono), the background and text colors, and which agenda layout the design would suit. If multiple images are given, synthesize one consistent style. Pick the closest match; do not invent values outside the enums. Return hex colors as #RRGGBB.`;

const FALLBACK = { headingFont: 'inter', bodyFont: 'inter', accent: '#111827', accentOn: 'marker', headingStyle: 'plain', bgColor: null, textColor: null, agendaLayout: 'list' };

export async function handler(req: Request, res: Response) {
  try {
    const { images } = req.body;
    if (!Array.isArray(images) || !images.length) { res.status(400).json({ error: 'images required' }); return; }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) { res.json(FALLBACK); return; }

    const client = new Anthropic({ apiKey });
    const resp = await (client.messages.create as any)({
      model: 'claude-haiku-4-5',
      max_tokens: 1024,
      system: SYSTEM,
      messages: [{
        role: 'user',
        content: [
          ...images.map((im: { media_type: string; data: string }) => ({ type: 'image', source: { type: 'base64', media_type: im.media_type, data: im.data } })),
          { type: 'text', text: 'Infer the design tokens for these reference image(s).' },
        ],
      }],
      output_config: { format: { type: 'json_schema', schema: SCHEMA } },
    });
    const tb = (resp.content as any[]).find((b: any) => b.type === 'text');
    res.json(tb ? JSON.parse(tb.text) : FALLBACK);
  } catch (e) {
    console.error(JSON.stringify({ fn: 'generate-page-style', error: String((e as Error)?.message ?? e) }));
    res.status(500).json({ error: String((e as Error)?.message ?? e) });
  }
}
