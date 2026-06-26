// Edge function: extract a dropped event brief into structured fields via Claude.
// Runs server-side so ANTHROPIC_API_KEY never reaches the browser. The client falls
// back to its local regex parser if this fails or isn't configured.
//
// POST { text: string }  → see SCHEMA below.

import Anthropic from "npm:@anthropic-ai/sdk";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const TAGS = [
  "Client summit", "Brand & community event", "Co-hosted partner event", "Hackathon",
  "Sponsorship", "Internal team social", "Company milestone",
];

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: "string", description: "concise event name/title; \"\" if none" },
    owner: { type: "string", description: "person named as owner/organizer; \"\" if none" },
    date: { type: "string", description: "ISO YYYY-MM-DD if a specific date is stated; \"\" otherwise" },
    startTime: { type: "string", description: "24h HH:MM start time if stated; \"\" otherwise" },
    endTime: { type: "string", description: "24h HH:MM end time if stated; \"\" otherwise" },
    location: { type: "string", description: "venue or city if stated; \"\" otherwise" },
    headcount: { type: ["number", "null"], description: "expected number of attendees if stated, else null" },
    audience: { type: "string", description: "who the event is for (e.g. 'AI engineers'); \"\" if none" },
    format: { type: "string", description: "the single closest COMMON format category, 1-2 words (e.g. 'Run', 'Happy hour', 'Fireside chat', 'Dinner', 'Workshop', 'Hackathon', 'Summit'). Do NOT compound it with sub-activities — 'a slow run then coffee' is 'Run', not 'Run + coffee'. \"\" if none." },
    tag: { enum: [...TAGS, null], description: "exactly one taxonomy tag from the allowed list (these map to a funding category), or null if genuinely unclear" },
    specificity: { enum: ["event", "template"], description: "'event' if the brief describes a concrete instance with a specific date; 'template' if it's a reusable how-to/pattern with open slots and no fixed date." },
    overview: { type: "string", description: "1-3 sentences capturing what the event IS and its goal/intent — the substantive description, NOT meta lines like 'this is a guide for...'. Pull the real purpose." },
    guardrails: { type: "array", items: { type: "string" }, description: "explicit principles/constraints/values stated (e.g. 'not a recruiting event', 'keep it casual'). Each a short standalone statement. Empty if none." },
    heuristics: { type: "array", items: { type: "string" }, description: "stated rules-of-thumb / planning ratios (e.g. '~25% of RSVPs show up', 'order giveaways for 30-40% of RSVPs', 'budget ~$40/head'). Verbatim-ish, each standalone. Empty if none." },
    phases: { type: "array", items: { type: "string" }, description: "ordered planning phase names drawn from the brief's sections (e.g. 'Plan it', 'Day-of', 'Wrap up'). Empty if none." },
    deliverables: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string", description: "a DEFINITE action item — an imperative task ('Book a coffee spot', 'Send the invite'), NOT a descriptive sentence" },
          phase: { type: "string", description: "which phase name this belongs to; \"\" if unphased" },
          offsetStart: { type: ["number", "null"], description: "day offset relative to event day if a timing is stated (negative=before, 0=day-of, positive=after), else null" },
          offsetEnd: { type: ["number", "null"], description: "end of an offset range, else null" },
        },
        required: ["title", "phase", "offsetStart", "offsetEnd"],
      },
      description: "every concrete to-do in the brief, especially from a plan/checklist section, WHETHER OR NOT it has a stated time.",
    },
    vendors: { type: "array", items: { type: "string" }, description: "vendor/venue categories implied (e.g. 'Coffee & pastries', 'Venue'). Empty if none." },
    staff: { type: "array", items: { type: "string" }, description: "staffing ROLES needed (the role, never a person's name). Empty if none." },
    agenda: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: { time: { type: "string" }, title: { type: "string" } },
        required: ["time", "title"],
      },
      description: "run-of-show: time + activity rows if the brief gives a schedule. Empty if none.",
    },
    walkthrough: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string", description: "the step, as a short imperative or statement" },
          rationale: { type: "string", description: "WHY this step matters — the reasoning/prose from the brief; \"\" if the brief gives none." },
          phase: { type: "string", description: "which phase name this step belongs under; \"\" if unphased" },
          linkedKind: { enum: ["deliverable", "role", null], description: "if this step corresponds to a generated deliverable or a staffing role, which kind; else null" },
          linkedLabel: { type: "string", description: "the linked item's label (e.g. the deliverable title or role name); \"\" if not linked" },
          isCallout: { type: "boolean", description: "true if this step is a heuristic / rule-of-thumb worth highlighting (e.g. a show-rate or sizing rule)" },
        },
        required: ["title", "rationale", "phase", "linkedKind", "linkedLabel", "isCallout"],
      },
      description: "the brief told AS A NARRATIVE WITH REASONING, ordered, grouped by phase. Preserve the prose and the why — do NOT flatten to bare checkboxes. One step per meaningful move; mark heuristic/rule steps isCallout=true. Empty only if the brief is purely a flat list.",
    },
    outreach: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string", description: "name of the template (e.g. 'Slack invite', 'Personal DM')" },
          whenToUse: { type: "string", description: "when to send it" },
          body: { type: "string", description: "the message copy, preserving any [bracket] merge fields verbatim" },
        },
        required: ["title", "whenToUse", "body"],
      },
      description: "any reusable outreach/invite copy in the brief (Slack posts, DMs, emails), with [bracket] merge fields kept verbatim. Empty if none.",
    },
    budgetTotal: { type: ["number", "null"], description: "total budget in USD if stated, else null" },
  },
  required: ["title", "owner", "date", "startTime", "endTime", "location", "headcount", "audience", "format", "tag", "specificity", "overview", "guardrails", "heuristics", "phases", "deliverables", "vendors", "staff", "agenda", "walkthrough", "outreach", "budgetTotal"],
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  try {
    const { text } = await req.json();
    if (!text || !String(text).trim()) return json({ error: "text is required" }, 400);

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) return json({ error: "ANTHROPIC_API_KEY not configured on the server." }, 500);

    const client = new Anthropic({ apiKey });
    const resp = await (client.messages.create as any)({
      model: "claude-haiku-4-5",
      // Rich briefs (walkthrough + verbatim outreach bodies + every deliverable) blow past
      // a few thousand tokens; too low truncates the JSON mid-stream → parse fails → silent
      // regex fallback. Keep generous headroom.
      max_tokens: 16000,
      system: SYSTEM,
      messages: [{ role: "user", content: `Event brief:\n${text}` }],
      output_config: { format: { type: "json_schema", schema: SCHEMA } },
    });

    // Surface truncation instead of silently degrading to the client's regex parser.
    if (resp.stop_reason === "max_tokens") return json({ error: "Extraction truncated — raise max_tokens." }, 502);

    const textBlock = (resp.content as any[]).find((b) => b.type === "text");
    if (!textBlock) return json({ error: "No extraction returned." }, 502);
    let parsed: unknown;
    try { parsed = JSON.parse(textBlock.text); }
    catch { return json({ error: "Model returned invalid JSON.", raw: textBlock.text }, 502); }
    return json(parsed);
  } catch (e) {
    // Log the full exception — a schema-complexity 400 from the API would otherwise be
    // swallowed into a generic 500 and read as a silent fallback.
    console.error("extract-brief failed:", e);
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
