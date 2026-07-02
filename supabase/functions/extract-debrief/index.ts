// Edge function: extract a POST-EVENT DEBRIEF transcript into structured fields via Claude.
// Sibling to extract-brief — but a debrief is a DIFFERENT document: backward-looking, producing
// lessons (changes to make), follow-ups (actions), people who mattered (tags), an outcome
// (verdict), and budget actuals. It is NOT a brief; do not re-extract the event's standing
// guardrails/heuristics as if they were new.
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

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    eventName: { type: "string", description: "the event being debriefed if named; \"\" otherwise" },
    focus: { enum: ["hiring", "client", "community", "unclear"], description: "what the event was FOR, inferred from the transcript. 'community' when it's explicitly social/not-recruiting. Drives whether candidate tags are appropriate." },
    outcome: {
      type: "object",
      additionalProperties: false,
      properties: {
        verdict: { type: "string", description: "one-line overall verdict of how it went; \"\" if not stated" },
        worthRepeating: { enum: ["yes", "no", "unsure", null], description: "whether to run it again, if stated; null if not" },
        turnoutActual: { type: ["number", "null"], description: "actual people who showed, if a number is stated; else null" },
        turnoutNote: { type: "string", description: "turnout reconciliation vs expectation (e.g. '44 of 80 RSVPs, ~55% vs the ~25% rule'); \"\" if none" },
      },
      required: ["verdict", "worthRepeating", "turnoutActual", "turnoutNote"],
    },
    lessons: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          text: { type: "string", description: "the learning, as observed in the debrief (e.g. 'coffee ran out ~45 min in')" },
          proposedChange: { type: "string", description: "the concrete change to make next time (e.g. 'order coffee for 70% of checked-in, set up earlier'); \"\" if the debrief only observed without prescribing" },
          area: { type: "string", description: "which part of the playbook it touches (e.g. 'Run of show', 'Budget', 'Outreach', 'Catering'); \"\" if unclear" },
        },
        required: ["text", "proposedChange", "area"],
      },
      description: "NEW learnings/changes from this post-mortem — NOT the event's pre-existing guardrails or heuristics. A lesson is something to do differently next time. Empty if none.",
    },
    followUps: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          action: { type: "string", description: "the post-event action, imperative (e.g. 'Send thank-you + deck', 'Intro Priya to recruiting')" },
          owner: { type: "string", description: "who owns it (role or name) if stated; \"\" otherwise" },
          person: { type: "string", description: "the specific attendee this action concerns, if any; \"\" otherwise" },
          dueOffset: { type: ["number", "null"], description: "days after the event it's due, if stated; else null" },
        },
        required: ["action", "owner", "person", "dueOffset"],
      },
      description: "concrete post-event to-dos surfaced in the debrief. Empty if none.",
    },
    peopleTags: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string", description: "the person's name as said in the debrief" },
          lens: { enum: ["candidate", "prospect", "partner"], description: "why they matter: candidate=potential hire, prospect=potential client/ICP, partner=partnership" },
          note: { type: "string", description: "the short 'why', quote-ish from the debrief (e.g. 'ML eng, actively looking — strong')" },
          provenance: { type: "string", description: "where in the debrief this came from (e.g. 'debrief, said by Devan'); \"\" if not locatable" },
        },
        required: ["name", "lens", "note", "provenance"],
      },
      description: "specific people who stood out. CATEGORY-AWARE: respect the event's purpose — if focus is 'community' or the transcript says it's NOT a recruiting event, do NOT emit candidate tags; only tag someone when the debrief explicitly frames them that way. Empty if no one was singled out.",
    },
    actuals: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          line: { type: "string", description: "budget category/line the correction applies to (e.g. 'Catering', 'A/V')" },
          amount: { type: ["number", "null"], description: "the actual/corrected amount in dollars if stated; else null" },
          note: { type: "string", description: "context for the correction; \"\" if none" },
        },
        required: ["line", "amount", "note"],
      },
      description: "final budget corrections/actuals mentioned in the debrief. Empty if none.",
    },
  },
  required: ["eventName", "focus", "outcome", "lessons", "followUps", "peopleTags", "actuals"],
};

const SYSTEM = `You extract structured data from a POST-EVENT DEBRIEF transcript for InstaLILY's
internal event tool (EventHub). Output must match the provided JSON schema exactly. Extract only
what the transcript states; never invent.

A DEBRIEF is backward-looking. It is NOT a planning brief. Its content is: what happened, what to
change next time, who stood out, the verdict, and budget corrections. Do NOT re-extract the event's
standing guardrails or planning heuristics (e.g. "not a recruiting event", "~25% of RSVPs show up")
as if they were new findings — those already belong to the template. Only capture what THIS debrief
adds.

The fields, with the distinctions that matter:

LESSONS — NEW learnings and the change they imply. A lesson is something to DO DIFFERENTLY next
time, surfaced by the post-mortem.
  ✓ "AV check ran long → split the AV check into its own pre-event step"
  ✓ "coffee ran out ~45 min in → order for 70% of checked-in and set up earlier"
  ✗ NOT a restatement of an existing principle/heuristic the event already had. If the transcript
    merely repeats a known guardrail ("keep it casual") or a known ratio ("~25% show"), that is NOT
    a lesson — skip it unless the debrief proposes changing it.
  Put the observation in text and the prescription in proposedChange (proposedChange "" if the
  debrief only observed). area = which part of the playbook it touches.

FOLLOW-UPS — post-event actions someone must take. action (imperative) + owner (role/name if said)
+ person (a specific attendee, if the action is about them) + dueOffset (days after the event, null
if unstated). "Send thank-you and the deck", "Intro Priya to the recruiting team".

PEOPLE TAGS — specific people who were singled out as mattering, each with a lens
(candidate=potential hire, prospect=potential client/ICP, partner=partnership), a short note (the
"why", quote-ish), and provenance.
  CATEGORY-AWARENESS IS REQUIRED: look at focus. If the event is 'community' (explicitly social,
  "not a recruiting event"), do NOT emit candidate tags — a community run club is not a hiring
  funnel. Only tag a person with a lens the debrief actually frames them with. When in doubt, omit
  rather than force a tag. An empty peopleTags array is correct for a pure-community event where no
  one was singled out.

OUTCOME — verdict (one line on how it went), worthRepeating (yes/no/unsure/null), turnoutActual (a
number if stated), turnoutNote (reconciliation vs expectation, e.g. "44 of 80 RSVPs, ~55%").

ACTUALS — budget corrections stated in the debrief: line (category) + amount (dollars, null if not
stated) + note.

FOCUS — classify what the event was for from the transcript: hiring / client / community / unclear.
This gates peopleTags (see above).

Golden rule: classify by what a sentence IS in a retrospective (a change to make / an action / a
person who mattered / the verdict / a budget correction), not by keyword. Do not turn the event's
pre-existing setup into "lessons".

ABSENT VALUES (schema contract): for any STRING field not stated, return "" (NOT null). For NUMBER
fields not stated, return null. For the worthRepeating enum, null if not stated. Arrays default to
[]. Do not invent.`;

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
      max_tokens: 16000,
      system: SYSTEM,
      messages: [{ role: "user", content: `Debrief transcript:\n${text}` }],
      output_config: { format: { type: "json_schema", schema: SCHEMA } },
    });

    if (resp.stop_reason === "max_tokens") return json({ error: "Extraction truncated — raise max_tokens." }, 502);
    const textBlock = (resp.content as any[]).find((b) => b.type === "text");
    if (!textBlock) return json({ error: "No extraction returned." }, 502);
    let parsed: unknown;
    try { parsed = JSON.parse(textBlock.text); }
    catch { return json({ error: "Model returned invalid JSON.", raw: textBlock.text }, 502); }
    return json(parsed);
  } catch (e) {
    console.error(JSON.stringify({ fn: "extract-debrief", error: String((e as Error)?.message ?? e) }));
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
