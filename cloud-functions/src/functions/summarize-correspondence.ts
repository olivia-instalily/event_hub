import { Request, Response } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { getServiceClient } from '../db.js';

const SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: { summary: { type: 'string' } },
  required: ['summary'],
};

const SYSTEM = `You summarize the back-and-forth with a single event vendor. Given a chronological list of correspondence (emails/notes with subjects and snippets), write 2–3 plain sentences: what's been discussed, where it stands, and any open item or next step. Use specifics. No preamble or headings.`;

export async function handler(req: Request, res: Response) {
  try {
    const { eventId, engagementId } = req.body;
    if (!eventId || !engagementId) { res.status(400).json({ error: 'eventId and engagementId required' }); return; }

    const sb = getServiceClient();
    const { data: rows } = await sb
      .from('event_update')
      .select('source, summary, detail, created_at')
      .eq('event_id', eventId)
      .eq('engagement_id', engagementId)
      .order('created_at', { ascending: true });

    if (!rows || rows.length === 0) { res.json({ summary: null }); return; }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) { res.json({ summary: null }); return; }

    const client = new Anthropic({ apiKey });
    const items = (rows as any[]).map((r) => ({ source: r.source, subject: r.summary, snippet: r.detail, date: r.created_at }));
    const resp = await (client.messages.create as any)({
      model: 'claude-haiku-4-5',
      max_tokens: 1024,
      system: SYSTEM,
      messages: [{ role: 'user', content: JSON.stringify(items) }],
      output_config: { format: { type: 'json_schema', schema: SCHEMA } },
    });
    const tb = (resp.content as any[]).find((b: any) => b.type === 'text');
    res.json({ summary: tb ? JSON.parse(tb.text).summary : null });
  } catch (e) {
    console.error(JSON.stringify({ fn: 'summarize-correspondence', error: String((e as Error)?.message ?? e) }));
    res.status(500).json({ error: String((e as Error)?.message ?? e) });
  }
}
