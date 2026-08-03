import Anthropic from '@anthropic-ai/sdk';
import type { SlackMsg, Proposal, Removal, Home, ScrapeProposal, ScrapePerson, PlanKind } from './slack-capture-lib.js';

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
- person — an INTERNAL team member filling a role ("Doug performs", "Olivia runs check-in"). A named colleague on the team.
- open   — a TENTATIVE/undecided CHOICE that still needs confirming ("maybe a mural", "robot dog if cost works", "leaning fortune teller over the robot dog"). A proposal to resolve, not an errand.
- budget — a cost figure/decision OR an EXTERNAL supplier we're engaging ("$1,200", "aiming ~$14k", "Thurman for the bar", "Acme Catering", "the AV company"). A paid provider (bar, catering, AV, photography, entertainment) is a budget item, not a teammate — name the supplier in the summary when there is one.

Hard rules:
- Tentative/undecided language (maybe / if / depending / might / leaning toward) → home "open", never plan/person/budget.
- EventHub surfaces fields and decisions to confirm, NOT a personal task list. Do NOT capture bare errands or to-dos ("get quotes", "email the vendor", "follow up", "line up a bar hand", "chase the cost package"). If a message is purely an action item with nothing to confirm, skip it. Only capture the underlying decision when one is actually being made.
- A hired external supplier we're going with → "budget" (name the supplier in the summary). Something still being decided (which supplier, whether to) → "open".
- Prefer FEWER real captures over enumerating every mention. Skip small talk.
- NEVER fabricate a value/name/cost/role that wasn't stated (don't turn "work the crowd" into "magician").
- When a later message supersedes an earlier one, capture only the latest state.
- Something dropped/cancelled ("mural fell through") → a removals[] entry (a short label of what was dropped), NOT a capture.
- summary = a short human label (no field syntax). detail = a little more or "". sourceQuote = the phrase, or "". usedContext = the ts range you actually read. ambiguity = a one-line question only if genuinely unclear, else null.
- BUDGET captures MUST carry the actual figure AND the payment wording (paid / quote / estimate) in the summary or detail — e.g. summary "Robot dog rental", detail "$1,200 quoted", or detail "$1,500 paid". Never leave the amount only in sourceQuote; if the figure isn't in summary/detail it can't be tracked.
- Name a budget item with a consistent, full label ("Robot dog rental", not "robodog"), and reuse the earlier wording if the same item was mentioned before in the conversation — so a later price merges onto the same line instead of creating a duplicate.
- Capture only what the PINNED message is about. Do NOT sweep every message in the window into a capture; default to 1–3 captures and only exceed that if the pin itself announces several distinct decisions.
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

// ── Scrape-everything extraction: NO pin — pulls conservative event facts from a whole (incremental)
// window of channel messages, citing each fact's SOURCE message ts for idempotency. ──
const SCRAPE_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    captures: { type: 'array', items: { type: 'object', additionalProperties: false, properties: {
      home: { enum: ['plan', 'person', 'open', 'budget'] },
      planKind: { enum: ['note', 'agenda', 'deliverable'], description: 'ONLY for home=plan: agenda=a scheduled time-point; deliverable=something to produce/do; note=a form/structure concept. Use "note" for all non-plan homes.' },
      summary: { type: 'string', description: 'SHORT label ≤8 words, no sentence' },
      detail: { type: 'string', description: 'ONE short line of context, or ""' },
      sourceTs: { type: 'string', description: 'the [ts] of the message this fact is from' },
      sourceQuote: { type: 'string', description: 'the exact phrase, or ""' },
    }, required: ['home', 'planKind', 'summary', 'detail', 'sourceTs', 'sourceQuote'] } },
    people: { type: 'array', items: { type: 'object', additionalProperties: false, properties: {
      name: { type: 'string', description: 'the person\'s full name' },
      note: { type: 'string', description: 'why they matter / their interest, in a few words, or ""' },
      linkedin: { type: 'string', description: 'their LinkedIn URL if one was shared, else ""' },
      sourceTs: { type: 'string', description: 'the [ts] of the message that mentions them' },
      sourceQuote: { type: 'string', description: 'the exact phrase about them, or ""' },
    }, required: ['name', 'note', 'linkedin', 'sourceTs', 'sourceQuote'] } },
    removals: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { label: { type: 'string' } }, required: ['label'] } },
  },
  required: ['captures', 'people', 'removals'],
};

const SCRAPE_SYSTEM = `You read a Slack channel paired to ONE event in EventHub and pull structured facts. Every message is prefixed with its [ts]. You produce THREE lists: captures (event-planning facts), people (individuals met/discussed), and removals (dropped decisions).

CAPTURES — concrete event-logistics facts, each routed to exactly ONE home:
- plan   — a DECIDED detail about the event. Then set planKind to route it:
    · agenda      — a scheduled TIME-POINT / run-of-show item ("doors 6pm", "fireside at 6:30", "roundtables 7pm").
    · deliverable — something to PRODUCE or DO ("merch ordered", "hype reel", "photos uploaded to Luma", "deck built").
    · note        — a FORM / STRUCTURE concept, not timed and not a to-do ("fireside not a panel", "playlist not a DJ", "6 color-coded roundtable sections"). This is the default.
- open   — a TENTATIVE idea, an open to-do, OR anything still UNCERTAIN / being decided. Tentative wording (maybe / leaning / if / depending / getting a quote) → open, never plan. ALSO capture explicit uncertainty as open, e.g. "waiting to hear back from <X>", "still waiting on <X>", "choosing between <A> and <B>", "deciding between …", "TBD / not sure yet / to confirm" — surface it here so the unresolved question is visible (summary names the decision, e.g. "Choosing between Ace Hotel and MaRS").
- budget — a stated cost/figure ("$500 dinner", "$1,500 paid"); put the figure (and any vendor name) in summary/detail.
- person — an INTERNAL TEAMMATE + their event role ("Thurman on bar", "Olivia runs logistics"). Only our own team doing a job for the event.

CAPTURE rules — read carefully, the last run over-produced:
- summary is a SHORT LABEL: ≤ 8 words, no full sentences, no dumping the whole message. e.g. "Fireside chat format", "Ace Hotel, 6pm", "Merch ordered". Put any extra context in detail as ONE short line. If you're writing a paragraph, you're doing it wrong.
- ONE fact → ONE home. NEVER emit the same fact under two homes (do not put "Olivia leads logistics" as both plan AND person). If it's a teammate's role, it's person and ONLY person.
- Conservative: FEWER, higher-confidence facts. Aim for the handful that define the event, not every message.
- SKIP internal operational logistics that aren't event facts: travel, flights, airbnb/hotel check-in, luggage, "book your flights", who's landing when, ride coordination. These are NOT captures.
- SKIP small talk, hype, greetings, thanks, "test", and non-event chatter (dev/software, funding/comp).
- NEVER fabricate unstated details.

PEOPLE — individuals mentioned as MET, RECOMMENDED, or worth remembering (candidates, prospects, contacts), NOT our internal team. e.g. "Kavir Auluck → interested in SWE intern", "met Behzad, said he'd send his resume", "Omar Hayat — Waterloo math masters". Extract:
- name (full name), note (their interest / why they matter, a few words), linkedin (URL if shared, else ""), sourceTs, sourceQuote.
- Include someone even if the only signal is "met X / strong profile / good conversation" (note can be brief). Do NOT include our own teammates here (they go to captures/person). Do NOT invent people who weren't named.

REMOVALS — a decision that was dropped/cancelled/superseded ("panel → fireside instead", "rooftop fell through") → a removals[] entry with a short label. When a figure is restated (quote → paid), keep only the LATEST in captures.

sourceTs = the [ts] of the single message a fact/person is most from. No preamble.`;

export async function extractScrape(msgs: SlackMsg[]): Promise<{ captures: ScrapeProposal[]; people: ScrapePerson[]; removals: Removal[] }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || msgs.length === 0) return { captures: [], people: [], removals: [] };
  const transcript = msgs.map((m) => `[${m.ts}] ${m.user ?? '?'}: ${m.text}`).join('\n');
  const client = new Anthropic({ apiKey });
  const resp = await (client.messages.create as any)({
    model: 'claude-haiku-4-5', max_tokens: 4000, system: SCRAPE_SYSTEM,
    messages: [{ role: 'user', content: `Channel conversation:\n${transcript}` }],
    output_config: { format: { type: 'json_schema', schema: SCRAPE_SCHEMA } },
  });
  const textBlock = (resp.content as any[]).find((b: any) => b.type === 'text');
  if (!textBlock) return { captures: [], people: [], removals: [] };
  try {
    const j = JSON.parse(textBlock.text);
    const captures: ScrapeProposal[] = (j.captures ?? []).map((c: any) => ({
      home: c.home as Home,
      planKind: (['agenda', 'deliverable', 'note'].includes(c.planKind) ? c.planKind : 'note') as PlanKind,
      summary: String(c.summary ?? '').trim(),
      detail: c.detail ? String(c.detail) : undefined,
      sourceQuote: c.sourceQuote ? String(c.sourceQuote) : undefined,
      sourceTs: String(c.sourceTs ?? ''),
    })).filter((c: ScrapeProposal) => c.summary && c.sourceTs);
    const people: ScrapePerson[] = (j.people ?? []).map((p: any) => ({
      name: String(p.name ?? '').trim(),
      note: String(p.note ?? '').trim(),
      linkedin: p.linkedin ? String(p.linkedin).trim() : undefined,
      sourceQuote: p.sourceQuote ? String(p.sourceQuote) : undefined,
      sourceTs: String(p.sourceTs ?? ''),
    })).filter((p: ScrapePerson) => p.name && p.sourceTs);
    const removals: Removal[] = (j.removals ?? []).map((r: any) => ({ label: String(r.label ?? '').trim() })).filter((r: Removal) => r.label);
    return { captures, people, removals };
  } catch {
    console.error(JSON.stringify({ fn: 'slack-extract', op: 'scrape', error: 'invalid json', raw: textBlock.text }));
    return { captures: [], people: [], removals: [] };
  }
}

// ── Series scrape: one channel covers several member events. Same extraction as above, but each fact
// also carries a routing target — the member event it's clearly about, "series" (push-wide), or
// "unassigned" (can't tell → never guess; waits for the user to assign). ──
export interface RosterEvent { id: string; name: string; date?: string | null; descriptor?: string }
export type TargetedProposal = ScrapeProposal & { eventId: string }; // eventId ∈ roster ids | 'series' | 'unassigned'

export async function extractSeriesScrape(
  msgs: SlackMsg[], roster: RosterEvent[],
): Promise<{ captures: TargetedProposal[]; people: ScrapePerson[]; removals: Removal[] }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || msgs.length === 0 || roster.length === 0) return { captures: [], people: [], removals: [] };
  const targets = [...roster.map((r) => r.id), 'series', 'unassigned'];

  const schema = {
    type: 'object', additionalProperties: false,
    properties: {
      captures: { type: 'array', items: { type: 'object', additionalProperties: false, properties: {
        home: { enum: ['plan', 'person', 'open', 'budget'] },
        planKind: { enum: ['note', 'agenda', 'deliverable'], description: 'ONLY for home=plan: agenda=scheduled time-point; deliverable=something to produce/do; note=form/structure concept. "note" for non-plan.' },
        eventId: { enum: targets, description: 'which member event this fact is about; "series" if push-wide; "unassigned" if not clear' },
        summary: { type: 'string', description: 'SHORT label ≤8 words' },
        detail: { type: 'string', description: 'ONE short line, or ""' },
        sourceTs: { type: 'string' }, sourceQuote: { type: 'string' },
      }, required: ['home', 'planKind', 'eventId', 'summary', 'detail', 'sourceTs', 'sourceQuote'] } },
      people: { type: 'array', items: { type: 'object', additionalProperties: false, properties: {
        name: { type: 'string' }, note: { type: 'string' }, linkedin: { type: 'string' }, sourceTs: { type: 'string' }, sourceQuote: { type: 'string' },
      }, required: ['name', 'note', 'linkedin', 'sourceTs', 'sourceQuote'] } },
      removals: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { label: { type: 'string' } }, required: ['label'] } },
    },
    required: ['captures', 'people', 'removals'],
  };

  const rosterText = roster.map((r) => `  - id "${r.id}": ${r.name}${r.date ? ` (${r.date})` : ''}${r.descriptor ? ` — ${r.descriptor}` : ''}`).join('\n');
  const system = `${SCRAPE_SYSTEM}

ROUTING — this channel covers a SERIES of several events (a collective push). Member events:
${rosterText}

For EACH capture set eventId to the member event it is clearly about. Use the event names, dates, and topics as cues — a fact dated near an event, or naming it, belongs to it.
- "series"     → the fact is push-wide / shared across events (an overall budget, a shared vendor, the whole campaign).
- "unassigned" → you CANNOT confidently tell which event it's about. DO NOT GUESS. Prefer "unassigned" over a wrong guess; a human will route it.
Only route to a specific event when the message makes it clear. When in doubt, "unassigned".`;

  const transcript = msgs.map((m) => `[${m.ts}] ${m.user ?? '?'}: ${m.text}`).join('\n');
  const client = new Anthropic({ apiKey });
  const resp = await (client.messages.create as any)({
    model: 'claude-haiku-4-5', max_tokens: 4000, system,
    messages: [{ role: 'user', content: `Channel conversation:\n${transcript}` }],
    output_config: { format: { type: 'json_schema', schema } },
  });
  const textBlock = (resp.content as any[]).find((b: any) => b.type === 'text');
  if (!textBlock) return { captures: [], people: [], removals: [] };
  try {
    const j = JSON.parse(textBlock.text);
    const valid = new Set(targets);
    const captures: TargetedProposal[] = (j.captures ?? []).map((c: any) => ({
      home: c.home as Home,
      planKind: (['agenda', 'deliverable', 'note'].includes(c.planKind) ? c.planKind : 'note') as PlanKind,
      eventId: valid.has(String(c.eventId)) ? String(c.eventId) : 'unassigned',
      summary: String(c.summary ?? '').trim(),
      detail: c.detail ? String(c.detail) : undefined,
      sourceQuote: c.sourceQuote ? String(c.sourceQuote) : undefined,
      sourceTs: String(c.sourceTs ?? ''),
    })).filter((c: TargetedProposal) => c.summary && c.sourceTs);
    const people: ScrapePerson[] = (j.people ?? []).map((p: any) => ({
      name: String(p.name ?? '').trim(), note: String(p.note ?? '').trim(),
      linkedin: p.linkedin ? String(p.linkedin).trim() : undefined,
      sourceQuote: p.sourceQuote ? String(p.sourceQuote) : undefined, sourceTs: String(p.sourceTs ?? ''),
    })).filter((p: ScrapePerson) => p.name && p.sourceTs);
    const removals: Removal[] = (j.removals ?? []).map((r: any) => ({ label: String(r.label ?? '').trim() })).filter((r: Removal) => r.label);
    return { captures, people, removals };
  } catch {
    console.error(JSON.stringify({ fn: 'slack-extract', op: 'series-scrape', error: 'invalid json', raw: textBlock.text }));
    return { captures: [], people: [], removals: [] };
  }
}
