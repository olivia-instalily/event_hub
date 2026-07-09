// DUAL-MAINTAINED: any changes here must also be made in
// supabase/functions/extract-brief/index.ts
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
    title:       { type: 'string', description: 'concise event name/title; "" if none' },
    owner:       { type: 'string', description: 'person named as owner/organizer; "" if none' },
    date:        { type: 'string', description: 'ISO YYYY-MM-DD if a specific date is stated; "" otherwise' },
    startTime:   { type: 'string', description: '24h HH:MM start time if stated; "" otherwise' },
    endTime:     { type: 'string', description: '24h HH:MM end time if stated; "" otherwise' },
    location:    { type: 'string', description: 'venue or city if stated; "" otherwise' },
    headcount:   { type: ['number', 'null'], description: 'expected number of attendees if stated, else null' },
    audience:    { type: 'string', description: "who the event is for (e.g. 'AI engineers'); \"\" if none" },
    format:      { type: 'string', description: "the single closest COMMON format category, 1-2 words (e.g. 'Run', 'Happy hour', 'Fireside chat', 'Dinner', 'Workshop', 'Hackathon', 'Summit'). Do NOT compound it with sub-activities — 'a slow run then coffee' is 'Run', not 'Run + coffee'. \"\" if none." },
    tag:         { enum: [...TAGS, null], description: 'exactly one taxonomy tag from the allowed list (these map to a funding category), or null if genuinely unclear' },
    specificity: { enum: ['event', 'template'], description: "'event' if the brief describes a concrete instance with a specific date; 'template' if it's a reusable how-to/pattern with open slots and no fixed date." },
    overview:    { type: 'string', description: "1-3 sentences capturing what the event IS and its goal/intent — the substantive description, NOT meta lines like 'this is a guide for...'. Pull the real purpose." },
    guardrails:  { type: 'array', items: { type: 'string' }, description: "explicit principles/constraints/values stated (e.g. 'not a recruiting event', 'keep it casual'). Each a short standalone statement. Empty if none." },
    heuristics:  { type: 'array', items: { type: 'string' }, description: "stated rules-of-thumb / planning ratios (e.g. '~25% of RSVPs show up', 'order giveaways for 30-40% of RSVPs', 'budget ~$40/head'). Verbatim-ish, each standalone. Empty if none." },
    phases:      { type: 'array', items: { type: 'string' }, description: "ordered planning phase names drawn from the brief's sections (e.g. 'Plan it', 'Day-of', 'Wrap up'). Empty if none." },
    deliverables: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          title:       { type: 'string', description: "a DEFINITE action item — an imperative task ('Book a coffee spot', 'Send the invite'), NOT a descriptive sentence. In TEMPLATE MODE this is the GENERALIZED form (names/clients/specific case studies stripped)." },
          phase:       { type: 'string', description: 'which phase name this belongs to; "" if unphased. In TEMPLATE MODE assign by the task\'s FUNCTION (never dump everything in one phase).' },
          offsetStart: { type: ['number', 'null'], description: 'day offset relative to event day if a timing is stated (negative=before, 0=day-of, positive=after), else null' },
          offsetEnd:   { type: ['number', 'null'], description: 'end of an offset range, else null' },
          original:    { type: 'string', description: 'TEMPLATE MODE ONLY: the ORIGINAL task text, when you generalized it (stripped a person/client/partner name or a specific case study). "" if unchanged, or for a concrete event.' },
        },
        required: ['title', 'phase', 'offsetStart', 'offsetEnd', 'original'],
      },
      description: 'every concrete to-do in the brief, especially from a plan/checklist section, WHETHER OR NOT it has a stated time.',
    },
    droppedForTemplate: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          title: { type: 'string', description: 'the task that was removed' },
          reason: { type: 'string', description: "why it's too event-specific to keep in a reusable template" },
        },
        required: ['title', 'reason'],
      },
      description: 'TEMPLATE MODE ONLY: tasks removed because, once names are stripped, only a one-off remains (no reusable form). Empty for a concrete event.',
    },
    vendors:     { type: 'array', items: { type: 'string' }, description: "vendor/venue categories implied (e.g. 'Coffee & pastries', 'Venue'). Empty if none." },
    staff:       { type: 'array', items: { type: 'string' }, description: "staffing ROLES needed (the role, never a person's name). Empty if none." },
    agenda: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: { time: { type: 'string' }, title: { type: 'string' } },
        required: ['time', 'title'],
      },
      description: 'run-of-show: time + activity rows if the brief gives a schedule. Empty if none.',
    },
    walkthrough: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          title:        { type: 'string', description: 'the step, as a short imperative or statement' },
          rationale:    { type: 'string', description: 'WHY this step matters — the reasoning/prose from the brief; "" if the brief gives none.' },
          phase:        { type: 'string', description: 'which phase name this step belongs under; "" if unphased' },
          linkedKind:   { enum: ['deliverable', 'role', null], description: 'if this step corresponds to a generated deliverable or a staffing role, which kind; else null' },
          linkedLabel:  { type: 'string', description: 'the linked item\'s label (e.g. the deliverable title or role name); "" if not linked' },
          isCallout:    { type: 'boolean', description: 'true if this step is a heuristic / rule-of-thumb worth highlighting (e.g. a show-rate or sizing rule)' },
        },
        required: ['title', 'rationale', 'phase', 'linkedKind', 'linkedLabel', 'isCallout'],
      },
      description: 'the brief told AS A NARRATIVE WITH REASONING, ordered, grouped by phase. Preserve the prose and the why — do NOT flatten to bare checkboxes. One step per meaningful move; mark heuristic/rule steps isCallout=true. Empty only if the brief is purely a flat list.',
    },
    outreach: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          title: { type: 'string', description: "name of the template (e.g. 'Slack invite', 'Personal DM')" },
          whenToUse: { type: 'string', description: 'when to send it' },
          body: { type: 'string', description: 'the message copy, preserving any [bracket] merge fields verbatim' },
        },
        required: ['title', 'whenToUse', 'body'],
      },
      description: 'any reusable outreach/invite copy in the brief (Slack posts, DMs, emails), with [bracket] merge fields kept verbatim. Empty if none.',
    },
    budgetTotal: { type: ['number', 'null'], description: 'total budget in USD if stated, else null' },
  },
  required: ['title','owner','date','startTime','endTime','location','headcount','audience','format','tag','specificity','overview','guardrails','heuristics','phases','deliverables','droppedForTemplate','vendors','staff','agenda','walkthrough','outreach','budgetTotal'],
};

const SYSTEM = `You extract structured planning data from an event brief for InstaLILY's internal
event tool (EventHub). Output must match the provided JSON schema exactly. Extract
only what the brief states; never invent.

A brief sits somewhere on a spectrum from a fully-specified single event to a reusable
playbook with blanks. Extract the STRUCTURE either way; where a value is a blank,
placeholder, or [bracket] (e.g. "[route]", "weekend morning", "~2 weeks out"), treat
that field as absent but still extract the surrounding structure. Set specificity to
"event" if a concrete date is present, else "template".

The hard parts, with the distinctions that matter:

OVERVIEW — capture what the event IS and WHY it exists (its format + goal), in 1–3
sentences pulled from the substantive content.
  ✓ "A small group of AI builders meets for a slow social run, then coffee. The goal
     is community, not lead-gen."
  ✗ Do NOT use meta/boilerplate: "This is a step-by-step guide for running…", "This
     doc captures everything you need." Skip those entirely.

DELIVERABLES — DEFINITE ACTION ITEMS only: concrete tasks someone performs, in
imperative voice. Extract EVERY task from any plan / checklist / "how to" section,
WHETHER OR NOT a time is given (offsets null when no timing stated). One task per item;
split compound sentences into separate tasks.
  ✓ "Post the event on Luma", "Test-run the route", "Recruit 3 pace leads"
  ✗ NOT descriptive prose: "The run is slow and conversational" is a guardrail, not a
     task. NOT a goal: "build community" is overview, not a task.
  Never drop a real task because it lacks a date; never promote a description into a task.

OFFSETS — a task's timing relative to event day (negative=before, 0=day-of,
positive=after), in DAYS. "2 weeks before" → offsetStart -14. A span ("outreach across
the two weeks") → offsetStart -14, offsetEnd -1. A point → offsetStart set, offsetEnd
null. No stated timing → both null (still extract the task).

PHASES — name them from the brief's OWN section structure (e.g. "Plan it", "Get people
there", "Run of show", "Say thanks", "Measure turnout"), in order. Do not impose a
generic Planning/Day-of/Wrap scheme if the brief uses its own. Assign each deliverable
to its phase by where it appears.

TEMPLATE MODE — applies when you set specificity="template" (a reusable pattern), OR when the
request forces it (see FORCED TEMPLATE MODE, if present, at the end of these instructions). When
NEITHER holds (a plain specificity="event" create), DO NOT do any of this: keep person names, client
and partner names, and specific case studies EXACTLY as written — they're correct for a real event.
When template mode is active, run TWO passes over the deliverables:

  PASS 1 — PHASE ASSIGNMENT. Place each deliverable in the phase it belongs to BY FUNCTION; never
  dump everything into one bucket like "Planning & coordination". Prefer the brief's own phase names;
  if it has none, use functional buckets, e.g. for a co-hosted briefing:
    • Setup & check-in — room/AV/bar setup, signage display, security/guest-list handoff, check-in
    • Briefing & presentations — the content segments: case studies, demos, roundtable
    • Social — post-event reception / rooftop / dinner
    • Planning & coordination — GENUINE pre-event prep ONLY (finalize agenda, prep deck, print signage)
  Assign by what the task DOES: "Set up AV for live demos" → Setup; "Run a case study with live demo"
  → Briefing & presentations; "Serve rooftop pizza + drinks" → Social; only finalize/confirm/print/
  assign prep stays in Planning & coordination. If you truly can't place one, put it in the closest
  functional bucket — do not blanket-default.

  PASS 2 — GENERALIZE. Transform each deliverable toward its most general REUSABLE form, and set
  its "original" field to the pre-edit text whenever you change it:
    1. Strip PERSON names → make it a role. "Set up check-in with Ayushi" → "Set up check-in station
       (designated check-in lead)"; add "Check-in lead" to staff. The person leaves the task text; the
       ROLE is captured in staff.
    2. Strip CLIENT / PARTNER / COMPANY proper nouns → the type. InstaLILY is the HOST org → "host"
       / "our"; any OTHER named company (the co-host, the account being presented) → "client" (or
       "partner" when it's clearly the co-host). Examples:
         "Present Bain-covered content segment" → "Present the client-covered content segment"
         "Give overview on Harrington, Radwell" → "Give the client overview"
         "InstaLILY presentation, then Bain presentation" → "Host presentation, then client presentation"
         "Deliver MDM playbook + Harrington overview" → "Deliver the partner's playbook rollout + client overview"
         "Design InstaLILY × Bain co-branded signage" → "Design co-branded signage (host × partner)"
       Keep the STRUCTURE, drop every company name. NO real company name (InstaLILY, Bain, Harrington,
       Radwell, SRS, …) may remain in a template deliverable.
    3. Generalize a SPECIFIC case study → its reusable slot. "Run SRS sales case study with live demo"
       → "Run a sales case study with live demo"; "Run Radwell Quote-to-Order case study" → "Run an
       operations/supply-chain case study with demo". Capture "~2-3 themed case studies with demos",
       not the accounts.
    4. DROP if only meaningful for this one event. After stripping names, is a reusable task left, or
       just a one-off? Reusable decisions stay ("Confirm whether photos are public or internal"); a
       venue/date-specific quirk with no general form goes to droppedForTemplate with a short reason.
       Bias: if generalizing leaves a vague/empty task, DROP it — a hollow template line is the failure
       mode, a missing one is recoverable.
  DO NOT strip generic proper nouns that are tools/categories (Slack, Luma, AV, HR) — only people,
  clients, partners, and specific products/accounts. DO NOT over-strip: keep tasks actionable ("Run a
  sales case study with live demo" is right; "Present something" is over-stripped). When unsure whether
  a term is client-specific, prefer keep-but-generalize ("the partner's playbook") over drop.

GUARDRAILS — only EXPLICIT stated principles/constraints/values, each a short standalone
statement.
  ✓ "Not a recruiting event", "Keep the pace conversational, not a race"
  ✗ Not generic prose or anything you inferred.

HEURISTICS — capture stated planning rules-of-thumb verbatim-ish as short statements
(e.g. "~25% of RSVPs show up", "budget giveaways at 30–40% of RSVPs").

TAG — exactly one from the allowed enum that best fits; null only if genuinely ambiguous.

STAFF — the ROLE only, never a person's name. "Recruit 3 pace leads" → staff: ["Pace
lead"] (×3 captured in the deliverable).

VENDORS / AGENDA / BUDGET — vendor/venue CATEGORIES (not named vendors unless the brief
specifies one); agenda only if a run-of-show schedule is given; budgetTotal only if a
total is stated (a per-line breakdown goes to deliverables/vendors, not here).

WALKTHROUGH — retell the brief as an ORDERED, PHASED NARRATIVE that keeps the reasoning.
Each step has a title and, where the brief explains why, a rationale. Group steps by phase.
When a step maps to a concrete task set linkedKind="deliverable" and linkedLabel to its
title; when it maps to a staffing role set linkedKind="role". Mark rule-of-thumb/heuristic
steps isCallout=true. The narrative face of the brief — do not reduce it to a checklist.

OUTREACH — pull any invite/outreach copy (Slack posts, DMs, emails) with [bracket] merge
fields kept exactly.

Golden rule: extract by what a sentence IS (task / goal / principle / role / schedule /
heuristic / narrative), not by section heading or keyword. The same content can appear
anywhere in any format — classify on meaning.

ABSENT VALUES (schema contract): for any STRING field the brief doesn't state — or that's
only a blank, placeholder, or [bracket] — return an empty string "" (NOT null). For NUMBER
fields not stated, return null. Arrays default to []. Do not invent.`;

export async function handler(req: Request, res: Response) {
  try {
    const { text, templateMode } = req.body;
    if (!text || !String(text).trim()) { res.status(400).json({ error: 'text is required' }); return; }
    const forceTemplate = !!templateMode; // caller (e.g. backfill → template) wants generalization even for a dated event

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) { res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured on the server.' }); return; }

    const system = forceTemplate
      ? SYSTEM + `\n\nFORCED TEMPLATE MODE: this brief is being turned into a REUSABLE template.
Run BOTH template passes on every deliverable REGARDLESS of the specificity you assign — assign each
to its phase by function (never all under one bucket), generalize away EVERY person and company name
(host = "our"/"host"; any other company = "client"/"partner"; specific case studies → the reusable
slot), set "original" whenever you change a task, and move un-generalizable one-offs to
droppedForTemplate. No real name may survive in a deliverable.`
      : SYSTEM;

    const client = new Anthropic({ apiKey });
    const resp = await (client.messages.create as any)({
      model: 'claude-haiku-4-5',
      max_tokens: 16000,
      system,
      messages: [{ role: 'user', content: `Event brief:\n${text}` }],
      output_config: { format: { type: 'json_schema', schema: SCHEMA } },
    });

    if (resp.stop_reason === 'max_tokens') { res.status(502).json({ error: 'Extraction truncated — raise max_tokens.' }); return; }
    const textBlock = (resp.content as any[]).find((b: any) => b.type === 'text');
    if (!textBlock) { res.status(502).json({ error: 'No extraction returned.' }); return; }
    let parsed: any;
    try { parsed = JSON.parse(textBlock.text); } catch { res.status(502).json({ error: 'Model returned invalid JSON.', raw: textBlock.text }); return; }

    // Deterministic backstop (templates only): strip an obvious trailing person reference the model
    // may have left on a deliverable ("… with Ayushi", "(w/ Sam)"). Conservative — single capitalized
    // token, not a known tool/category. Primary generalization is prompt-side; this is a net.
    if ((parsed?.specificity === 'template' || forceTemplate) && Array.isArray(parsed.deliverables)) {
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
