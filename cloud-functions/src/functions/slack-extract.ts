import Anthropic from '@anthropic-ai/sdk';
import type { SlackMsg, Proposal, Removal, Home } from './slack-capture-lib.js';

// Anthropic strict json_schema: every object needs additionalProperties:false and all keys required;
// optionals are nullable / empty-string instead. detail/sourceQuote use "" for none; ambiguity + radiusNote null.
const SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    captures: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          home: { enum: ['plan', 'person', 'open', 'budget'] },
          summary: { type: 'string', description: 'short human label, e.g. "pre-pour wine", "Thurman (bar)"' },
          detail: { type: 'string', description: 'a bit more context, or "" ' },
          sourceQuote: { type: 'string', description: 'the exact phrase from the message, or ""' },
          usedContext: { type: 'object', additionalProperties: false, properties: { first: { type: 'string' }, last: { type: 'string' } }, required: ['first', 'last'] },
          ambiguity: { type: ['string', 'null'], description: 'a one-line "which did you mean?" if genuinely unclear, else null' },
        },
        required: ['home', 'summary', 'detail', 'sourceQuote', 'usedContext', 'ambiguity'],
      },
    },
    removals: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, properties: { label: { type: 'string' } }, required: ['label'] },
    },
    radiusNote: { type: ['string', 'null'], description: 'e.g. "read 3 messages around your pin to get the cost" when context was needed, else null' },
  },
  required: ['captures', 'removals', 'radiusNote'],
};

const SYSTEM = `You extract event-planning facts from a Slack conversation for EventHub. One message is marked <PINNED>.
Read the surrounding messages to interpret the pin, but only treat messages that are part of the SAME decision/topic as the pin as relevant — ignore unrelated chatter. If the window spans two unrelated decisions, extract only the one containing the pin; do not merge.

Route each thing you find into exactly ONE home:
- plan   — a DECIDED flow/format/choice ("jazz then a singer", "playlist not a DJ", "pre-pour wine").
- person — a specific person with a role ("Doug performs", "Thurman on bar").
- open   — a TENTATIVE/undecided CHOICE that still needs confirming ("maybe a mural", "robot dog if cost works", "leaning fortune teller over the robot dog"). A proposal to resolve, not an errand.
- budget — a stated cost figure or budget decision ("$1,200", "aiming ~$14k").

Hard rules:
- Tentative/undecided language (maybe / if / depending / might / leaning toward) → home "open", never plan/person/budget.
- EventHub surfaces fields and decisions to confirm, NOT a personal task list. Do NOT capture bare errands or to-dos ("get quotes", "email the vendor", "follow up", "line up a bar hand", "chase the cost package"). If a message is purely an action item with nothing to confirm, skip it. Only capture the underlying decision when one is actually being made.
- There is NO vendor home. A supplier is either a "plan" decision (we're using them) or an "open" tentative choice (still deciding whether to).
- Prefer FEWER real captures over enumerating every mention. Skip small talk.
- NEVER fabricate a value/name/cost/role that wasn't stated (don't turn "work the crowd" into "magician").
- When a later message supersedes an earlier one, capture only the latest state.
- Something dropped/cancelled ("mural fell through") → a removals[] entry (a short label of what was dropped), NOT a capture.
- summary = a short human label (no field syntax). detail = a little more or "". sourceQuote = the phrase, or "". usedContext = the ts range you actually read. ambiguity = a one-line question only if genuinely unclear, else null.
- BUDGET captures MUST carry the actual figure in the summary or detail — e.g. summary "Robot dog rental", detail "$1,200 for the night". Never leave the dollar amount only in sourceQuote; if the figure isn't in summary/detail it can't be tracked.
- radiusNote: a short "read N messages around your pin to …" only when you needed context beyond the pin; else null.
No preamble.`;

export interface Extraction { captures: Proposal[]; removals: Removal[]; radiusNote?: string }

export async function extractCaptures(pinnedTs: string, msgs: SlackMsg[]): Promise<Extraction> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { captures: [], removals: [] };
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
  if (!textBlock) return { captures: [], removals: [] };
  try {
    const j = JSON.parse(textBlock.text);
    const captures: Proposal[] = (j.captures ?? []).map((c: any) => ({
      home: c.home as Home,
      summary: String(c.summary ?? '').trim(),
      detail: c.detail ? String(c.detail) : undefined,
      sourceQuote: c.sourceQuote ? String(c.sourceQuote) : undefined,
      usedContext: c.usedContext ?? undefined,
      ambiguity: typeof c.ambiguity === 'string' && c.ambiguity.trim() ? c.ambiguity : undefined,
    })).filter((c: Proposal) => c.summary);
    const removals: Removal[] = (j.removals ?? []).map((r: any) => ({ label: String(r.label ?? '').trim() })).filter((r: Removal) => r.label);
    return { captures, removals, radiusNote: typeof j.radiusNote === 'string' && j.radiusNote.trim() ? j.radiusNote : undefined };
  } catch {
    console.error(JSON.stringify({ fn: 'slack-extract', error: 'invalid json', raw: textBlock.text }));
    return { captures: [], removals: [] };
  }
}
