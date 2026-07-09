// DUAL-MAINTAINED: any changes here must also be made in
// supabase/functions/luma-import/index.ts
import { Request, Response } from 'express';
import { getServiceClient } from '../db.js';

interface Guest { name: string | null; email: string | null; status: string | null; checkedIn: boolean }

async function lumaGuests(apiKey: string, apiId: string): Promise<Guest[]> {
  const out: Guest[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < 50; i++) {
    const url = new URL('https://public-api.luma.com/v1/event/get-guests');
    url.searchParams.set('event_api_id', apiId);
    if (cursor) url.searchParams.set('pagination_cursor', cursor);
    const res = await fetch(url, { headers: { 'x-luma-api-key': apiKey, accept: 'application/json' } });
    if (!res.ok) break;
    const data = await res.json() as any;
    const entries: any[] = data.entries ?? [];
    for (const e of entries) {
      const g = e.guest ?? e;
      out.push({
        name: g.name ?? g.user_name ?? null,
        email: (g.email ?? g.user_email ?? null)?.toLowerCase() ?? null,
        status: (g.approval_status ?? g.status ?? null)?.toLowerCase() ?? null,
        checkedIn: !!(g.checked_in_at ?? g.checked_in),
      });
    }
    if (!data.has_more || !data.next_cursor) break;
    cursor = data.next_cursor;
  }
  return out;
}

export async function handler(req: Request, res: Response) {
  try {
    const { eventId, all } = req.body;
    const apiKey = process.env.LUMA_API_KEY;
    if (!apiKey) { res.status(500).json({ error: 'LUMA_API_KEY not configured on the server.' }); return; }

    const supa = getServiceClient();

    // Ensure "Internal" person label exists.
    let internalLabelId: string | null = null;
    const { data: lbl } = await supa.from('label').select('id').eq('scope', 'person').ilike('name', 'internal').limit(1);
    internalLabelId = (lbl as any)?.[0]?.id ?? null;
    if (!internalLabelId) {
      internalLabelId = 'lbl-internal';
      await supa.from('label').insert({ id: internalLabelId, name: 'Internal', scope: 'person' }).then(() => {}, () => {});
    }
    const labelInternal = async (attendeeId: string, email: string) => {
      if (!internalLabelId || !email.endsWith('@instalily.ai')) return;
      const { data } = await supa.from('attendee_label').select('attendee_id').eq('attendee_id', attendeeId).eq('label_id', internalLabelId).limit(1);
      if (!(data as any)?.length) await supa.from('attendee_label').insert({ attendee_id: attendeeId, label_id: internalLabelId });
    };

    let targets: { id: string; name: string; luma_event_id: string }[] = [];
    if (eventId) {
      const { data } = await supa.from('event').select('id, name, luma_event_id').eq('id', eventId).maybeSingle();
      if ((data as any)?.luma_event_id) targets = [data as any];
    } else if (all) {
      const { data: evs } = await supa.from('event').select('id, name, luma_event_id').not('luma_event_id', 'is', null);
      const out: any[] = [];
      for (const e of evs ?? []) {
        const { count } = await supa.from('attendee_event').select('attendee_id', { count: 'exact', head: true }).eq('event_id', (e as any).id);
        if (!count) out.push(e);
      }
      targets = out;
    }
    if (targets.length === 0) { res.json({ events: [] }); return; }

    const results: { id: string; name: string; imported: number; linked: number }[] = [];
    for (const ev of targets) {
      let imported = 0, linked = 0;
      const guests = await lumaGuests(apiKey, ev.luma_event_id);
      for (const g of guests) {
        if (!g.email) continue;
        const { data: existing } = await supa.from('attendee').select('id').ilike('email', g.email).limit(1);
        let attendeeId = (existing as any)?.[0]?.id as string | undefined;
        if (!attendeeId) {
          attendeeId = `att-${crypto.randomUUID()}`;
          const { error } = await supa.from('attendee').insert({ id: attendeeId, name: g.name, email: g.email, type: 'Unknown' });
          if (error) continue;
          imported++;
        }
        await labelInternal(attendeeId, g.email);
        const { data: link } = await supa.from('attendee_event').select('attendee_id').eq('event_id', ev.id).eq('attendee_id', attendeeId).limit(1);
        if (!(link as any)?.length) {
          const { error } = await supa.from('attendee_event').insert({ id: `ae-${crypto.randomUUID()}`, attendee_id: attendeeId, event_id: ev.id, role_at_event: 'attendee', registration_status: g.status, checked_in: g.checkedIn });
          if (!error) linked++;
        }
      }
      results.push({ id: ev.id, name: ev.name, imported, linked });
    }
    res.json({ events: results });
  } catch (e) {
    console.error(JSON.stringify({ fn: 'luma-import', error: String((e as Error)?.message ?? e) }));
    res.status(500).json({ error: String((e as Error)?.message ?? e) });
  }
}
