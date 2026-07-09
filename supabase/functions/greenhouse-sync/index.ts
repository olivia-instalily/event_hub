// DUAL-MAINTAINED: any changes here must also be made in
// cloud-functions/src/functions/greenhouse-sync.ts
// Edge function: read-back a THIN application-status flag from Greenhouse, matched by email.
// READ-ONLY against Greenhouse (read-scoped Harvest key, server-side) — never writes there,
// and returns only a collapsed status enum, never applications/stages/notes.
//
// POST { emails: string[] } → { configured: boolean, matches: [{ email, candidateId, status }] }
//   status ∈ "applied" | "in_pipeline" | "hired" | "none"
//
// Harvest API (verify against current docs before relying in prod):
//   GET https://harvest.greenhouse.io/v1/candidates?email=<email>  (exact-email lookup)
//   Auth: HTTP Basic — username = API key, blank password → base64("<key>:")
// Rate limit ~50 req / 10s; we lookup sequentially (this is a sync job, not per-render).

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

type Status = "applied" | "in_pipeline" | "hired" | "none";
// Collapse a candidate's applications to the single display flag. Never keep the applications.
function deriveStatus(candidate: any): Status {
  const apps: any[] = Array.isArray(candidate?.applications) ? candidate.applications : [];
  if (apps.length === 0) return "none";
  const s = (a: any) => String(a?.status ?? "").toLowerCase();
  if (apps.some((a) => s(a) === "hired" || s(a) === "converted")) return "hired";
  if (apps.some((a) => s(a) === "active")) return "in_pipeline";
  return "applied"; // has an application, but none active/hired (e.g. applied-but-not-advanced)
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  try {
    const { emails } = await req.json();
    const list: string[] = Array.isArray(emails) ? emails.map((e) => String(e).trim().toLowerCase()).filter(Boolean) : [];
    if (list.length === 0) return json({ configured: true, matches: [] });

    const apiKey = Deno.env.get("GREENHOUSE_API_KEY");
    if (!apiKey) return json({ error: "not configured", configured: false, matches: [] });

    const auth = "Basic " + btoa(`${apiKey}:`);
    const matches: { email: string; candidateId: string; status: Status }[] = [];
    const unique = Array.from(new Set(list)).slice(0, 300); // safety cap on a single sync

    for (const email of unique) {
      try {
        const r = await fetch(`https://harvest.greenhouse.io/v1/candidates?email=${encodeURIComponent(email)}`, {
          headers: { Authorization: auth, "Content-Type": "application/json" },
        });
        if (r.status === 401 || r.status === 403) return json({ error: "Greenhouse auth failed — check the read-scoped Harvest key.", configured: false, matches: [] });
        if (r.status === 429) { await new Promise((res) => setTimeout(res, 1200)); continue; } // backoff; skip this round
        if (!r.ok) continue;
        const cands = await r.json();
        const c = Array.isArray(cands) ? cands[0] : null;
        if (c?.id != null) matches.push({ email, candidateId: String(c.id), status: deriveStatus(c) });
      } catch { /* skip this email; the rest still sync */ }
    }
    return json({ configured: true, matches });
  } catch (e) {
    console.error(JSON.stringify({ fn: "greenhouse-sync", error: String((e as Error)?.message ?? e) }));
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
