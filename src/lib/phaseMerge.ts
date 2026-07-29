// Template phase merge: align-and-reconcile, never concatenate. Two templates of the same type
// describe the SAME event arc in different words — merge by ROLE, anchored on a single day-of.
// Pure + testable; consumed by templateAdditions (diff) and applyTemplateAdditions (write).

export type PhaseRole = "setup" | "promote" | "event" | "thanks" | "measure";
// T-minus → T-0 → T-plus. The merged timeline is ordered by this.
export const ROLE_RANK: Record<PhaseRole, number> = { setup: 0, promote: 1, event: 2, thanks: 3, measure: 4 };

// Alias map (maintainable, not one-off): a phase name → its role. "event" is checked FIRST so it
// anchors the single day-of and "Run of show" doesn't get miscaught by another role's "run".
const ALIASES: { role: PhaseRole; rx: RegExp }[] = [
  { role: "event", rx: /\b(run of show|run[- ]?of[- ]?show|day[- ]?of|event day|live|\brun\b|\bshow\b)\b/i },
  { role: "setup", rx: /\b(plan|planning|set[- ]?up|logistics|prep|prepare|scope|scoping)\b/i },
  { role: "promote", rx: /\b(promote|promotion|get people there|outreach|invite|invites|rsvps?|marketing|sign[- ]?ups?)\b/i },
  { role: "thanks", rx: /\b(thanks|thank|follow[- ]?up|follow[- ]?ups|nudge|gratitude)\b/i },
  { role: "measure", rx: /\b(measure|turnout|debrief|wrap|wrap[- ]?up|recap|retro|retrospective|review|post|post[- ]?event|post[- ]?mortem|reflect|reflections?|outcomes?)\b/i },
];

/** Map a phase name to its role, or null when it doesn't match any known role. */
export function phaseRole(name: string): PhaseRole | null {
  const n = (name ?? "").toLowerCase();
  for (const a of ALIASES) if (a.rx.test(n)) return a.role;
  return null;
}

const norm = (s: string) => (s ?? "").trim().toLowerCase();

/** Genuinely-new incoming phases: ones whose ROLE isn't already covered by the template (and, for
 *  unknown roles, whose NAME isn't already present). Never returns a role the template already has —
 *  that's the bug (a second "Run" alongside "Run of show"). Reconciliation = keep the existing node. */
export function newPhasesByRole(existing: { name: string }[], incoming: string[]): string[] {
  const existingRoles = new Set<PhaseRole>();
  const existingNames = new Set(existing.map((p) => norm(p.name)));
  for (const p of existing) { const r = phaseRole(p.name); if (r) existingRoles.add(r); }
  const out: string[] = [];
  const newRoles = new Set<PhaseRole>();
  const newNames = new Set<string>();
  for (const name of incoming) {
    const key = norm(name);
    if (!key) continue;
    const role = phaseRole(name);
    if (role) {
      if (existingRoles.has(role) || newRoles.has(role)) continue; // role covered → reconcile, no new node
      newRoles.add(role); out.push(name);
    } else {
      if (existingNames.has(key) || newNames.has(key)) continue;
      newNames.add(key); out.push(name);
    }
  }
  return out;
}

/** Merge confirmed new phases into the template's list: role-deduped (existing name wins as
 *  canonical), ordered T-minus→T-0→T-plus, exactly one day-of. Unknown-role phases keep input order
 *  at the end. Returns reindexed {name, order}. */
export function mergePhaseList(existing: { name: string; order?: number }[], addNames: string[]): { name: string; order: number }[] {
  const byRole = new Map<PhaseRole, string>();
  const unknown: string[] = [];
  const push = (name: string) => {
    const role = phaseRole(name);
    if (role) { if (!byRole.has(role)) byRole.set(role, name); } // first (existing) wins as canonical
    else if (!unknown.some((u) => norm(u) === norm(name))) unknown.push(name);
  };
  existing.forEach((p) => push(p.name)); // existing first → its names are canonical
  addNames.forEach(push);
  const known = [...byRole.entries()].sort((a, b) => ROLE_RANK[a[0]] - ROLE_RANK[b[0]]).map(([, n]) => n);
  return [...known, ...unknown].map((name, i) => ({ name, order: i }));
}

/** Fold a content item's phase (on a deliverable / walkthrough step) into the canonical phase NODE
 *  that plays the same role — so an alias like "Set up the logistics" groups under "Plan it" and
 *  sorts in the right place, instead of orphaning into a section after the last node. */
export function canonicalPhaseFor(contentPhase: string | null | undefined, nodeNames: string[]): string {
  const p = contentPhase ?? "";
  const role = phaseRole(p);
  if (!role) return p;
  return nodeNames.find((n) => phaseRole(n) === role) ?? p;
}

/** Near-duplicate by meaning (not string equality): exact, containment, or high token overlap.
 *  Conservative — when two lines are close, treat as duplicate (skip) rather than add a redundant one. */
export function nearDuplicate(a: string, b: string): boolean {
  const na = norm(a).replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  const nb = norm(b).replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  if (!na || !nb) return false;
  if (na === nb || na.includes(nb) || nb.includes(na)) return true;
  const ta = new Set(na.split(" ")), tb = new Set(nb.split(" "));
  const inter = [...ta].filter((w) => tb.has(w)).length;
  const union = new Set([...ta, ...tb]).size;
  return union > 0 && inter / union >= 0.6;
}
