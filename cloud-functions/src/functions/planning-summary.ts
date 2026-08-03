// DUAL-MAINTAINED: any changes here must also be made in
// supabase/functions/planning-summary/index.ts
import { Request, Response } from 'express';
import Anthropic from '@anthropic-ai/sdk';

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: { summary: { type: 'string', description: '3–5 bullet points, one per line, each starting with "- "' } },
  required: ['summary'],
};

const SYSTEM = `You write a brief, concrete status digest for an event the team is planning.
Given structured facts (stage, days out, confirmed vendor decisions, pending items, budget, deliverable progress, what's coming up), write 3–5 short bullet points a planner can scan at a glance: what's locked, what's still open, what's imminent or overdue. Use the real numbers/names.
Facts may include \`notes\` — loose planned concepts/decisions pulled from Slack. Only fold in the genuinely significant ones (a headline decision like the event format or venue) as a bullet; skip minor/operational notes. Don't just list them.
Format as one bullet per line, each line starting with "- ". Keep each bullet to a single short clause. No preamble, no headings.`;

export async function handler(req: Request, res: Response) {
  try {
    const { facts } = req.body;
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) { res.json({ summary: null }); return; }

    const client = new Anthropic({ apiKey });
    const resp = await (client.messages.create as any)({
      model: 'claude-haiku-4-5',
      max_tokens: 1024,
      system: SYSTEM,
      messages: [{ role: 'user', content: JSON.stringify(facts) }],
      output_config: { format: { type: 'json_schema', schema: SCHEMA } },
    });
    const tb = (resp.content as any[]).find((b: any) => b.type === 'text');
    res.json({ summary: tb ? JSON.parse(tb.text).summary : null });
  } catch (e) {
    console.error(JSON.stringify({ fn: 'planning-summary', error: String((e as Error)?.message ?? e) }));
    res.json({ summary: null, error: String((e as Error)?.message ?? e) });
  }
}
