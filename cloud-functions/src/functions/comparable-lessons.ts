// DUAL-MAINTAINED: any changes here must also be made in
// supabase/functions/comparable-lessons/index.ts
import { Request, Response } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { getServiceClient } from '../db.js';

const SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    lessons: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          body:            { type: 'string', description: "the lesson text, copied verbatim from the source" },
          sourceEventName: { type: 'string', description: "the source series/event the lesson came from" },
          why:             { type: 'string', description: "one short phrase on why it's applicable to this event" },
        },
        required: ['body', 'sourceEventName', 'why'],
      },
    },
  },
  required: ['lessons'],
};

const SYSTEM = `You curate "carried lessons" for an internal event-planning tool. Given a NEW event being planned and a list of CANDIDATE sources (past events/series, each with tags and a set of reflection notes), pick the reflections that are POTENTIALLY APPLICABLE to the new event — overlapping tags or a similar theme/format. It does NOT need to be an exact match, just plausibly useful. Copy each chosen reflection's text verbatim into "body", set "sourceEventName" to its source, and give a short "why". Omit reflections that aren't relevant. Return an empty list if none apply.`;

type Candidate = { seriesId: string; source: string; tags: string[]; reflections: string[] };

export async function handler(req: Request, res: Response) {
  try {
    const { eventId, draft } = req.body;
    if (!eventId && !draft) { res.status(400).json({ error: 'eventId or draft is required' }); return; }

    const sb = getServiceClient();

    let ev: any;
    if (eventId) {
      const { data } = await sb.from('event').select('id, name, format, tags, modeled_on_event_id, series_id').eq('id', eventId).maybeSingle();
      if (!data) { res.status(404).json({ error: 'event not found' }); return; }
      ev = data;
    } else {
      ev = { id: null, name: draft.name ?? '', format: draft.format ?? null, tags: draft.tags ?? [], modeled_on_event_id: draft.modeledOnEventId ?? null, series_id: null };
    }
    const myTags: string[] = ev.tags ?? [];

    const modeledOnId = ev.modeled_on_event_id as string | null;
    let linkedSeriesId: string | null = null;
    if (modeledOnId) {
      const { data: src } = await sb.from('event').select('series_id').eq('id', modeledOnId).maybeSingle();
      linkedSeriesId = (src as any)?.series_id ?? null;
    }

    const { data: refs } = await sb.from('reflection').select('body, series_id, event_id, series:event_series ( name )').not('series_id', 'is', null);

    const refEventIds = Array.from(new Set((refs ?? []).map((r: any) => r.event_id).filter(Boolean)));
    const { data: srcEvents } = refEventIds.length
      ? await sb.from('event').select('id, name').in('id', refEventIds)
      : { data: [] as any[] };
    const nameById = new Map((srcEvents ?? []).map((e: any) => [e.id, e.name]));
    const provOf = (body: string) => {
      const r = (refs ?? []).find((x: any) => x.body === body);
      const id = (r as any)?.event_id ?? null;
      return { id, name: (id && nameById.get(id)) || (r as any)?.series?.name || 'a past event' };
    };

    const ownSeriesId = ev.series_id as string | null;
    const carry = (sid: string | null, why: string) =>
      sid
        ? (refs ?? []).filter((r: any) => r.series_id === sid).map((r: any) => { const p = provOf(r.body); return { body: r.body, sourceEventId: p.id, sourceEventName: p.name, why }; })
        : [];
    const ownLessons    = carry(ownSeriesId, 'from this event');
    const linkedLessons = carry(linkedSeriesId, 'from the event you started from');
    const alwaysSeen = new Set<string>();
    const alwaysLessons = [...ownLessons, ...linkedLessons].filter((l) => (alwaysSeen.has(l.body) ? false : (alwaysSeen.add(l.body), true)));

    const today     = new Date().toISOString().slice(0, 10);
    const seriesIds = Array.from(new Set((refs ?? []).map((r: any) => r.series_id)));

    const { data: pastEvents } = seriesIds.length
      ? await sb.from('event').select('name, tags, series_id, event_date').in('series_id', seriesIds).lt('event_date', today)
      : { data: [] as any[] };

    const bySeries = new Map<string, Candidate>();
    for (const r of refs ?? []) {
      const sid = (r as any).series_id as string;
      if (!bySeries.has(sid)) bySeries.set(sid, { seriesId: sid, source: (r as any).series?.name ?? 'a past event', tags: [], reflections: [] });
      bySeries.get(sid)!.reflections.push((r as any).body);
    }
    for (const pe of pastEvents ?? []) {
      const c = bySeries.get((pe as any).series_id);
      if (c) for (const t of (pe as any).tags ?? []) if (!c.tags.includes(t)) c.tags.push(t);
    }
    const pastSeries = new Set((pastEvents ?? []).map((pe: any) => pe.series_id));
    const skip = new Set([ownSeriesId, linkedSeriesId].filter(Boolean) as string[]);
    const candidates = Array.from(bySeries.entries()).filter(([sid]) => pastSeries.has(sid) && !skip.has(sid)).map(([, c]) => c);

    if (candidates.length === 0) { res.json({ lessons: alwaysLessons }); return; }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      const lessons = [...alwaysLessons];
      const seenBody = new Set(lessons.map((l) => l.body));
      for (const c of candidates) {
        const shared = c.tags.find((t) => myTags.includes(t));
        if (!shared) continue;
        for (const body of c.reflections) if (!seenBody.has(body)) { const p = provOf(body); lessons.push({ body, sourceEventId: p.id, sourceEventName: p.name, why: `shared tag: ${shared}` }); seenBody.add(body); }
      }
      res.json({ lessons }); return;
    }

    const client  = new Anthropic({ apiKey });
    const userMsg = `NEW event: ${JSON.stringify({ name: ev.name, format: ev.format, tags: myTags })}\n\nCANDIDATE sources:\n${JSON.stringify(candidates, null, 2)}`;
    const resp    = await (client.messages.create as any)({
      model: 'claude-haiku-4-5', max_tokens: 2048, system: SYSTEM,
      messages: [{ role: 'user', content: userMsg }],
      output_config: { format: { type: 'json_schema', schema: SCHEMA } },
    });
    const tb = (resp.content as any[]).find((b: any) => b.type === 'text');
    const claudeLessons: { body: string; sourceEventName: string; why: string }[] = tb ? (JSON.parse(tb.text).lessons ?? []) : [];
    const claudeEnriched = claudeLessons.map((l) => { const p = provOf(l.body); return { ...l, sourceEventId: p.id, sourceEventName: p.name }; });
    const seen = new Set(alwaysLessons.map((l) => l.body));
    res.json({ lessons: [...alwaysLessons, ...claudeEnriched.filter((l) => !seen.has(l.body))] });
  } catch (e) {
    console.error(JSON.stringify({ fn: 'comparable-lessons', error: String((e as Error)?.message ?? e) }));
    res.status(500).json({ error: String((e as Error)?.message ?? e) });
  }
}
