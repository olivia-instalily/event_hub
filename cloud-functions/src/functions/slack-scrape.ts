// cloud-functions/src/functions/slack-scrape.ts
// Scrape-on-open: POST /functions/v1/slack-scrape { eventId }. Pulls the event's linked channel
// messages SINCE the last-extracted marker, extracts event facts, stores them idempotently (sticky —
// never resurrects dismissed/confirmed captures), and advances the marker. Runs the work INSIDE the
// request (no detached promise) so Cloud Run keeps the instance alive until it completes (freeze-safe).
import { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { getServiceClient } from '../db.js';
import { fetchSince, getPermalink } from '../lib/slack-api.js';
import { extractScrape } from './slack-extract.js';
import { buildScrapeCaptures, matchRemovals, matchPeople, candidateNote, buildPeopleNoMatch } from './slack-capture-lib.js';

export async function handler(req: Request, res: Response) {
  const eventId = String(req.body?.eventId ?? '');
  if (!eventId) { res.status(400).json({ error: 'eventId required' }); return; }
  const sb = getServiceClient();

  const { data: ev } = await sb.from('event').select('id, slack_channel, slack_last_extracted_ts').eq('id', eventId).maybeSingle();
  const channel = (ev as any)?.slack_channel as string | null;
  if (!ev || !channel) { res.json({ ok: true, skipped: 'no linked channel' }); return; }
  const marker = ((ev as any).slack_last_extracted_ts as string | null) ?? null;

  const msgs = await fetchSince(channel, marker);
  if (msgs.length === 0) { res.json({ ok: true, skipped: 'nothing new' }); return; }

  const { captures, people, removals } = await extractScrape(msgs);

  // Resolve a Slack permalink per unique source ts once (captures + people share the map) — the client
  // uses it to link a card / an existing-record icon back to the exact message.
  const permalinks: Record<string, string | null> = {};
  for (const ts of new Set([...captures.map((c) => c.sourceTs), ...people.map((p) => p.sourceTs)])) {
    permalinks[ts] = await getPermalink(channel, ts);
  }

  const caps = buildScrapeCaptures({ id: eventId }, channel, captures, permalinks);

  // Sticky: don't resurrect (or revert) a capture the user already dismissed/confirmed for the same
  // source message — re-scraping the same messages must not undo their decisions.
  let stored = 0;
  if (caps.length) {
    const ids = caps.map((c) => c.id);
    const { data: existing } = await sb.from('slack_capture').select('id, status').in('id', ids);
    const handled = new Set((existing ?? []).filter((r: any) => r.status === 'dismissed' || r.status === 'confirmed').map((r: any) => r.id));
    const toStore = caps.filter((c) => !handled.has(c.id));
    if (toStore.length) { await sb.from('slack_capture').upsert(toStore, { onConflict: 'id' }); stored = toStore.length; }
  }

  // People met/discussed → the People list. Clear name-match: auto-tag `candidate` + leave a comment
  // quoting the message and linking it. No match: a 'people' capture the People page surfaces for
  // "add anyway / dismiss". Marker gating means each mention is processed once (idempotent).
  let tagged = 0, noMatch = 0;
  if (people.length) {
    const { data: attendees } = await sb.from('attendee').select('id, name');
    const { matched, unmatched } = matchPeople(people, (attendees ?? []) as { id: string; name: string }[]);

    for (const { person, attendeeId } of matched) {
      // Skip if already tagged candidate for this event — don't stack duplicate tags/comments on re-scrape.
      const { data: prior } = await sb.from('person_tag').select('id')
        .eq('attendee_id', attendeeId).eq('event_id', eventId).eq('lens', 'candidate').maybeSingle();
      if (prior) continue;
      const permalink = permalinks[person.sourceTs] ?? null;
      await sb.from('person_tag').insert({
        id: `ptag-${randomUUID()}`, attendee_id: attendeeId, event_id: eventId, lens: 'candidate',
        note: person.note || null, source: 'slack', source_ref: permalink, status: 'confirmed',
      });
      await sb.from('attendee_note').insert({ id: `note-${randomUUID()}`, attendee_id: attendeeId, body: candidateNote(person, permalink) });
      tagged++;
    }

    const peopleCaps = buildPeopleNoMatch({ id: eventId }, channel, unmatched, permalinks);
    if (peopleCaps.length) {
      const ids = peopleCaps.map((c) => c.id);
      const { data: existing } = await sb.from('slack_capture').select('id, status').in('id', ids);
      const handled = new Set((existing ?? []).filter((r: any) => r.status !== 'proposed').map((r: any) => r.id));
      const toStore = peopleCaps.filter((c) => !handled.has(c.id));
      if (toStore.length) { await sb.from('slack_capture').upsert(toStore, { onConflict: 'id' }); noMatch = toStore.length; }
    }
  }

  // Removals: fuzzy-match dropped things against this event's live proposed captures → dismiss.
  let dismissed = 0;
  if (removals.length) {
    const { data: live } = await sb.from('slack_capture').select('id, summary').eq('event_id', eventId).eq('status', 'proposed');
    const rmIds = matchRemovals((live ?? []) as { id: string; summary: string }[], removals);
    if (rmIds.length) { await sb.from('slack_capture').update({ status: 'dismissed' }).in('id', rmIds); dismissed = rmIds.length; }
  }

  // Advance the marker to the newest message processed (msgs are chronological).
  const latestTs = msgs[msgs.length - 1].ts;
  await sb.from('event').update({ slack_last_extracted_ts: latestTs }).eq('id', eventId);

  console.log(JSON.stringify({ fn: 'slack-scrape', eventId, processed: msgs.length, extracted: captures.length, stored, tagged, noMatch, dismissed }));
  res.json({ ok: true, processed: msgs.length, stored, tagged, noMatch, dismissed });
}
