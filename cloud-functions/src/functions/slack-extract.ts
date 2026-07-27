import Anthropic from '@anthropic-ai/sdk';
import type { SlackMsg, Proposal } from './slack-capture-lib.js';

const SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    proposals: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          type: { enum: ['note', 'status', 'debrief', 'people', 'budget', 'vendor', 'other'] },
          payload: { type: 'object', description: 'fields for the type; see instructions' },
          confidence: { type: 'number' },
          contextTs: { type: 'object', additionalProperties: false, properties: { first: { type: 'string' }, last: { type: 'string' } }, required: ['first', 'last'] },
          ambiguity: { type: ['object', 'null'], additionalProperties: false, properties: { question: { type: 'string' } } },
        },
        required: ['type', 'payload', 'confidence', 'contextTs'],
      },
    },
  },
  required: ['proposals'],
};

const SYSTEM = `You extract EventHub updates from a Slack conversation. One message is marked <PINNED>. \
Only consider messages that are part of the SAME conversation/decision as the pinned one — treat unrelated chatter as noise. \
If the window clearly spans two distinct topics, extract only the one containing the pin. \
Return 0..n proposals. Each proposal: type ∈ note|status|debrief|people|budget|vendor|other, a payload with the fields for that type \
(note {text}; status {target,name,status}; people {name,org?,lens?,why?}; budget {category,vendor?,amount?,note?}; vendor {category,vendor,link?,note?}; other {text}), \
a confidence 0..1, contextTs {first,last} = the ts range of messages you actually used, and ambiguity {question} only if the value's meaning is genuinely unclear (e.g. a bare number that could be budget or venue cost). No preamble.`;

export async function extractCaptures(pinnedTs: string, msgs: SlackMsg[]): Promise<Proposal[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return [];
  const transcript = msgs.map((m) => `${m.ts === pinnedTs ? '<PINNED> ' : ''}[${m.ts}] ${m.user ?? '?'}: ${m.text}`).join('\n');
  const client = new Anthropic({ apiKey });
  const resp = await (client.messages.create as any)({
    model: 'claude-haiku-4-5',
    max_tokens: 4000,
    system: SYSTEM,
    messages: [{ role: 'user', content: `Conversation:\n${transcript}` }],
    output_config: { format: { type: 'json_schema', schema: SCHEMA } },
  });
  const textBlock = (resp.content as any[]).find((b: any) => b.type === 'text');
  if (!textBlock) return [];
  try { return (JSON.parse(textBlock.text).proposals ?? []) as Proposal[]; }
  catch { console.error(JSON.stringify({ fn: 'slack-extract', error: 'invalid json', raw: textBlock.text })); return []; }
}
