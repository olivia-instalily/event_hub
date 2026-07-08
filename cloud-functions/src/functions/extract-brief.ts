// Ported from supabase/functions/extract-brief/index.ts — logic identical, Deno → Node.js.
import { Request, Response } from 'express';
import Anthropic from '@anthropic-ai/sdk';

const TAGS = [
  'Client summit', 'Brand & community event', 'Co-hosted partner event', 'Hackathon',
  'Sponsorship', 'Internal team social', 'Company milestone',
];

const SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    title:       { type: 'string' },
    owner:       { type: 'string' },
    date:        { type: 'string' },
    startTime:   { type: 'string' },
    endTime:     { type: 'string' },
    location:    { type: 'string' },
    headcount:   { type: ['number', 'null'] },
    audience:    { type: 'string' },
    format:      { type: 'string' },
    tag:         { enum: [...TAGS, null] },
    specificity: { enum: ['event', 'template'] },
    overview:    { type: 'string' },
    guardrails:  { type: 'array', items: { type: 'string' } },
    heuristics:  { type: 'array', items: { type: 'string' } },
    phases:      { type: 'array', items: { type: 'string' } },
    deliverables: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          title:       { type: 'string' },
          phase:       { type: 'string' },
          offsetStart: { type: ['number', 'null'] },
          offsetEnd:   { type: ['number', 'null'] },
          original:    { type: 'string' },
        },
        required: ['title', 'phase', 'offsetStart', 'offsetEnd', 'original'],
      },
    },
    droppedForTemplate: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: { title: { type: 'string' }, reason: { type: 'string' } },
        required: ['title', 'reason'],
      },
    },
    vendors:     { type: 'array', items: { type: 'string' } },
    staff:       { type: 'array', items: { type: 'string' } },
    agenda: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: { time: { type: 'string' }, title: { type: 'string' } },
        required: ['time', 'title'],
      },
    },
    walkthrough: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          title:        { type: 'string' },
          rationale:    { type: 'string' },
          phase:        { type: 'string' },
          linkedKind:   { enum: ['deliverable', 'role', null] },
          linkedLabel:  { type: 'string' },
          isCallout:    { type: 'boolean' },
        },
        required: ['title', 'rationale', 'phase', 'linkedKind', 'linkedLabel', 'isCallout'],
      },
    },
    outreach: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: { title: { type: 'string' }, whenToUse: { type: 'string' }, body: { type: 'string' } },
        required: ['title', 'whenToUse', 'body'],
      },
    },
    budgetTotal: { type: ['number', 'null'] },
  },
  required: ['title','owner','date','startTime','endTime','location','headcount','audience','format','tag','specificity','overview','guardrails','heuristics','phases','deliverables','droppedForTemplate','vendors','staff','agenda','walkthrough','outreach','budgetTotal'],
};

const SYSTEM = `You extract structured planning data from an event brief for InstaLILY's internal event tool (EventHub). Output must match the provided JSON schema exactly. Extract only what the brief states; never invent.

A brief sits somewhere on a spectrum from a fully-specified single event to a reusable playbook with blanks. Extract the STRUCTURE either way; where a value is a blank, placeholder, or [bracket] (e.g. "[route]", "weekend morning", "~2 weeks out"), treat that field as absent but still extract the surrounding structure. Set specificity to "event" if a concrete date is present, else "template".

DELIVERABLES — DEFINITE ACTION ITEMS only: concrete tasks someone performs, in imperative voice. Extract EVERY task from any plan / checklist / "how to" section, WHETHER OR NOT a time is given (offsets null when no timing stated). One task per item; split compound sentences into separate tasks.

OFFSETS — a task's timing relative to event day (negative=before, 0=day-of, positive=after), in DAYS. "2 weeks before" → offsetStart -14. No stated timing → both null (still extract the task).

PHASES — name them from the brief's OWN section structure, in order.

TEMPLATE MODE (specificity="template") — generalize deliverables: strip person/client/partner names, generalize specific case studies to their reusable slot, drop deliverables that have no reusable form.

GUARDRAILS — only EXPLICIT stated principles/constraints/values.
HEURISTICS — stated planning rules-of-thumb verbatim-ish.
STAFF — the ROLE only, never a person's name.
WALKTHROUGH — retell the brief as an ordered, phased narrative that keeps the reasoning.
OUTREACH — pull any invite/outreach copy with [bracket] merge fields kept exactly.

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
      messages: [{ role: 'user', content: `Event brief:\n${text}` }],
      output_config: { format: { type: 'json_schema', schema: SCHEMA } },
    });

    if (resp.stop_reason === 'max_tokens') { res.status(502).json({ error: 'Extraction truncated — raise max_tokens.' }); return; }
    const textBlock = (resp.content as any[]).find((b: any) => b.type === 'text');
    if (!textBlock) { res.status(502).json({ error: 'No extraction returned.' }); return; }
    let parsed: any;
    try { parsed = JSON.parse(textBlock.text); } catch { res.status(502).json({ error: 'Model returned invalid JSON.', raw: textBlock.text }); return; }

    // Backstop: strip trailing person references on template deliverables.
    if (parsed?.specificity === 'template' && Array.isArray(parsed.deliverables)) {
      const GENERIC = new Set(['av','slack','luma','hr','it','pr','ai','qa','ceo','cto','vp','us','eu','ui','ux']);
      for (const d of parsed.deliverables) {
        if (typeof d?.title !== 'string') continue;
        const m = d.title.match(/\s*\(?\s*(?:with|w\/)\s+([A-Z][a-zA-Z]+)\s*\)?\s*$/);
        if (!m || GENERIC.has(m[1].toLowerCase())) continue;
        const stripped = d.title.slice(0, m.index).replace(/[\s(]+$/, '').trim();
        if (stripped) { if (!d.original) d.original = d.title; d.title = stripped; }
      }
    }
    res.json(parsed);
  } catch (e) {
    console.error(JSON.stringify({ fn: 'extract-brief', error: String((e as Error)?.message ?? e) }));
    res.status(500).json({ error: String((e as Error)?.message ?? e) });
  }
}
