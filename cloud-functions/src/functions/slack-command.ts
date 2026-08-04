// `/eventhub <question>` — a Q&A slash command used inside an event's linked Slack channel. Resolves
// the channel's event, gathers its structured plan (basics, run of show, deliverables, staffing,
// budget, notes, learnings), and answers the question GROUNDED in that data — saying it's not known
// when the plan doesn't contain the answer.
//
// CLOUD-RUN ONLY (external webhook, like slack-events). Registered with express.raw() BEFORE
// express.json() so the Slack signature verifies over the raw urlencoded body.
import { Request, Response } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { verifySlackSignature } from '../lib/slack.js';
import { getServiceClient } from '../db.js';
import { postToResponseUrl } from '../lib/slack-api.js';
import { resolveEvent, type EventRow } from './slack-capture-lib.js';

// Where the app lives, for the "Open in EventHub" link on each answer.
const APP_URL = (process.env.APP_ORIGIN ?? 'https://eventhub-licvsmaspa-uc.a.run.app').replace(/\/+$/, '');

export interface SlashCommand { command: string; text: string; channelId: string; userId: string; responseUrl: string; }

// Parse Slack's application/x-www-form-urlencoded slash-command body.
export function parseSlashCommand(raw: string): SlashCommand {
  const p = new URLSearchParams(raw);
  return {
    command: p.get('command') ?? '',
    text: (p.get('text') ?? '').trim(),
    channelId: p.get('channel_id') ?? '',
    userId: p.get('user_id') ?? '',
    responseUrl: p.get('response_url') ?? '',
  };
}

// The event fields we answer from. Kept explicit so the grounding context is a stable, auditable shape.
export interface EventFacts {
  name: string | null; event_date: string | null; start_time: string | null; end_time: string | null;
  location: string | null; office: string | null; status: string | null; macro_stage: string | null;
  headcount: number | null; rsvp: number | null; capacity: number | null; why: string | null;
  verdict: string | null; overview_summary: string | null;
  agenda: { time?: string; title?: string }[] | null;
  staff_roles: string[] | null; role_assignments: Record<string, string> | null;
  plan_items: { text?: string; detail?: string }[] | null; reflections: string[] | null;
  // Public / external URLs for the event.
  luma_url: string | null; live_url: string | null; preview_url: string | null;
  info_url: string | null; gcal_html_link: string | null; doc_link: string | null;
}
export interface DeliverableFact { title: string | null; status: string | null; phase: string | null; resolved_due_date: string | null; }
export interface BudgetFact { label: string | null; confirmed_amount: number | null; payment_status: string | null; vendor_name: string | null; }

const money = (n: number | null) => (n == null ? null : `$${Math.round(n).toLocaleString('en-US')}`);

// Build a compact, factual context block from the event's data — the ONLY ground truth the model may
// use. Omits empty sections so "not stated" stays genuinely absent (the model must then say so).
export function buildEventContext(ev: EventFacts, dels: DeliverableFact[], budget: BudgetFact[], owners: string[] = []): string {
  const L: string[] = [];
  const owned = owners.filter((o) => o?.trim());
  if (owned.length) L.push(`## Owners\n${owned.map((o) => `- ${o}`).join('\n')}`);
  const basics = [
    `Name: ${ev.name ?? '—'}`,
    ev.event_date ? `Date: ${ev.event_date}` : null,
    (ev.start_time || ev.end_time) ? `Time: ${[ev.start_time, ev.end_time].filter(Boolean).join('–')}` : null,
    ev.location ? `Location: ${ev.location}` : null,
    ev.office ? `Office: ${ev.office}` : null,
    ev.status ? `Status: ${ev.status}` : null,
    ev.macro_stage ? `Stage: ${ev.macro_stage}` : null,
    ev.headcount != null ? `Headcount: ${ev.headcount}` : null,
    ev.rsvp != null ? `RSVPs: ${ev.rsvp}` : null,
    ev.capacity != null ? `Capacity: ${ev.capacity}` : null,
  ].filter(Boolean);
  L.push(`## Event basics\n${basics.join('\n')}`);

  if (ev.why?.trim()) L.push(`## Why / goal\n${ev.why.trim()}`);
  if (ev.overview_summary?.trim()) L.push(`## Current summary\n${ev.overview_summary.trim()}`);

  const agenda = (ev.agenda ?? []).filter((a) => a?.title?.trim());
  if (agenda.length) L.push(`## Run of show\n${agenda.map((a) => `- ${[a.time, a.title].filter(Boolean).join(' — ')}`).join('\n')}`);

  if (dels.length) {
    const byPhase = new Map<string, string[]>();
    for (const d of dels) {
      if (!d.title?.trim()) continue;
      const ph = d.phase || 'Other';
      (byPhase.get(ph) ?? byPhase.set(ph, []).get(ph))!.push(`- ${d.title}${d.status ? ` [${d.status}]` : ''}${d.resolved_due_date ? ` (due ${d.resolved_due_date})` : ''}`);
    }
    const blocks = [...byPhase.entries()].map(([ph, items]) => `${ph}:\n${items.join('\n')}`);
    if (blocks.length) L.push(`## Deliverables\n${blocks.join('\n')}`);
  }

  const roles = ev.staff_roles ?? [];
  if (roles.length) {
    const assigns = ev.role_assignments ?? {};
    L.push(`## Staffing\n${roles.map((r) => `- ${r}${assigns[r] ? ` — ${assigns[r]}` : ''}`).join('\n')}`);
  }

  if (budget.length) {
    const lines = budget.filter((b) => b.label?.trim() || b.vendor_name?.trim()).map((b) => {
      const amt = money(b.confirmed_amount);
      return `- ${b.label || '—'}${b.vendor_name ? ` (vendor: ${b.vendor_name})` : ''}${amt ? `: ${amt}` : ''}${b.payment_status ? ` [${b.payment_status}]` : ''}`;
    });
    if (lines.length) L.push(`## Budget\n${lines.join('\n')}`);
  }

  const notes = (ev.plan_items ?? []).filter((p) => p?.text?.trim());
  if (notes.length) L.push(`## Form & structure notes\n${notes.map((p) => `- ${p.text}${p.detail ? ` — ${p.detail}` : ''}`).join('\n')}`);

  const refl = (ev.reflections ?? []).filter((r) => r?.trim());
  if (refl.length) L.push(`## Learnings\n${refl.map((r) => `- ${r}`).join('\n')}`);

  if (ev.verdict?.trim()) L.push(`## Verdict\n${ev.verdict.trim()}`);

  const links = [
    ev.luma_url ? `Public event page (Luma): ${ev.luma_url}` : null,
    ev.live_url ? `Live page: ${ev.live_url}` : null,
    (!ev.live_url && ev.preview_url) ? `Page preview: ${ev.preview_url}` : null,
    ev.info_url ? `Info / registration: ${ev.info_url}` : null,
    ev.gcal_html_link ? `Calendar entry: ${ev.gcal_html_link}` : null,
    ev.doc_link ? `Planning doc: ${ev.doc_link}` : null,
  ].filter(Boolean);
  if (links.length) L.push(`## Links / URLs\n${links.join('\n')}`);

  return L.join('\n\n');
}

const QA_SYSTEM = `You answer a teammate's question about ONE specific event, using ONLY the event data provided below. This is for EventHub, an internal event-planning tool.

Rules:
- Answer ONLY from the provided event data. NEVER invent details, dates, names, or figures.
- If the data does not contain the answer, say so plainly — e.g. "That's not in the plan yet." Do not guess or pad.
- Be concise and Slack-friendly: a sentence or two, or a short bullet list. No preamble like "Based on the data".
- "Day of" / "day-of" refers to the run of show + the Day-of deliverables. "The plan" spans run of show, deliverables, staffing, and notes.
- If the question is ambiguous, answer the most likely intent from the data rather than asking to clarify.`;

export async function answerEventQuestion(question: string, context: string, apiKey: string): Promise<string> {
  const client = new Anthropic({ apiKey });
  const resp = await (client.messages.create as any)({
    model: 'claude-haiku-4-5', max_tokens: 700, system: QA_SYSTEM,
    messages: [{ role: 'user', content: `EVENT DATA:\n${context}\n\n---\nQUESTION: ${question}` }],
  });
  const text = (resp?.content ?? []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('').trim();
  return text || "I couldn't find an answer to that in the event's plan.";
}

export async function handler(req: Request, res: Response) {
  const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : String(req.body ?? '');
  if (!verifySlackSignature(raw, req.header('x-slack-request-timestamp'), req.header('x-slack-signature'), process.env.SLACK_SIGNING_SECRET ?? '')) {
    res.status(401).send('bad signature'); return;
  }
  const cmd = parseSlashCommand(raw);
  if (!cmd.text) {
    res.json({ response_type: 'ephemeral', text: 'Ask a question about this event, e.g. `/eventhub what\'s the plan for day of?`' });
    return;
  }
  // Ack within Slack's 3s window; the real answer follows async via response_url.
  res.json({ response_type: 'ephemeral', text: `:mag: _${cmd.text}_` });

  try {
    await respondToQuestion(cmd);
  } catch (e) {
    console.error(JSON.stringify({ fn: 'slack-command', error: String((e as Error)?.message) }));
    if (cmd.responseUrl) await postToResponseUrl(cmd.responseUrl, 'Something went wrong answering that — try again in a moment.');
  }
}

async function respondToQuestion(cmd: SlashCommand): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) { await postToResponseUrl(cmd.responseUrl, 'Q&A isn’t configured on the server yet.'); return; }
  const sb = getServiceClient();

  // Resolve the event linked to this channel.
  const { data: events } = await sb.from('event')
    .select('id, name, event_date, slack_channel').eq('slack_channel', cmd.channelId);
  const ev = resolveEvent((events ?? []) as EventRow[], cmd.channelId);
  if (!ev) { await postToResponseUrl(cmd.responseUrl, 'This channel isn’t linked to an event yet, so I can’t answer questions about one.'); return; }

  const [{ data: full }, { data: dels }, { data: bud }, { data: ownerRows }] = await Promise.all([
    sb.from('event').select('name, event_date, start_time, end_time, location, office, status, macro_stage, headcount, rsvp, capacity, why, verdict, overview_summary, agenda, staff_roles, role_assignments, plan_items, reflections, luma_url, live_url, preview_url, info_url, gcal_html_link, doc_link').eq('id', ev.id).maybeSingle(),
    sb.from('deliverable').select('title, status, phase, resolved_due_date').eq('event_id', ev.id),
    sb.from('budget').select('id').eq('event_id', ev.id).maybeSingle(),
    sb.from('event_owner').select('profile:profile ( name )').eq('event_id', ev.id),
  ]);
  if (!full) { await postToResponseUrl(cmd.responseUrl, 'Couldn’t load this event’s plan.'); return; }
  const { data: budget } = bud
    ? await sb.from('budget_line').select('label, confirmed_amount, payment_status, vendor_name').eq('budget_id', (bud as any).id)
    : { data: [] as BudgetFact[] };
  const owners = ((ownerRows ?? []) as any[]).map((r) => r.profile?.name).filter(Boolean) as string[];

  const context = buildEventContext(full as unknown as EventFacts, (dels ?? []) as DeliverableFact[], (budget ?? []) as unknown as BudgetFact[], owners);
  const answer = await answerEventQuestion(cmd.text, context, apiKey);
  // Link the answer back to the event's page in EventHub so the asker can click straight through.
  const pageLink = `<${APP_URL}/?event=${encodeURIComponent(ev.id)}|Open “${ev.name ?? 'event'}” in EventHub>`;
  await postToResponseUrl(cmd.responseUrl, `*${cmd.text}*\n${answer}\n\n${pageLink}`);
}
