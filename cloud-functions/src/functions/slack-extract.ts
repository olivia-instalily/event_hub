import Anthropic from '@anthropic-ai/sdk';
import type { SlackMsg, Proposal } from './slack-capture-lib.js';

// Anthropic strict json_schema: every object needs additionalProperties:false and all keys in
// `required`. So payload is a stringified JSON object (parsed back below) and ambiguity is a
// nullable string — avoids an open-ended object the strict validator rejects.
const SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    proposals: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          type: { enum: ['note', 'status', 'debrief', 'people', 'budget', 'vendor', 'other'] },
          payload: { type: 'string', description: 'a JSON object (stringified) with the fields for this type, e.g. {"text":"..."} or {"category":"venue","amount":4000}' },
          confidence: { type: 'number' },
          contextTs: { type: 'object', additionalProperties: false, properties: { first: { type: 'string' }, last: { type: 'string' } }, required: ['first', 'last'] },
          ambiguity: { type: ['string', 'null'], description: 'a one-line "which did you mean?" question if the value is genuinely ambiguous, else null' },
        },
        required: ['type', 'payload', 'confidence', 'contextTs', 'ambiguity'],
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
  try {
    const raw = (JSON.parse(textBlock.text).proposals ?? []) as any[];
    // Unpack the stringified payload; map the nullable ambiguity string to { question }.
    return raw.map((p) => {
      let payload: any;
      try { payload = typeof p.payload === 'string' ? JSON.parse(p.payload) : p.payload; }
      catch { payload = { text: String(p.payload ?? '') }; }
      return {
        type: p.type, payload, confidence: p.confidence, contextTs: p.contextTs,
        ambiguity: typeof p.ambiguity === 'string' && p.ambiguity.trim() ? { question: p.ambiguity } : undefined,
      } as Proposal;
    });
  } catch { console.error(JSON.stringify({ fn: 'slack-extract', error: 'invalid json', raw: textBlock.text })); return []; }
}
