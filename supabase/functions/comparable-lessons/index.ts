// Edge function: carried lessons for an in-process event.
// Finds reflections from *comparable past events* — events of overlapping tags /
// similar theme — and returns them as read-only lessons. Uses Claude to judge
// "potentially applicable" when an API key is configured; otherwise falls back to a
// deterministic shared-tag match so the planning view works before the key is set.
//
// POST { eventId: string }  — lessons for an existing event
//   OR { draft: { name?, format?, tags?, modeledOnEventId? } }  — preview before the event exists
//   → { lessons: [{ body, sourceEventName, why }] }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Anthropic from "npm:@anthropic-ai/sdk";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    lessons: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          body: { type: "string", description: "the lesson text, copied verbatim from the source" },
          sourceEventName: { type: "string", description: "the source series/event the lesson came from" },
          why: { type: "string", description: "one short phrase on why it's applicable to this event" },
        },
        required: ["body", "sourceEventName", "why"],
      },
    },
  },
  required: ["lessons"],
};

const SYSTEM = `You curate "carried lessons" for an internal event-planning tool.
Given a NEW event being planned and a list of CANDIDATE sources (past events/series, each with tags and a set of reflection notes), pick the reflections that are POTENTIALLY APPLICABLE to the new event — overlapping tags or a similar theme/format. It does NOT need to be an exact match, just plausibly useful. Copy each chosen reflection's text verbatim into "body", set "sourceEventName" to its source, and give a short "why". Omit reflections that aren't relevant. Return an empty list if none apply.`;

type Candidate = { seriesId: string; source: string; tags: string[]; reflections: string[] };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  try {
    const { eventId, draft } = await req.json();
    if (!eventId && !draft) return json({ error: "eventId or draft is required" }, 400);

    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );

    // Current event — loaded for a real event, or synthesized from a draft preview.
    let ev: any;
    if (eventId) {
      const { data } = await sb.from("event").select("id, name, format, tags, modeled_on_event_id").eq("id", eventId).maybeSingle();
      if (!data) return json({ error: "event not found" }, 404);
      ev = data;
    } else {
      ev = { id: null, name: draft.name ?? "", format: draft.format ?? null, tags: draft.tags ?? [], modeled_on_event_id: draft.modeledOnEventId ?? null };
    }
    const myTags: string[] = ev.tags ?? [];

    // The past event this one was "started from" — its lessons are always carried,
    // regardless of tag overlap. Reflections hang off the series, so resolve to it.
    const modeledOnId = (ev as any).modeled_on_event_id as string | null;
    let linkedSeriesId: string | null = null;
    if (modeledOnId) {
      const { data: src } = await sb.from("event").select("series_id").eq("id", modeledOnId).maybeSingle();
      linkedSeriesId = (src as any)?.series_id ?? null;
    }

    // Reflections live at series level; gather them per series with the series name.
    const { data: refs } = await sb
      .from("reflection")
      .select("body, series_id, series:event_series ( name )")
      .not("series_id", "is", null);

    const linkedLessons = linkedSeriesId
      ? (refs ?? [])
          .filter((r: any) => r.series_id === linkedSeriesId)
          .map((r: any) => ({ body: r.body, sourceEventName: r.series?.name ?? "the event you started from", why: "from the event you started from" }))
      : [];

    const today = new Date().toISOString().slice(0, 10);
    const seriesIds = Array.from(new Set((refs ?? []).map((r: any) => r.series_id)));

    // Past events in those series → their tags, so comparability can use tags.
    const { data: pastEvents } = seriesIds.length
      ? await sb
          .from("event")
          .select("name, tags, series_id, event_date")
          .in("series_id", seriesIds)
          .lt("event_date", today)
      : { data: [] as any[] };

    // One candidate per series that has both reflections and a past event.
    const bySeries = new Map<string, Candidate>();
    for (const r of refs ?? []) {
      const sid = (r as any).series_id as string;
      if (!bySeries.has(sid)) {
        bySeries.set(sid, { seriesId: sid, source: (r as any).series?.name ?? "a past event", tags: [], reflections: [] });
      }
      bySeries.get(sid)!.reflections.push((r as any).body);
    }
    for (const pe of pastEvents ?? []) {
      const c = bySeries.get((pe as any).series_id);
      if (c) for (const t of (pe as any).tags ?? []) if (!c.tags.includes(t)) c.tags.push(t);
    }
    // Keep only series that actually have a past event (so future-only series don't leak).
    const pastSeries = new Set((pastEvents ?? []).map((pe: any) => pe.series_id));
    const candidates = Array.from(bySeries.entries())
      .filter(([sid]) => pastSeries.has(sid))
      .map(([, c]) => c);

    // No comparable series → still carry the linked event's lessons if there are any.
    if (candidates.length === 0) return json({ lessons: linkedLessons });

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) {
      // Deterministic fallback: the linked event's lessons first, then reflections
      // from other sources sharing ≥1 tag.
      const lessons = [...linkedLessons];
      for (const c of candidates) {
        if (c.seriesId === linkedSeriesId) continue; // already carried above
        const shared = c.tags.find((t) => myTags.includes(t));
        if (!shared) continue;
        for (const body of c.reflections) lessons.push({ body, sourceEventName: c.source, why: `shared tag: ${shared}` });
      }
      return json({ lessons });
    }

    const client = new Anthropic({ apiKey });
    const userMsg =
      `NEW event: ${JSON.stringify({ name: (ev as any).name, format: (ev as any).format, tags: myTags })}\n\n` +
      `CANDIDATE sources:\n${JSON.stringify(candidates, null, 2)}`;
    const resp = await (client.messages.create as any)({
      model: "claude-haiku-4-5",
      max_tokens: 2048,
      system: SYSTEM,
      messages: [{ role: "user", content: userMsg }],
      output_config: { format: { type: "json_schema", schema: SCHEMA } },
    });
    const textBlock = (resp.content as any[]).find((b) => b.type === "text");
    const claudeLessons: { body: string; sourceEventName: string; why: string }[] =
      textBlock ? (JSON.parse(textBlock.text).lessons ?? []) : [];
    // Guarantee the linked event's lessons are carried, even if Claude judged them
    // a weak thematic match — they were explicitly chosen as the starting point.
    const seen = new Set(claudeLessons.map((l) => l.body));
    return json({ lessons: [...linkedLessons.filter((l) => !seen.has(l.body)), ...claudeLessons] });
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
