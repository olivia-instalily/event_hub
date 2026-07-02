// Edge function: classify an inbound email / Linear note and match it to one of an
// event's vendor decisions or deliverables. Stands in for a HubSpot/Gmail poller or
// a Linear webhook — same matching logic, just fed text directly here.
//
// POST { eventId, text, source }  → DetectedUpdate
//   { kind: 'contract'|'complete'|'note', engagementId, deliverableId, matchedName, summary }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Anthropic from "npm:@anthropic-ai/sdk";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    kind: { type: "string", enum: ["contract", "complete", "status", "note"] },
    status: { type: "string", enum: ["Todo", "In Progress", "Done", ""], description: "target status when kind='status' (e.g. reopening → Todo, starting → In Progress); empty otherwise" },
    engagementId: { type: ["string", "null"], description: "matched engagement id, or null if no match" },
    deliverableId: { type: ["string", "null"], description: "matched deliverable id, or null if no match" },
    matchedName: { type: "string", description: "the vendor/category or task matched, or empty" },
    summary: { type: "string", description: "one-line activity summary" },
  },
  required: ["kind", "status", "engagementId", "deliverableId", "matchedName", "summary"],
};

const CONTRACT_RE = /\b(sign|signed|signing|countersign|executed|contract|agreement|sow|booked|confirm(ed)?)\b/i;
const DONE_RE = /\b(done|complete|completed|finished|closed|resolved|merged|shipped|wrapped)\b/i;
const STARTED_RE = /\b(in[\s-]?progress|started|starting|kick(ed)?[\s-]?off|working on|underway|wip|in flight)\b/i;
// Moving a task BACK / reopening / not-yet-started → Todo. Checked before DONE so "not done" wins.
const TODO_RE = /\b(to[\s-]?do|todo|backlog|not done|reopen|re-?open|undo|revert|unfinish(ed)?|incomplete|not started|put back|move(d)? back|back to)\b/i;

// Which status (if any) is this note asking for? Todo/In-Progress checked before Done.
function detectStatus(text: string): "Todo" | "In Progress" | "Done" | null {
  if (TODO_RE.test(text)) return "Todo";
  if (STARTED_RE.test(text)) return "In Progress";
  if (DONE_RE.test(text)) return "Done";
  return null;
}

// Domain helpers — mirror of src/lib/url.ts (edge runtime can't import app code).
const FREE_MAIL = new Set(["gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "yahoo.com", "icloud.com", "me.com", "aol.com", "proton.me", "protonmail.com"]);
function domainFromUrl(raw: string | null): string | null {
  if (!raw) return null;
  const s = raw.trim(); if (!s) return null;
  try { return new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`).hostname.toLowerCase().replace(/^www\./, "") || null; } catch { return null; }
}
function emailDomain(email: string | null): string | null {
  const m = (email ?? "").trim().toLowerCase().match(/@([^@\s>]+)/); return m ? m[1] : null;
}
function domainsMatch(a: string | null, b: string | null): boolean {
  if (!a || !b) return false; const x = a.toLowerCase(), y = b.toLowerCase();
  if (FREE_MAIL.has(x) || FREE_MAIL.has(y)) return false;
  return x === y || x.endsWith(`.${y}`) || y.endsWith(`.${x}`);
}

type Eng = { id: string; category: string | null; stage: string | null; names: string[]; domains: string[] };
type Del = { id: string; title: string; status: string | null };

function heuristic(text: string, source: string, from: string | null, engs: Eng[], dels: Del[]) {
  const t = text.toLowerCase();
  const has = (name: string) => name && t.includes(name.toLowerCase());
  const senderDomain = emailDomain(from);
  // Which vendor is this from? Domain match (any address @ the vendor's domain) wins;
  // fall back to the vendor name appearing in the text.
  const byDomain = senderDomain ? (engs.find((e) => e.domains.some((d) => domainsMatch(d, senderDomain)))) : undefined;
  const byName = engs.find((e) => [e.category ?? "", ...e.names].some(has));
  const vendor = byDomain ?? byName;

  const target = detectStatus(text);

  // A contract signing for a known vendor (only when it's not really a task status change).
  if (CONTRACT_RE.test(text) && vendor && target !== "Todo" && target !== "In Progress") {
    const name = vendor.names[0] ?? vendor.category ?? "vendor";
    return { kind: "contract", status: "", engagementId: vendor.id, deliverableId: null, matchedName: name, summary: `Signed contract detected via ${source} — ${vendor.category ?? name} → Contracted` };
  }

  // A deliverable status change (Done / In Progress / Todo-reopen).
  if (target) {
    const d = dels.find((d) => {
      const words = d.title.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
      return t.includes(d.title.toLowerCase()) || words.filter((w) => t.includes(w)).length >= Math.max(1, Math.ceil(words.length / 2));
    });
    if (d) {
      if (target === "Done") return { kind: "complete", status: "", engagementId: null, deliverableId: d.id, matchedName: d.title, summary: `"${d.title}" moved to completed via ${source}` };
      return { kind: "status", status: target, engagementId: null, deliverableId: d.id, matchedName: d.title, summary: `"${d.title}" → ${target} via ${source}` };
    }
  }

  // Otherwise: if it's from a known vendor domain, file it as correspondence on that decision.
  if (vendor) {
    const name = vendor.names[0] ?? vendor.category ?? "vendor";
    return { kind: "note", status: "", engagementId: vendor.id, deliverableId: null, matchedName: name, summary: `${source[0].toUpperCase()}${source.slice(1)} from ${vendor.category ?? name}: ${text.slice(0, 70)}${text.length > 70 ? "…" : ""}` };
  }
  return { kind: "note", status: "", engagementId: null, deliverableId: null, matchedName: "", summary: `${source[0].toUpperCase()}${source.slice(1)} note: ${text.slice(0, 80)}${text.length > 80 ? "…" : ""}` };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  try {
    const { eventId, text, source = "email", from = null } = await req.json();
    if (!eventId || !text?.trim()) return json({ error: "eventId and text are required" }, 400);

    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const [{ data: engRows }, { data: delRows }] = await Promise.all([
      sb.from("engagement").select("id, category, stage, candidates:engagement_candidate ( vendor_name, link )").eq("event_id", eventId),
      sb.from("deliverable").select("id, title, status").eq("event_id", eventId),
    ]);
    const engs: Eng[] = (engRows ?? []).map((e: any) => ({
      id: e.id, category: e.category, stage: e.stage,
      names: (e.candidates ?? []).map((c: any) => c.vendor_name).filter(Boolean),
      domains: Array.from(new Set((e.candidates ?? []).map((c: any) => domainFromUrl(c.link)).filter(Boolean))) as string[],
    }));
    const dels: Del[] = (delRows ?? []).map((d: any) => ({ id: d.id, title: d.title, status: d.status }));

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) return json(heuristic(text, source, from, engs, dels));

    const client = new Anthropic({ apiKey });
    const senderDomain = emailDomain(from);
    const sys = `You triage an inbound ${source} note for an event-planning tool. Pick one kind:
- "contract": a vendor contract was signed — set engagementId to the matching decision.
- "complete": an action item is finished/done — set deliverableId to the matching task, status="Done".
- "status": an action item should move to a DIFFERENT status without being completed — set deliverableId and set status to "Todo" (reopen / move back / not started / undo) or "In Progress" (started / working on / kicked off).
- "note": just correspondence / nothing actionable.
Match the vendor primarily by SENDER DOMAIN against each engagement's "domains" (any address at that domain is the same vendor), then by name in the text. Match deliverables by title words appearing in the note. If it's a note but clearly from a known vendor's domain, still set engagementId so it files as that vendor's correspondence. Return null for engagementId/deliverableId when nothing matches; set status="" unless kind="status". Write a concise one-line summary.`;
    const payload = { note: text, senderDomain, engagements: engs, deliverables: dels };
    const resp = await (client.messages.create as any)({
      model: "claude-haiku-4-5", max_tokens: 1024, system: sys,
      messages: [{ role: "user", content: JSON.stringify(payload) }],
      output_config: { format: { type: "json_schema", schema: SCHEMA } },
    });
    const tb = (resp.content as any[]).find((b) => b.type === "text");
    if (!tb) return json(heuristic(text, source, from, engs, dels));
    const out = JSON.parse(tb.text);
    return json({ ...out, engagementId: out.engagementId || null, deliverableId: out.deliverableId || null, matchedName: out.matchedName || null, status: out.status || null });
  } catch (e) {
    console.error(JSON.stringify({ fn: "detect-update", error: String((e as Error)?.message ?? e) }));
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
