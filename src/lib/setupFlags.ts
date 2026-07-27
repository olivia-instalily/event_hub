import type { EventPlanning } from "./db";

export type SetupFlagKey = "date" | "headcount" | "owners" | "budget" | "timeline";
export const SETUP_FLAG_KEYS: SetupFlagKey[] = ["date", "headcount", "owners", "budget", "timeline"];

export type FlagInput = Pick<EventPlanning,
  "date" | "headcount" | "owners" | "eventBudgetTarget" | "budget" | "deliverables" | "setupProgress">;

/** True when the user has engaged enough for this flag to auto-clear. */
export function flagEngaged(plan: FlagInput, key: SetupFlagKey): boolean {
  switch (key) {
    case "date": return plan.date != null;
    case "headcount": return plan.headcount != null;
    // Creator is auto-added as owner (assignOwner), so >= 2 means a real co-owner was added.
    case "owners": return plan.owners.length >= 2;
    case "budget": return plan.eventBudgetTarget != null
      || (plan.budget?.lines.some((l) => l.target != null || l.confirmedAmount != null) ?? false);
    case "timeline": return plan.deliverables.length > 0;
  }
}

/** Flags to show: not yet engaged AND not manually settled (settled = key in setupProgress). */
export function visibleFlags(plan: FlagInput): SetupFlagKey[] {
  const settled = new Set(plan.setupProgress);
  return SETUP_FLAG_KEYS.filter((k) => !flagEngaged(plan, k) && !settled.has(k));
}
