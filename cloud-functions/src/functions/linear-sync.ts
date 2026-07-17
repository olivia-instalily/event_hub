import { Request, Response } from 'express';
import { getServiceClient } from '../db.js';

const TEAM_NAME = 'EventHub';
const TEAM_KEY  = 'EVT';
const API       = 'https://api.linear.app/graphql';

async function gql<T = any>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const r = await fetch(API, {
    method: 'POST',
    headers: { Authorization: process.env.LINEAR_API_KEY!, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  const d = await r.json() as any;
  if (d.errors?.length) throw new Error(`Linear: ${d.errors.map((e: any) => e.message).join('; ')}`);
  return d.data as T;
}

async function ensureTeam(sb: ReturnType<typeof getServiceClient>): Promise<string> {
  const envId = process.env.LINEAR_TEAM_ID;
  if (envId) return envId;
  const { data: row } = await sb.from('app_setting').select('value').eq('key', 'linear_team_id').maybeSingle();
  if ((row as any)?.value) return (row as any).value as string;
  const found = await gql<{ teams: { nodes: { id: string; name: string }[] } }>(
    `query($n:String!){ teams(filter:{ name:{ eqIgnoreCase:$n } }){ nodes{ id name } } }`, { n: TEAM_NAME },
  );
  let teamId = found.teams.nodes[0]?.id ?? null;
  if (!teamId) {
    const made = await gql<{ teamCreate: { success: boolean; team: { id: string } } }>(
      `mutation($name:String!,$key:String!){ teamCreate(input:{ name:$name, key:$key }){ success team{ id } } }`,
      { name: TEAM_NAME, key: TEAM_KEY },
    );
    teamId = made.teamCreate.team.id;
  }
  await sb.from('app_setting').upsert({ key: 'linear_team_id', value: teamId });
  return teamId!;
}

function pickStateId(states: { id: string; type: string }[], status: string | null): string | undefined {
  const want = status === 'Done' ? 'completed' : status === 'In Progress' ? 'started' : 'unstarted';
  const byType = (t: string) => states.find((s) => s.type === t)?.id;
  return byType(want) ?? byType('unstarted') ?? byType('backlog') ?? states[0]?.id;
}

// Does this Linear project still exist? Deleting a project in Linear makes `project(id)` throw an
// "Entity not found" error (its issues go with it), so we treat any failure as "gone". Archived
// projects still resolve here — they open fine, so they're not "deleted".
async function projectExists(id: string): Promise<{ exists: boolean; url: string | null }> {
  try {
    const d = await gql<{ project: { id: string; url: string } | null }>(
      `query($p:String!){ project(id:$p){ id url } }`, { p: id },
    );
    return d.project ? { exists: true, url: d.project.url } : { exists: false, url: null };
  } catch {
    return { exists: false, url: null };
  }
}

async function findUserIdByEmail(email: string): Promise<string | null> {
  try {
    const r = await gql<{ users: { nodes: { id: string }[] } }>(
      `query($e:String!){ users(filter:{ email:{ eq:$e } }){ nodes{ id } } }`, { e: email },
    );
    return r.users.nodes[0]?.id ?? null;
  } catch { return null; }
}

async function ensureProject(teamId: string, ev: any, sb: ReturnType<typeof getServiceClient>): Promise<{ id: string; url: string | null }> {
  if (ev.linear_project_id) return { id: ev.linear_project_id, url: ev.linear_project_url ?? null };
  let leadId: string | null = null;
  for (const o of (ev.owners ?? [])) {
    const email = o?.profile?.email;
    if (!email) continue;
    leadId = await findUserIdByEmail(email);
    if (leadId) break;
  }
  const fullDesc: string = (ev.description ?? '').trim();
  const description = fullDesc ? fullDesc.slice(0, 250) : undefined;
  const made = await gql<{ projectCreate: { success: boolean; project: { id: string; url: string } } }>(
    `mutation($name:String!,$teamIds:[String!]!,$desc:String,$content:String,$lead:String,$target:TimelessDate){ projectCreate(input:{ name:$name, teamIds:$teamIds, description:$desc, content:$content, leadId:$lead, targetDate:$target }){ success project{ id url } } }`,
    { name: ev.name ?? 'Untitled event', teamIds: [teamId], desc: description, content: fullDesc || undefined, lead: leadId ?? undefined, target: ev.event_date || undefined },
  );
  const project = made.projectCreate.project;
  await sb.from('event').update({ linear_project_id: project.id, linear_project_url: project.url }).eq('id', ev.id);
  const links = [
    (ev.live_url || ev.preview_url) ? { url: ev.live_url || ev.preview_url, label: 'Event page' } : null,
    ev.luma_url ? { url: ev.luma_url, label: 'Luma' } : null,
  ].filter(Boolean) as { url: string; label: string }[];
  for (const l of links) {
    try { await gql(`mutation($pid:String!,$url:String!,$label:String){ projectLinkCreate(input:{ projectId:$pid, url:$url, label:$label }){ success } }`, { pid: project.id, url: l.url, label: l.label }); } catch { /* non-fatal */ }
  }
  return { id: project.id, url: project.url };
}

export async function handler(req: Request, res: Response) {
  try {
    if (!process.env.LINEAR_API_KEY) { res.status(400).json({ error: 'Linear not connected (LINEAR_API_KEY unset). Create a personal API key in Linear → Settings → API.' }); return; }
    const { eventId, direction = 'push' } = req.body;
    if (!eventId) { res.status(400).json({ error: 'eventId required' }); return; }

    const sb = getServiceClient();
    const { data: ev, error } = await sb.from('event')
      .select('id, name, event_date, location, description, live_url, preview_url, luma_url, linear_project_id, linear_project_url, owners:event_owner ( profile:profile ( name, email ) )')
      .eq('id', eventId).single();
    if (error || !ev) { res.status(404).json({ error: 'event not found' }); return; }

    // Existence check — powers the "Open in Linear" button, which verifies the project is still there
    // before navigating so a deleted project offers a re-sync instead of a dead page.
    if (direction === 'check') {
      if (!(ev as any).linear_project_id) { res.json({ ok: true, linked: false, exists: false, url: null }); return; }
      const chk = await projectExists((ev as any).linear_project_id);
      res.json({ ok: true, linked: true, exists: chk.exists, url: chk.exists ? (chk.url ?? (ev as any).linear_project_url) : null });
      return;
    }

    const { data: dels } = await sb.from('deliverable')
      .select('id, title, phase, owner_role, resolved_due_date, status, linear_issue_id')
      .eq('event_id', eventId).order('resolved_due_date', { nullsFirst: false });
    const deliverables = dels ?? [];

    if (direction === 'pull') {
      if (!(ev as any).linear_project_id) { res.json({ ok: true, direction: 'pull', pulled: 0, note: 'event not linked to Linear yet' }); return; }
      const data = await gql<{ issues: { nodes: { id: string; state: { type: string } | null }[] } }>(
        `query($p:ID!){ issues(filter:{ project:{ id:{ eq:$p } } }){ nodes{ id state{ type } } } }`,
        { p: (ev as any).linear_project_id },
      );
      const typeByIssue = new Map(data.issues.nodes.map((n) => [n.id, n.state?.type]));
      const toStatus = (t?: string): string | null =>
        t === 'completed' ? 'Done' : t === 'started' ? 'In Progress' : (t === 'unstarted' || t === 'backlog' || t === 'triage') ? 'Todo' : null;
      let pulled = 0;
      for (const d of deliverables) {
        if (!(d as any).linear_issue_id) continue;
        const status = toStatus(typeByIssue.get((d as any).linear_issue_id));
        if (!status || status === (d as any).status) continue;
        await sb.from('deliverable').update({ status }).eq('id', (d as any).id);
        pulled++;
      }
      res.json({ ok: true, direction: 'pull', pulled, total: deliverables.length }); return;
    }

    // UNLINK / DELETE: trash the Linear project and every issue in it, then clear the linkage on this
    // event + its deliverables. Idempotent — if the project is already gone in Linear we still clear
    // our side so the event reads as un-synced (the "Sync to Linear" button returns).
    if (direction === 'unlink' || direction === 'delete') {
      let deletedIssues = 0;
      let deletedProject = false;
      if ((ev as any).linear_project_id) {
        try {
          const data = await gql<{ issues: { nodes: { id: string }[] } }>(
            `query($p:ID!){ issues(filter:{ project:{ id:{ eq:$p } } }){ nodes{ id } } }`,
            { p: (ev as any).linear_project_id },
          );
          for (const n of data.issues.nodes) {
            try { await gql(`mutation($id:String!){ issueDelete(id:$id){ success } }`, { id: n.id }); deletedIssues++; } catch { /* keep deleting the rest */ }
          }
          try { await gql(`mutation($id:String!){ projectDelete(id:$id){ success } }`, { id: (ev as any).linear_project_id }); deletedProject = true; } catch { /* project may already be gone */ }
        } catch { /* project unreadable — still clear our linkage below */ }
      }
      await sb.from('event').update({ linear_project_id: null, linear_project_url: null }).eq('id', eventId);
      await sb.from('deliverable').update({ linear_issue_id: null, linear_issue_url: null }).eq('event_id', eventId);
      res.json({ ok: true, direction: 'unlink', deletedIssues, deletedProject }); return;
    }

    // Self-heal a deleted project before pushing. If the stored project is gone from Linear (deleted
    // there) — or the caller explicitly asked to recreate — wipe the stale linkage so ensureProject
    // builds a fresh project below. The deleted project took its issues with it, so every
    // deliverable's linear_issue_id is dead too; clear those or issueUpdate would target ghost ids.
    const recreate = !!req.body.recreate;
    let recreated = false;
    if ((ev as any).linear_project_id) {
      const chk = recreate ? { exists: false } : await projectExists((ev as any).linear_project_id);
      if (!chk.exists) {
        await sb.from('event').update({ linear_project_id: null, linear_project_url: null }).eq('id', eventId);
        await sb.from('deliverable').update({ linear_issue_id: null, linear_issue_url: null }).eq('event_id', eventId);
        (ev as any).linear_project_id = null;
        (ev as any).linear_project_url = null;
        for (const d of deliverables) (d as any).linear_issue_id = null;
        recreated = true;
      }
    }

    const teamId  = await ensureTeam(sb);
    const project = await ensureProject(teamId, ev, sb);

    const ws = await gql<{ workflowStates: { nodes: { id: string; type: string }[] } }>(
      `query($t:ID!){ workflowStates(filter:{ team:{ id:{ eq:$t } } }){ nodes{ id type } } }`, { t: teamId },
    );
    const states = ws.workflowStates.nodes;

    let synced = 0;
    for (const d of deliverables) {
      const description = [(d as any).phase ? `Phase: ${(d as any).phase}` : null, (d as any).owner_role ? `Owner: ${(d as any).owner_role}` : null, `Synced from EventHub.`].filter(Boolean).join('\n');
      const stateId = pickStateId(states, (d as any).status);
      const dueDate = (d as any).resolved_due_date || undefined;

      if ((d as any).linear_issue_id) {
        await gql(`mutation($id:String!,$title:String!,$desc:String,$stateId:String,$due:TimelessDate,$pid:String){ issueUpdate(id:$id, input:{ title:$title, description:$desc, stateId:$stateId, dueDate:$due, projectId:$pid }){ success } }`,
          { id: (d as any).linear_issue_id, title: (d as any).title, desc: description, stateId, due: dueDate, pid: project.id });
      } else {
        const r = await gql<{ issueCreate: { success: boolean; issue: { id: string; url: string } } }>(
          `mutation($title:String!,$desc:String,$teamId:String!,$pid:String!,$stateId:String,$due:TimelessDate){ issueCreate(input:{ title:$title, description:$desc, teamId:$teamId, projectId:$pid, stateId:$stateId, dueDate:$due }){ success issue{ id url } } }`,
          { title: (d as any).title, desc: description, teamId, pid: project.id, stateId, due: dueDate },
        );
        const issue = r.issueCreate.issue;
        await sb.from('deliverable').update({ linear_issue_id: issue.id, linear_issue_url: issue.url }).eq('id', (d as any).id);
      }
      synced++;
    }

    res.json({ ok: true, teamId, projectId: project.id, projectUrl: project.url, synced, total: deliverables.length, recreated });
  } catch (e) {
    console.error(JSON.stringify({ fn: 'linear-sync', error: String((e as Error)?.message ?? e) }));
    res.status(500).json({ error: (e as Error).message ?? String(e) });
  }
}
