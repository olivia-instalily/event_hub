import { describe, it, expect } from "vitest";
import { captureId, resolveEvent, contextBounds, buildCaptures, composeEphemeral, matchRemovals,
  HOME_LABEL, type EventRow, type SlackMsg, type Proposal } from "./slack-capture-lib.js";

const ev = (id: string, ch: string | null, date: string | null = null): EventRow => ({ id, slack_channel: ch, event_date: date, name: id });

describe("captureId", () => {
  it("keys on (event, channel, ts, home)", () => {
    expect(captureId("e1", "C1", "1.2", "budget")).toBe("e1:C1:1.2:budget");
  });
});

describe("resolveEvent", () => {
  it("null when unlinked; single when one; most-recent when several", () => {
    expect(resolveEvent([ev("e", "CX")], "C1")).toBeNull();
    expect(resolveEvent([ev("e", "C1")], "C1")?.id).toBe("e");
    expect(resolveEvent([ev("old", "C1", "2026-01-01"), ev("new", "C1", "2026-09-01")], "C1")?.id).toBe("new");
  });
});

describe("contextBounds", () => {
  const msg = (ts: string): SlackMsg => ({ ts, text: "m" });
  it("caps to 30, keeps the pin, drops >3h", () => {
    const many = Array.from({ length: 50 }, (_, i) => msg(String(1000 + i)));
    const out = contextBounds(many, "1030");
    expect(out.length).toBeLessThanOrEqual(30);
    expect(out.some((m) => m.ts === "1030")).toBe(true);
    const pin = 1_000_000;
    const win = contextBounds([msg(String(pin - 4 * 3600)), msg(String(pin))], String(pin));
    expect(win.length).toBe(1);
  });
});

describe("buildCaptures", () => {
  const props: Proposal[] = [
    { home: "plan", summary: "pre-pour wine", detail: "for the early rush", sourceQuote: "let's pre-pour", usedContext: { first: "1", last: "2" } },
    { home: "budget", summary: "cost package for Karim", ambiguity: "is $1,200 the package or a deposit?" },
  ];
  it("stamps home-keyed ids, proposed status, provenance, ambiguity + conflict flags", () => {
    const caps = buildCaptures(ev("e1", "C1"), "C1", "1.2", "U9", "https://link", props, { budget: true });
    expect(caps).toHaveLength(2);
    expect(caps[0]).toMatchObject({ id: "e1:C1:1.2:plan", home: "plan", summary: "pre-pour wine", status: "proposed", reactor_user: "U9", source_ref: "https://link", source_quote: "let's pre-pour" });
    const budget = caps.find((c) => c.home === "budget")!;
    expect((budget.flags as any).conflict).toEqual({ field: "budget" });
    expect((budget.flags as any).ambiguity).toBe("is $1,200 the package or a deposit?");
  });
  it("no conflict flag when budget isn't already settled", () => {
    const caps = buildCaptures(ev("e1", "C1"), "C1", "1.2", "U9", null, [{ home: "budget", summary: "x" }], { budget: false });
    expect((caps[0].flags as any).conflict).toBeUndefined();
  });
});

describe("composeEphemeral", () => {
  const caps = buildCaptures(ev("e1", "C1"), "C1", "1.2", "U9", null, [
    { home: "plan", summary: "pre-pour wine" },
    { home: "person", summary: "Thurman (bar)" },
    { home: "open", summary: "get quotes (band, PA)" },
    { home: "open", summary: "second bar hand?" },
  ], { budget: false });

  it("headers, groups by home with counts + labels, and links out", () => {
    const t = composeEphemeral("Series B", "https://app/e1", caps, [], undefined);
    expect(t).toContain("Captured to *Series B*");
    expect(t).toMatch(/Plan\s+\+1/);
    expect(t).toMatch(/Who\s+\+1/);
    expect(t).toMatch(/Still open\s+\+2/);
    expect(t).toContain("pre-pour wine");
    expect(t).toContain("https://app/e1");
  });
  it("shows removals, radius note, and ambiguity", () => {
    const amb = buildCaptures(ev("e1", "C1"), "C1", "9.9", null, null, [{ home: "budget", summary: "robot dog", ambiguity: "cost unclear" }], { budget: false });
    const t = composeEphemeral("Series B", "https://app/e1", amb, [{ label: "live mural" }], "read 3 messages around your pin");
    expect(t).toMatch(/dropped: .*live mural/);
    expect(t).toContain("read 3 messages around your pin");
    expect(t).toMatch(/wasn.t sure/i);
  });
  it("honest nothing-to-capture line when empty", () => {
    const t = composeEphemeral("Series B", "https://app/e1", [], [], undefined);
    expect(t).toMatch(/[Nn]othing to capture/);
  });
});

describe("matchRemovals", () => {
  it("fuzzy-matches a dropped label to an existing capture id; ignores no-match", () => {
    const existing = [{ id: "a", summary: "live mural on the back wall" }, { id: "b", summary: "pre-pour wine" }];
    expect(matchRemovals(existing, [{ label: "the mural" }])).toEqual(["a"]);
    expect(matchRemovals(existing, [{ label: "fireworks" }])).toEqual([]);
  });
});

describe("HOME_LABEL", () => {
  it("maps homes to display labels", () => {
    expect(HOME_LABEL).toMatchObject({ plan: "Plan", person: "Who", open: "Still open", budget: "Budget" });
  });
});
