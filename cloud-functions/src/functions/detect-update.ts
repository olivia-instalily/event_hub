import { Request, Response } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { getServiceClient } from '../db.js';

const FREE_MAIL = new Set(['gmail.com','googlemail.com','outlook.com','hotmail.com','live.com','yahoo.com','icloud.com','me.com','aol.com','proton.me','protonmail.com']);
function domainFromUrl(raw: string | null): string | null {
  if (!raw) return null; const s = raw.trim(); if (!s) return null;
  try { return new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`).hostname.toLowerCase().replace(/^www\./, '') || null; } catch { return null; }
}
function emailDomain(email: string | null): string | null {
  const m = (email ?? '').trim().toLowerCase().match(/@([^@\s>]+)/); return m ? m[1] : null;
}
function domainsMatch(a: string | null, b: string | null): boolean {
  if (!a || !b) return false; const x = a.toLowerCase(), y = b.toLowerCase();
  if (FREE_MAIL.has(x) || FREE_MAIL.has(y)) return false;
  return x === y || x.endsWith(`.${y}`) || y.endsWith(`.${x}`);
}

const CONTRACT_RE = /\b(sign|signed|signing|countersign|executed|contract|agreement|sow|booked|confirm(ed)?)\b/i;
const DONE_RE     = /\b(done|complete|completed|finished|closed|resolved|merged|shipped|wrapped)\b/i;
const STARTED_RE  = /\b(in[\s-]?progress|started|starting|kick(ed)?[\s-]?off|working on|underway|wip|in flight)\b/i;
const TODO_RE     = /\b(to[\s-]?do|todo|backlog|not done|reopen|re-?open|undo|revert|unfinish(ed)?|incomplete|not started|put back|move(d)? back|back to)\b/i;

function detectStatus(text: string): 'Todo' | 'In Progress' | 'Done' | null {
  if (TODO_RE.test(text)) return 'Todo';
  if (STARTED_RE.test(text)) return 'In Progress';
  if (DONE_RE.test(text)) return 'Done';
  return null;
}

type Eng = { id: string; category: string | null; stage: string | null; names: string[]; domains: string[] };
type Del = { id: string; title: string; status: string | null };

function heuristic(text: string, source: string, from: string | null, engs: Eng[], dels: Del[]) {
  const t = text.toLowerCase();
  const has = (name: string) => name && t.includes(name.toLowerCase());
  const senderDomain = emailDomain(from);
  const byDomain = senderDomain ? (engs.find((e) => e.domains.some((d) => domainsMatch(d, senderDomain)))) : undefined;
  const byName   = engs.find((e) => [e.category ?? '', ...e.names].some(has));
  const vendor   = byDomain ?? byName;
  const target   = detectStatus(text);

  if (CONTRACT_RE.test(text) && vendor && target !== 'Todo' && target !== 'In Progress') {
    const name = vendor.names[0] ?? vendor.category ?? 'vendor';
    return { kind: 'contract', status: '', engagementId: vendor.id, deliverableId: '', matchedName: name, summary: `Signed contract detected via ${source} — ${vendor.category ?? name} → Contracted` };
  }
  if (target) {
    const d = dels.find((d) => {
      const words = d.title.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
      return t.includes(d.title.toLowerCase()) || words.filter((w) => t.includes(w)).length >= Math.max(1, Math.ceil(words.length / 2));
    });
    if (d) {
      if (target === 'Done') return { kind: 'complete', status: '', engagementId: '', deliverableId: d.id, matchedName: d.title, summary: `"${d.title}" moved to completed via ${source}` };
      return { kind: 'status', status: target, engagementId: '', deliverableId: d.id, matchedName: d.title, summary: `"${d.title}" → ${target} via ${source}` };
    }
  }
  if (vendor) {
    const name = vendor.names[0] ?? vendor.category ?? 'vendor';
    return { kind: 'note', status: '', engagementId: vendor.id, deliverableId: '', matchedName: name, summary: `${source[0].toUpperCase()}${source.slice(1)} from ${vendor.category ?? name}: ${text.slice(0, 70)}${text.length > 70 ? '…' : ''}` };
  }
  return { kind: 'note', status: '', engagementId: '', deliverableId: '', matchedName: '', summary: `${source[0].toUpperCase()}${source.slice(1)} note: ${text.slice(0, 80)}${text.length > 80 ? '…' : ''}` };
}

const SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    kind:          { type: 'string', enum: ['contract', 'complete', 'status', 'note'] },
    status:        { type: 'string', enum: ['Todo', 'In Progress', 'Done', ''] },
    engagementId:  { type: 'string' },
    deliverableId: { type: 'string' },
    matchedName:   { type: 'string' },
    summary:       { type: 'string' },
  },
  required: ['kind', 'status', 'engagementId', 'deliverableId', 'matchedName', 'summary'],
};

export async function handler(req: Request, res: Response) {
  try {
    const { eventId, text, source = 'email', from = null } = req.body;
    if (!eventId || !text?.trim()) { res.status(400).json({ error: 'eventId and text are required' }); return; }

    const sb = getServiceClient();
    const [{ data: engRows }, { data: delRows }] = await Promise.all([
      sb.from('engagement').select('id, category, stage, candidates:engagement_candidate ( vendor_name, link )').eq('event_id', eventId),
      sb.from('deliverable').select('id, title, status').eq('event_id', eventId),
    ]);
    const engs: Eng[] = (engRows ?? []).map((e: any) => ({
      id: e.id, category: e.category, stage: e.stage,
      names:   (e.candidates ?? []).map((c: any) => c.vendor_name).filter(Boolean),
      domains: Array.from(new Set((e.candidates ?? []).map((c: any) => domainFromUrl(c.link)).filter(Boolean))) as string[],
    }));
    const dels: Del[] = (delRows ?? []).map((d: any) => ({ id: d.id, title: d.title, status: d.status }));

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) { res.json(heuristic(text, source, from, engs, dels)); return; }

    const client = new Anthropic({ apiKey });
    const senderDomain = emailDomain(from);
    const sys = `You triage an inbound ${source} note for an event-planning tool. Pick one kind:\n- "contract": a vendor contract was signed — set engagementId to the matching decision.\n- "complete": an action item is finished/done — set deliverableId to the matching task, status="Done".\n- "status": an action item should move to a DIFFERENT status — set deliverableId and status to "Todo" (reopen) or "In Progress" (started).\n- "note": just correspondence.\nMatch vendor by sender domain first, then name. Match deliverables by title words. Set status="" unless kind="status". Write a concise one-line summary.`;
    const payload = { note: text, senderDomain, engagements: engs, deliverables: dels };
    const resp = await (client.messages.create as any)({
      model: 'claude-haiku-4-5', max_tokens: 1024, system: sys,
      messages: [{ role: 'user', content: JSON.stringify(payload) }],
      output_config: { format: { type: 'json_schema', schema: SCHEMA } },
    });
    const tb = (resp.content as any[]).find((b: any) => b.type === 'text');
    if (!tb) { res.json(heuristic(text, source, from, engs, dels)); return; }
    const out = JSON.parse(tb.text);
    res.json({ ...out, engagementId: out.engagementId || null, deliverableId: out.deliverableId || null, matchedName: out.matchedName || null, status: out.status || null });
  } catch (e) {
    console.error(JSON.stringify({ fn: 'detect-update', error: String((e as Error)?.message ?? e) }));
    res.status(500).json({ error: String((e as Error)?.message ?? e) });
  }
}
