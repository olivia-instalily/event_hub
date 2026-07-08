import { describe, expect, it } from "vitest";
import { completenessGaps, looksLikeBackfill, matchTemplates, templateAdditions, type BackfillExtract, type TemplateLite } from "../src/lib/backfill";

// Fixed reference "today" so these don't rot as the real clock advances.
const NOW = new Date(2026, 6, 8); // 2026-07-08

const base = (over: Partial<BackfillExtract> = {}): BackfillExtract => ({
  name: "X", date: null, location: null, format: null, tag: null, headcount: null,
  turnoutActual: null, budgetTotal: null, verdict: "", phases: [], staffRoles: [],
  lessons: [], heuristics: [], actuals: [], deliverables: [], ...over,
});

describe("completenessGaps", () => {
  it("flags the load-bearing fields a hiring event is missing", () => {
    const { category, gaps } = completenessGaps(base({ format: "Fireside", date: "2026-06-05" }));
    expect(category).toBe("hiring");
    const fields = gaps.map((g) => g.field);
    expect(fields).not.toContain("date");          // present
    expect(fields).toEqual(expect.arrayContaining(["budget", "turnout", "outcome"]));
  });

  it("does NOT flag budget for a community event (category-scoped)", () => {
    const { category, gaps } = completenessGaps(base({ format: "Run", tag: "Community", date: "2026-06-05", turnoutActual: 12, verdict: "good vibe" }));
    expect(category).toBe("neither");
    expect(gaps.map((g) => g.field)).not.toContain("budget"); // community budget isn't load-bearing
    expect(gaps).toHaveLength(0);                              // date+turnout+outcome all present
  });

  it("counts budget satisfied by actuals", () => {
    const g = completenessGaps(base({ format: "Fireside", date: "2026-06-05", turnoutActual: 40, verdict: "ok", actuals: [{ line: "Venue", amount: 1000 }] }));
    expect(g.gaps).toHaveLength(0);
  });
});

describe("looksLikeBackfill", () => {
  it("flags a real debrief (past signals, no future date)", () => {
    expect(looksLikeBackfill("Debrief: turnout was 40. Lessons learned: order more coffee.", NOW)).toBe(true);
  });

  it("does NOT flag a forward brief whose future date beats an incidental 'Wrap-up' agenda line", () => {
    const brief = "Summit brief\nEvent date: August 8, 2026\nAgenda:\n 4:30 Panel\n 5:30 Wrap-up and networking";
    expect(looksLikeBackfill(brief, NOW)).toBe(false);
  });

  it("does NOT flag when a future ISO date is present alongside 'post-event' plans", () => {
    expect(looksLikeBackfill("Scheduled for 2026-08-08. Post-event survey to follow.", NOW)).toBe(false);
  });

  it("still flags a past-dated recap (date is in the past + past signal)", () => {
    expect(looksLikeBackfill("Recap of our 2026-06-01 dinner — great turnout.", NOW)).toBe(true);
  });

  it("treats a month/day future date with no year (this year, still upcoming) as forward", () => {
    expect(looksLikeBackfill("Kickoff August 8. Wrap-up at 5pm.", NOW)).toBe(false);
  });

  it("returns false for empty or signal-free text", () => {
    expect(looksLikeBackfill("", NOW)).toBe(false);
    expect(looksLikeBackfill("Some misc planning notes.", NOW)).toBe(false);
  });
});

describe("matchTemplates", () => {
  const tmpls: TemplateLite[] = [
    { id: "t1", name: "Recruiting Fireside", format: "Fireside", tags: ["Brand & community event"], phases: ["Plan"], staffRoles: [], reflections: [] },
    { id: "t2", name: "Client Dinner", format: "Dinner", tags: ["Client summit"], phases: [], staffRoles: [], reflections: [] },
  ];
  it("scores an exact format match highest", () => {
    const m = matchTemplates(tmpls, { format: "Fireside", tag: null });
    expect(m[0].template.id).toBe("t1");
    expect(m[0].score).toBeGreaterThanOrEqual(3);
  });
  it("returns nothing when no type overlaps", () => {
    expect(matchTemplates(tmpls, { format: "Hackathon", tag: null })).toHaveLength(0);
  });
});

describe("templateAdditions", () => {
  it("proposes only what the template lacks (one-directional, deduped, case-insensitive)", () => {
    const t: TemplateLite = { id: "t1", name: "F", format: "Fireside", tags: [], phases: ["Plan it"], staffRoles: ["Host"], reflections: ["Start early"] };
    const x = base({ phases: ["plan it", "Promote"], staffRoles: ["Host", "Photographer"], lessons: ["Start early", "Order more coffee"], heuristics: [] });
    const add = templateAdditions(t, x);
    expect(add.phases).toEqual(["Promote"]);       // "plan it" already there (case-insensitive)
    expect(add.roles).toEqual(["Photographer"]);
    expect(add.lessons).toEqual(["Order more coffee"]);
  });
});
