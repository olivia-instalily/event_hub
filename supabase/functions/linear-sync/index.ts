// Edge function: mirror one EventHub event + its deliverables into Linear.
//
//   EventHub team  →  a single Linear Team ("EventHub")
//   event          →  a Linear Project in that team
//   deliverable    →  a Linear Issue in that project
//
// Idempotent: events store linear_project_id, deliverables store linear_issue_id, so re-running
// updates rather than duplicates. Auth uses a Linear personal API key (LINEAR_API_KEY). The
// team is resolved from LINEAR_TEAM_ID → app_setting cache → lookup by name → auto-create.
//
// POST { eventId }  → { ok, teamId, projectId, projectUrl, synced, total }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const TEAM_NAME = "EventHub";
const TEAM_KEY = "EVT"; // 1–5 uppercase chars; only used when auto-creating the team
const API = "https://api.linear.app/graphql";

// Minimal GraphQL client. Linear personal API keys go straight in Authorization (no "Bearer").
async function gql<T = any>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const r = await fetch(API, {
    method: "POST",
    headers: { Authorization: Deno.env.get("LINEAR_API_KEY")!, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const d = await r.json();
  if (d.errors?.length) throw new Error(`Linear: ${d.errors.map((e: any) => e.message).join("; ")}`);
  return d.data as T;
}

// The single EventHub team: env id → app_setting cache → lookup by name → create.
async function ensureTeam(sb: ReturnType<typeof createClient>): Promise<string> {
  const envId = Deno.env.get("LINEAR_TEAM_ID");
  if (envId) return envId;
  const { data: row } = await sb.from("app_setting").select("value").eq("key", "linear_team_id").maybeSingle();
  if (row?.value) return row.value as string;

  const found = await gql<{ teams: { nodes: { id: string; name: string }[] } }>(
    `query($n:String!){ teams(filter:{ name:{ eqIgnoreCase:$n } }){ nodes{ id name } } }`,
    { n: TEAM_NAME },
  );
  let teamId = found.teams.nodes[0]?.id ?? null;
  if (!teamId) {
    const made = await gql<{ teamCreate: { success: boolean; team: { id: string } } }>(
      `mutation($name:String!,$key:String!){ teamCreate(input:{ name:$name, key:$key }){ success team{ id } } }`,
      { name: TEAM_NAME, key: TEAM_KEY },
    );
    teamId = made.teamCreate.team.id;
  }
  await sb.from("app_setting").upsert({ key: "linear_team_id", value: teamId });
  return teamId!;
}

// Map a deliverable status to a workflow-state id by state *type*, using the team's states.
function pickStateId(states: { id: string; type: string }[], status: string | null): string | undefined {
  const want = status === "Done" ? "completed" : status === "In Progress" ? "started" : "unstarted";
  const byType = (t: string) => states.find((s) => s.type === t)?.id;
  return byType(want) ?? byType("unstarted") ?? byType("backlog") ?? states[0]?.id;
}

// Find a Linear user id by email (to map an event owner → project lead). Null if no match.
async function findUserIdByEmail(email: string): Promise<string | null> {
  try {
    const r = await gql<{ users: { nodes: { id: string }[] } }>(
      `query($e:String!){ users(filter:{ email:{ eq:$e } }){ nodes{ id } } }`, { e: email },
    );
    return r.users.nodes[0]?.id ?? null;
  } catch { return null; }
}

// Ensure a project exists for this event; on creation, fill as much context as we can:
// lead (from the event owner), target date (= event date), description/content (= event
// description), and project links to the event page + Luma. Returns { id, url }.
async function ensureProject(teamId: string, ev: any, sb: ReturnType<typeof createClient>): Promise<{ id: string; url: string | null }> {
  if (ev.linear_project_id) return { id: ev.linear_project_id, url: ev.linear_project_url ?? null };

  // Lead = first owner we can resolve to a Linear user by email.
  let leadId: string | null = null;
  for (const o of (ev.owners ?? [])) {
    const email = o?.profile?.email;
    if (!email) continue;
    leadId = await findUserIdByEmail(email);
    if (leadId) break;
  }

  const fullDesc: string = (ev.description ?? "").trim();
  const description = fullDesc ? fullDesc.slice(0, 250) : undefined; // Linear's short summary (length-capped)

  const made = await gql<{ projectCreate: { success: boolean; project: { id: string; url: string } } }>(
    `mutation($name:String!,$teamIds:[String!]!,$desc:String,$content:String,$lead:String,$target:TimelessDate){
       projectCreate(input:{ name:$name, teamIds:$teamIds, description:$desc, content:$content, leadId:$lead, targetDate:$target }){ success project{ id url } }
     }`,
    {
      name: ev.name ?? "Untitled event",
      teamIds: [teamId],
      desc: description,
      content: fullDesc || undefined,           // full event description as the project's overview doc
      lead: leadId ?? undefined,
      target: ev.event_date || undefined,
    },
  );
  const project = made.projectCreate.project;
  await sb.from("event").update({ linear_project_id: project.id, linear_project_url: project.url }).eq("id", ev.id);

  // Project links: the event page (live → preview fallback) and Luma, when present.
  const links = [
    (ev.live_url || ev.preview_url) ? { url: ev.live_url || ev.preview_url, label: "Event page" } : null,
    ev.luma_url ? { url: ev.luma_url, label: "Luma" } : null,
  ].filter(Boolean) as { url: string; label: string }[];
  for (const l of links) {
    try {
      await gql(
        `mutation($pid:String!,$url:String!,$label:String){ projectLinkCreate(input:{ projectId:$pid, url:$url, label:$label }){ success } }`,
        { pid: project.id, url: l.url, label: l.label },
      );
    } catch { /* a bad/duplicate link shouldn't fail the whole sync */ }
  }
  return { id: project.id, url: project.url };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    if (!Deno.env.get("LINEAR_API_KEY")) return json({ error: "Linear not connected (LINEAR_API_KEY unset). Create a personal API key in Linear → Settings → API." }, 400);
    const { eventId, direction = "push" } = await req.json();
    if (!eventId) return json({ error: "eventId required" }, 400);

    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const { data: ev, error } = await sb.from("event")
      .select("id, name, event_date, location, description, live_url, preview_url, luma_url, linear_project_id, linear_project_url, owners:event_owner ( profile:profile ( name, email ) )")
      .eq("id", eventId).single();
    if (error || !ev) return json({ error: "event not found" }, 404);

    const { data: dels } = await sb.from("deliverable")
      .select("id, title, phase, owner_role, resolved_due_date, status, linear_issue_id")
      .eq("event_id", eventId).order("resolved_due_date", { nullsFirst: false });
    const deliverables = dels ?? [];

    // PULL: read each linked issue's current state from Linear and write it back onto the
    // matching deliverable (Linear is the source of truth on load). Creates nothing.
    if (direction === "pull") {
      if (!ev.linear_project_id) return json({ ok: true, direction: "pull", pulled: 0, note: "event not linked to Linear yet" });
      const data = await gql<{ issues: { nodes: { id: string; state: { type: string } | null }[] } }>(
        `query($p:ID!){ issues(filter:{ project:{ id:{ eq:$p } } }){ nodes{ id state{ type } } } }`,
        { p: ev.linear_project_id },
      );
      const typeByIssue = new Map(data.issues.nodes.map((n) => [n.id, n.state?.type]));
      // Linear workflow-state type → EventHub status.
      const toStatus = (t?: string): string | null =>
        t === "completed" ? "Done" : t === "started" ? "In Progress" : (t === "unstarted" || t === "backlog" || t === "triage") ? "Todo" : null;
      let pulled = 0;
      for (const d of deliverables) {
        if (!d.linear_issue_id) continue;
        const status = toStatus(typeByIssue.get(d.linear_issue_id));
        if (!status || status === d.status) continue;
        await sb.from("deliverable").update({ status }).eq("id", d.id);
        pulled++;
      }
      return json({ ok: true, direction: "pull", pulled, total: deliverables.length });
    }

    const teamId = await ensureTeam(sb);
    const project = await ensureProject(teamId, ev, sb);

    // Workflow states for status → stateId mapping.
    const ws = await gql<{ workflowStates: { nodes: { id: string; type: string }[] } }>(
      `query($t:ID!){ workflowStates(filter:{ team:{ id:{ eq:$t } } }){ nodes{ id type } } }`,
      { t: teamId },
    );
    const states = ws.workflowStates.nodes;

    let synced = 0;
    for (const d of deliverables) {
      const description = [d.phase ? `Phase: ${d.phase}` : null, d.owner_role ? `Owner: ${d.owner_role}` : null, `Synced from EventHub.`]
        .filter(Boolean).join("\n");
      const stateId = pickStateId(states, d.status);
      const dueDate = d.resolved_due_date || undefined; // Linear TimelessDate = YYYY-MM-DD

      if (d.linear_issue_id) {
        await gql(
          `mutation($id:String!,$title:String!,$desc:String,$stateId:String,$due:TimelessDate,$pid:String){ issueUpdate(id:$id, input:{ title:$title, description:$desc, stateId:$stateId, dueDate:$due, projectId:$pid }){ success } }`,
          { id: d.linear_issue_id, title: d.title, desc: description, stateId, due: dueDate, pid: project.id },
        );
      } else {
        const res = await gql<{ issueCreate: { success: boolean; issue: { id: string; url: string } } }>(
          `mutation($title:String!,$desc:String,$teamId:String!,$pid:String!,$stateId:String,$due:TimelessDate){ issueCreate(input:{ title:$title, description:$desc, teamId:$teamId, projectId:$pid, stateId:$stateId, dueDate:$due }){ success issue{ id url } } }`,
          { title: d.title, desc: description, teamId, pid: project.id, stateId, due: dueDate },
        );
        const issue = res.issueCreate.issue;
        await sb.from("deliverable").update({ linear_issue_id: issue.id, linear_issue_url: issue.url }).eq("id", d.id);
      }
      synced++;
    }

    return json({ ok: true, teamId, projectId: project.id, projectUrl: project.url, synced, total: deliverables.length });
  } catch (e) {
    return json({ error: (e as Error).message ?? String(e) }, 500);
  }
});
