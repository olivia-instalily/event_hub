import { describe, expect, it } from "vitest";
import { phaseRole, newPhasesByRole, mergePhaseList, nearDuplicate } from "../src/lib/phaseMerge";
import { templateAdditions, type TemplateLite, type BackfillExtract } from "../src/lib/backfill";

describe("phaseRole alias map", () => {
  it("maps synonyms to one role, with day-of anchored", () => {
    expect(phaseRole("Run of show")).toBe("event");
    expect(phaseRole("Run")).toBe("event");
    expect(phaseRole("Day-of")).toBe("event");
    expect(phaseRole("Plan it")).toBe("setup");
    expect(phaseRole("Planning")).toBe("setup");
    expect(phaseRole("Say thanks")).toBe("thanks");
    expect(phaseRole("Follow-up")).toBe("thanks");
    expect(phaseRole("Measure turnout")).toBe("measure");
    expect(phaseRole("Debrief")).toBe("measure");
    expect(phaseRole("Afterparty logistics")).toBe("setup"); // "logistics"
    expect(phaseRole("Karaoke")).toBeNull();
  });
});

describe("newPhasesByRole — never duplicate a role", () => {
  it("reconciles same-role phases (no second Run/Follow-up) and only adds genuinely-new roles", () => {
    const existing = [{ name: "Plan it" }, { name: "Run of show" }, { name: "Measure turnout" }];
    const incoming = ["Planning", "Run", "Promote", "Follow-up", "Debrief"];
    // Planning→setup (have), Run→event (have), Promote→promote (NEW), Follow-up→thanks (NEW), Debrief→measure (have)
    expect(newPhasesByRole(existing, incoming)).toEqual(["Promote", "Follow-up"]);
  });
});

describe("mergePhaseList — one day-of, ordered, count ≈ max not sum", () => {
  it("aligns the two phase lists from the bug into one coherent timeline", () => {
    const existing = [{ name: "Plan it" }, { name: "Run of show" }, { name: "Measure turnout" }];
    const merged = mergePhaseList(existing, ["Planning", "Day-of", "Follow-up", "Plan", "Run", "Debrief"]);
    const names = merged.map((p) => p.name);
    // exactly one day-of (event role), kept as the existing canonical name
    expect(names.filter((n) => phaseRole(n) === "event")).toEqual(["Run of show"]);
    // a genuinely-new role (thanks / Follow-up) was added; setup/measure reconciled (not duplicated)
    expect(names).toContain("Follow-up");
    expect(names.filter((n) => phaseRole(n) === "setup")).toHaveLength(1);
    expect(names.filter((n) => phaseRole(n) === "measure")).toHaveLength(1);
    // NOT concatenated: 3 existing + 6 incoming would be 9; reconciled is far fewer
    expect(merged.length).toBeLessThanOrEqual(5);
    // strictly ordered T-minus → T-0 → T-plus
    const roles = names.map((n) => phaseRole(n)).filter(Boolean) as string[];
    const rank: Record<string, number> = { setup: 0, promote: 1, event: 2, thanks: 3, measure: 4 };
    expect(roles).toEqual([...roles].sort((a, b) => rank[a] - rank[b]));
  });
});

describe("nearDuplicate (string heuristic — exact / containment / high token overlap)", () => {
  it("catches re-phrasings it can see, and leaves clearly-distinct lines alone", () => {
    expect(nearDuplicate("Order coffee for 70% of checked-in", "order coffee for 70% of checked in")).toBe(true); // punctuation/case
    expect(nearDuplicate("split the AV check into its own step", "split the AV check")).toBe(true);                // containment
    expect(nearDuplicate("order coffee for 70% of checked-in", "book the venue earlier")).toBe(false);
  });
});

describe("templateAdditions — empty diff is a no-op", () => {
  const t: TemplateLite = { id: "t", name: "Fireside", format: "Fireside", tags: [], phases: ["Plan it", "Run of show", "Measure turnout"], staffRoles: ["Host"], reflections: ["Start outreach early"] };
  const base = (o: Partial<BackfillExtract>): BackfillExtract => ({ name: "", date: null, location: null, format: null, tag: null, headcount: null, turnoutActual: null, budgetTotal: null, verdict: "", phases: [], staffRoles: [], lessons: [], heuristics: [], actuals: [], deliverables: [], ...o });
  it("adds nothing when the event only repeats the template (role-aliased phases, dup lesson)", () => {
    const add = templateAdditions(t, base({ phases: ["Planning", "Run", "Debrief"], staffRoles: ["Host"], lessons: ["Start outreach early"] }));
    expect(add.phases).toEqual([]);
    expect(add.roles).toEqual([]);
    expect(add.lessons).toEqual([]);
  });
  it("surfaces only the genuinely-new items", () => {
    const add = templateAdditions(t, base({ phases: ["Promote"], staffRoles: ["Photographer"], lessons: ["over-order coffee"] }));
    expect(add.phases).toEqual(["Promote"]);
    expect(add.roles).toEqual(["Photographer"]);
    expect(add.lessons).toEqual(["over-order coffee"]);
  });
});
