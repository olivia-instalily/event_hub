// Event scoping form (V0). The brief an owner generates, reviews, and submits for approval
// from inside the Budget flow. Persisted client-side per event for now (no new entities / no
// migration); the shape mirrors the intended event columns so it can move server-side later.
import { TAG_CATEGORIES } from "./tags";

export type ScopingStatus = "draft" | "submitted" | "assigned";

export interface ScopingForm {
  // Factual — projected from the event on generation, then editable. (Date/name/category
  // are read live from the event, not stored here.)
  type: string;            // gathering type (from formats)
  audience: string;
  headcount: string;
  venue: string;
  components: string[];    // what's being arranged (from vendor categories)
  // Strategic — the only AI/auto-drafted prose; editable + regenerate.
  strategicJustification: string;
  execSponsor: string;     // optional
  // Workflow.
  status: ScopingStatus;
  assignedBudget: number | null;   // returned budget; locks on assignment (becomes the target)
  approvalComment: string | null;  // optional note returned with the budget
  submittedSummary: string | null; // formatted summary posted to Slack on submit
  submittedAt: string | null;      // ISO date the form was submitted for approval
  submittedChannel: string | null; // Slack channel it was posted to
  generated: boolean;              // composed at least once (don't store a blank record)
}

export const emptyScoping = (): ScopingForm => ({
  type: "", audience: "", headcount: "", venue: "", components: [],
  strategicJustification: "", execSponsor: "",
  status: "draft", assignedBudget: null, approvalComment: null, submittedSummary: null, submittedAt: null, submittedChannel: null, generated: false,
});

const keyFor = (eventId: string) => `scoping:${eventId}`;

export function loadScoping(eventId: string): ScopingForm {
  try {
    const raw = localStorage.getItem(keyFor(eventId));
    if (raw) return { ...emptyScoping(), ...JSON.parse(raw) };
  } catch { /* ignore malformed/unavailable storage */ }
  return emptyScoping();
}

export function saveScoping(eventId: string, s: ScopingForm): void {
  try { localStorage.setItem(keyFor(eventId), JSON.stringify(s)); } catch { /* ignore */ }
}

// Category (taxonomy tag) → funding line + approval tier.
export function fundingFor(tags: string[]): { fundingLine: string; tier: string; category: string | null } {
  const cat = TAG_CATEGORIES.find((c) => c.tags.some((t) => tags.includes(t)));
  switch (cat?.name) {
    case "Hosted":      return { fundingLine: "Brand & Events", tier: "Tier 2", category: "Hosted" };
    case "Internal":    return { fundingLine: "Team & Culture", tier: "Tier 3", category: "Internal" };
    case "Sponsorship": return { fundingLine: "Partnerships",   tier: "Tier 1", category: "Sponsorship" };
    default:            return { fundingLine: "Unassigned",     tier: "—",      category: null };
  }
}

// ≥30-day lead-time check against the event date.
export function leadTimeCheck(date: string | null): { days: number | null; ok: boolean } {
  if (!date) return { days: null, ok: false };
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const ev = new Date(date + "T00:00:00");
  if (Number.isNaN(ev.getTime())) return { days: null, ok: false };
  const days = Math.round((ev.getTime() - today.getTime()) / 86_400_000);
  return { days, ok: days >= 30 };
}

export const STATUS_LABEL: Record<ScopingStatus, string> = {
  draft: "Draft",
  submitted: "Submitted · awaiting budget",
  assigned: "Budget assigned",
};

// Required fields for submission.
export const scopingComplete = (s: ScopingForm): boolean =>
  s.type.trim() !== "" && s.audience.trim() !== "" && s.headcount.trim() !== "" && s.strategicJustification.trim() !== "";

const fmtMoney = (n: number | null | undefined) =>
  n == null ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

// Formatted summary posted to the budget channel on submit (manual paste in V0). Shared by the
// full form and the glance card so both produce the same text.
export function buildScopingSummary(opts: { title: string; date: string | null; tags: string[]; scoping: ScopingForm; roughTotal: number }): string {
  const { title, date, tags, scoping, roughTotal } = opts;
  const funding = fundingFor(tags);
  const lead = leadTimeCheck(date);
  const headNum = Number(scoping.headcount) || null;
  const perPerson = headNum && roughTotal ? roughTotal / headNum : null;
  const leadStr = lead.days != null ? ` _(${lead.days}d lead${lead.ok ? "" : " — under 30d"})_` : "";
  // Slack mrkdwn — bold labels, blank lines between groups; requested budget at the bottom.
  return [
    `*Scoping request — ${title}*`,
    ``,
    `*Date:*  ${date ?? "TBD"}${leadStr}`,
    `*Funding line:*  ${funding.fundingLine} · ${funding.tier}`,
    `*Type:*  ${scoping.type || "—"}`,
    `*Audience:*  ${scoping.audience || "—"}  ·  ~${scoping.headcount || "—"} people`,
    `*Venue:*  ${scoping.venue || "—"}`,
    `*Components:*  ${scoping.components.join(", ") || "—"}`,
    scoping.execSponsor ? `*Exec sponsor:*  ${scoping.execSponsor}` : null,
    ``,
    `*Why it matters*`,
    scoping.strategicJustification || "—",
    ``,
    `*Requested budget:*  ${fmtMoney(roughTotal)}${perPerson != null ? `  (≈ ${fmtMoney(perPerson)}/person)` : ""}`,
    `_Reply in thread with the approved budget + any notes; the owner enters it in EventHub to lock the target._`,
  ].filter((l) => l !== null).join("\n");
}
