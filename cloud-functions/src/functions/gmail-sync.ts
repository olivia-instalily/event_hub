import { Request, Response } from 'express';
import { getServiceClient } from '../db.js';

function domainFromUrl(raw: string | null): string | null {
  if (!raw) return null;
  const s = raw.trim(); if (!s) return null;
  try { return new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`).hostname.toLowerCase().replace(/^www\./, '') || null; } catch { return null; }
}
function emailDomain(addr: string | null): string | null {
  const m = (addr ?? '').toLowerCase().match(/@([^@\s>]+)/); return m ? m[1] : null;
}
const FREE_MAIL = new Set(['gmail.com','googlemail.com','outlook.com','hotmail.com','live.com','yahoo.com','icloud.com','me.com','aol.com','proton.me','protonmail.com']);
function domainsMatch(a: string | null, b: string | null): boolean {
  if (!a || !b) return false; const x = a.toLowerCase(), y = b.toLowerCase();
  if (FREE_MAIL.has(x) || FREE_MAIL.has(y)) return false;
  return x === y || x.endsWith(`.${y}`) || y.endsWith(`.${x}`);
}
const header = (msg: any, name: string): string =>
  (msg.payload?.headers ?? []).find((h: any) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? '';

async function accessToken(): Promise<string> {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      refresh_token: process.env.GMAIL_REFRESH_TOKEN!,
      grant_type: 'refresh_token',
    }),
  });
  const d = await r.json() as any;
  if (!d.access_token) throw new Error(`Google token error: ${d.error ?? 'no access_token'}${d.error_description ? ` — ${d.error_description}` : ''}`);
  return d.access_token;
}

export async function handler(req: Request, res: Response) {
  try {
    const { eventId, days = 90 } = req.body;
    if (!eventId) { res.status(400).json({ error: 'eventId required' }); return; }
    if (!process.env.GMAIL_REFRESH_TOKEN) { res.status(400).json({ error: 'Gmail not connected (GMAIL_REFRESH_TOKEN unset). Run scripts/gmail-auth.mjs.' }); return; }

    const sb = getServiceClient();
    const { data: engRows } = await sb.from('engagement').select('id, category, candidates:engagement_candidate ( vendor_name, link )').eq('event_id', eventId);
    const engByDomain: { id: string; category: string | null; name: string | null; domain: string }[] = [];
    for (const e of engRows ?? []) {
      for (const c of (e as any).candidates ?? []) {
        const d = domainFromUrl(c.link);
        if (d && !FREE_MAIL.has(d)) engByDomain.push({ id: (e as any).id, category: (e as any).category, name: c.vendor_name, domain: d });
      }
    }
    const domains = Array.from(new Set(engByDomain.map((e) => e.domain)));
    if (domains.length === 0) { res.json({ matched: 0, recorded: 0, scannedDomains: 0, note: 'No vendor domains on this event (set vendor links).' }); return; }

    const token = await accessToken();
    const gauth = { headers: { Authorization: `Bearer ${token}` } };

    const q = `newer_than:${days}d from:(${domains.join(' OR ')})`;
    const listRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=25&q=${encodeURIComponent(q)}`, gauth);
    const list = await listRes.json() as any;
    if (list.error) throw new Error(`Gmail list: ${list.error.message}`);
    const ids: string[] = (list.messages ?? []).map((m: any) => m.id);

    const { data: seenRows } = await sb.from('event_update').select('external_id').eq('event_id', eventId).not('external_id', 'is', null);
    const seen = new Set((seenRows ?? []).map((r: any) => r.external_id));

    let matched = 0, recorded = 0;
    for (const id of ids) {
      if (seen.has(id)) continue;
      const mRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`, gauth);
      const msg = await mRes.json() as any;
      if (msg.error) continue;
      const fromHeader  = header(msg, 'From');
      const subject     = header(msg, 'Subject') || '(no subject)';
      const senderDomain = emailDomain(fromHeader);
      const hit = engByDomain.find((e) => domainsMatch(e.domain, senderDomain));
      if (!hit) continue;
      matched++;
      const label = hit.name ?? hit.category ?? 'vendor';
      const { error } = await sb.from('event_update').insert({
        id: 'upd-' + crypto.randomUUID(),
        event_id: eventId,
        source: 'email',
        summary: `${hit.category ?? label}: ${subject}`,
        detail: msg.snippet ?? null,
        link_url: `https://mail.google.com/mail/u/0/#all/${id}`,
        engagement_id: hit.id,
        external_id: id,
      });
      if (!error) recorded++;
    }

    res.json({ matched, recorded, scannedDomains: domains.length });
  } catch (e) {
    console.error(JSON.stringify({ fn: 'gmail-sync', error: String((e as Error)?.message ?? e) }));
    res.status(500).json({ error: String((e as Error)?.message ?? e) });
  }
}
