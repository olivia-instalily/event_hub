// Ported from supabase/functions/extract-debrief/index.ts — logic identical, Deno → Node.js.
import { Request, Response } from 'express';
import Anthropic from '@anthropic-ai/sdk';

const SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    eventName: { type: 'string' },
    focus:     { enum: ['hiring', 'client', 'community', 'unclear'] },
    outcome: {
      type: 'object', additionalProperties: false,
      properties: {
        verdict:       { type: 'string' },
        worthRepeating: { enum: ['yes', 'no', 'unsure', null] },
        turnoutActual: { type: ['number', 'null'] },
        turnoutNote:   { type: 'string' },
      },
      required: ['verdict', 'worthRepeating', 'turnoutActual', 'turnoutNote'],
    },
    lessons: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: { text: { type: 'string' }, proposedChange: { type: 'string' }, area: { type: 'string' } },
        required: ['text', 'proposedChange', 'area'],
      },
    },
    followUps: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: { action: { type: 'string' }, owner: { type: 'string' }, person: { type: 'string' }, dueOffset: { type: ['number', 'null'] } },
        required: ['action', 'owner', 'person', 'dueOffset'],
      },
    },
    peopleTags: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          name:       { type: 'string' },
          lens:       { enum: ['candidate', 'prospect', 'partner'] },
          note:       { type: 'string' },
          provenance: { type: 'string' },
        },
        required: ['name', 'lens', 'note', 'provenance'],
      },
    },
    actuals: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: { line: { type: 'string' }, amount: { type: ['number', 'null'] }, note: { type: 'string' } },
        required: ['line', 'amount', 'note'],
      },
    },
  },
  required: ['eventName', 'focus', 'outcome', 'lessons', 'followUps', 'peopleTags', 'actuals'],
};

const SYSTEM = `You extract structured data from a POST-EVENT DEBRIEF transcript for InstaLILY's internal event tool (EventHub). Output must match the provided JSON schema exactly. Extract only what the transcript states; never invent.

A DEBRIEF is backward-looking. Its content is: what happened, what to change next time, who stood out, the verdict, and budget corrections. Do NOT re-extract the event's standing guardrails or planning heuristics as if they were new findings.

LESSONS — NEW learnings and the change they imply. Put the observation in text and the prescription in proposedChange (proposedChange "" if the debrief only observed). area = which part of the playbook it touches.

FOLLOW-UPS — post-event actions someone must take: action (imperative) + owner + person + dueOffset (days after event, null if unstated).

PEOPLE TAGS — specific people singled out, with a lens (candidate=potential hire, prospect=potential client/ICP, partner=partnership). CATEGORY-AWARENESS: if the event focus is 'community', do NOT emit candidate tags.

OUTCOME — verdict (one line how it went), worthRepeating (yes/no/unsure/null), turnoutActual (number if stated), turnoutNote (reconciliation vs expectation).

ACTUALS — budget corrections: line + amount (dollars, null if unstated) + note.

FOCUS — hiring / client / community / unclear from the transcript.

ABSENT VALUES: for any STRING field not stated, return "" (NOT null). For NUMBER fields not stated, return null. Arrays default to []. Do not invent.`;

export async function handler(req: Request, res: Response) {
  try {
    const { text } = req.body;
    if (!text || !String(text).trim()) { res.status(400).json({ error: 'text is required' }); return; }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) { res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured on the server.' }); return; }

    const client = new Anthropic({ apiKey });
    const resp = await (client.messages.create as any)({
      model: 'claude-haiku-4-5',
      max_tokens: 16000,
      system: SYSTEM,
      messages: [{ role: 'user', content: `Debrief transcript:\n${text}` }],
      output_config: { format: { type: 'json_schema', schema: SCHEMA } },
    });

    if (resp.stop_reason === 'max_tokens') { res.status(502).json({ error: 'Extraction truncated — raise max_tokens.' }); return; }
    const textBlock = (resp.content as any[]).find((b: any) => b.type === 'text');
    if (!textBlock) { res.status(502).json({ error: 'No extraction returned.' }); return; }
    let parsed: unknown;
    try { parsed = JSON.parse(textBlock.text); } catch { res.status(502).json({ error: 'Model returned invalid JSON.', raw: textBlock.text }); return; }
    res.json(parsed);
  } catch (e) {
    console.error(JSON.stringify({ fn: 'extract-debrief', error: String((e as Error)?.message ?? e) }));
    res.status(500).json({ error: String((e as Error)?.message ?? e) });
  }
}
