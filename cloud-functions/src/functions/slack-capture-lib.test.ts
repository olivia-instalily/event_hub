import { describe, it, expect } from "vitest";
import { captureId, resolveEvent, contextBounds, buildCaptures, buildScrapeCaptures, summarySlug, composeEphemeral, matchRemovals,
  matchPeople, normalizeName, candidateNote, buildPeopleNoMatch, meetingsToNudge, transcriptNudgeText,
  HOME_LABEL, type EventRow, type SlackMsg, type Proposal, type ScrapeProposal, type ScrapePerson } from "./slack-capture-lib.js";

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
  it("does NOT dismiss a capture that shares only ONE word with the removal (the disappearing-insights bug)", () => {
    const existing = [{ id: "a", summary: "Sponsor logos on badges" }, { id: "b", summary: "Booth staffing plan" }];
    // "sponsor booth dropped" shares 'sponsor' with a and 'booth' with b, but neither contains BOTH → keep both.
    expect(matchRemovals(existing, [{ label: "sponsor booth dropped" }])).toEqual([]);
  });
  it("requires all significant removal words present; matches the specific one", () => {
    const existing = [{ id: "a", summary: "Rooftop venue deposit" }, { id: "c", summary: "Live music on the roof" }];
    expect(matchRemovals(existing, [{ label: "rooftop venue fell through" }])).toEqual(["a"]);
  });
  it("ignores generic/stop words so a removal can't nuke unrelated captures", () => {
    const existing = [{ id: "a", summary: "Catering budget $5k" }, { id: "b", summary: "AV budget $2k" }, { id: "open1", summary: "Deciding between Ace Hotel and MaRS" }];
    // "the event dropped" reduces to nothing specific → must not dismiss unrelated captures.
    expect(matchRemovals(existing, [{ label: "the event dropped" }])).toEqual([]);
  });
});

describe("buildScrapeCaptures", () => {
  const props = (arr: ScrapeProposal[]) => buildScrapeCaptures({ id: "e1" }, "C1", arr);

  it("gives distinct ids to several same-home captures from ONE message (no collision)", () => {
    // A brief announcing multiple plan decisions in one message must not collapse to one row.
    const caps = props([
      { home: "plan", summary: "jazz set to start", sourceTs: "1.1" },
      { home: "plan", summary: "band with singer later", sourceTs: "1.1" },
      { home: "plan", summary: "electro-lounge playlist between sets", sourceTs: "1.1" },
    ]);
    const ids = caps.map((c) => c.id);
    expect(new Set(ids).size).toBe(3);
    expect(ids.every((id) => id.startsWith("e1:C1:1.1:plan:"))).toBe(true);
  });

  it("is deterministic — same message+summary → same id (idempotent re-scrape)", () => {
    const p: ScrapeProposal[] = [{ home: "budget", summary: "Robot dog rental", detail: "$1,500 paid", sourceTs: "2.2" }];
    expect(props(p)[0].id).toBe(props(p)[0].id);
    expect(props(p)[0].id).toBe(`${captureId("e1", "C1", "2.2", "budget")}:${summarySlug("Robot dog rental")}`);
  });

  it("drops proposals missing a sourceTs or summary", () => {
    const caps = props([
      { home: "plan", summary: "", sourceTs: "3.3" },
      { home: "plan", summary: "valid", sourceTs: "" },
      { home: "open", summary: "keep me", sourceTs: "4.4" },
    ]);
    expect(caps.map((c) => c.summary)).toEqual(["keep me"]);
  });
});

describe("summarySlug", () => {
  it("lowercases, hyphenates, trims, and never returns empty", () => {
    expect(summarySlug("Robot Dog Rental!")).toBe("robot-dog-rental");
    expect(summarySlug("  $1,500  ")).toBe("1-500");
    expect(summarySlug("!!!")).toBe("x");
  });
});

describe("matchPeople", () => {
  const person = (name: string, extra: Partial<ScrapePerson> = {}): ScrapePerson => ({ name, note: "", sourceTs: "1.1", ...extra });
  const roster = [{ id: "a1", name: "Kavir Auluck" }, { id: "a2", name: "Omar Hayat" }];

  it("splits into clear name-matches (case/space-insensitive) and no-matches", () => {
    const { matched, unmatched } = matchPeople(
      [person("kavir  auluck"), person("Nobody New")], roster,
    );
    expect(matched.map((m) => [m.person.name, m.attendeeId])).toEqual([["kavir  auluck", "a1"]]);
    expect(unmatched.map((u) => u.name)).toEqual(["Nobody New"]);
  });

  it("dedups a person named in several messages within one scrape (first wins)", () => {
    const { matched, unmatched } = matchPeople(
      [person("Someone Else", { sourceTs: "1.1" }), person("someone else", { sourceTs: "2.2" })], roster,
    );
    expect(matched).toEqual([]);
    expect(unmatched).toHaveLength(1);
    expect(unmatched[0].sourceTs).toBe("1.1");
  });
});

describe("normalizeName", () => {
  it("trims, lowercases, and collapses whitespace", () => {
    expect(normalizeName("  Kavir   Auluck ")).toBe("kavir auluck");
  });
});

describe("candidateNote", () => {
  it("joins interest, quoted message, and a Slack link", () => {
    const p: ScrapePerson = { name: "Kavir", note: "wants SWE intern", sourceQuote: "interested in SWE intern", sourceTs: "1.1" };
    expect(candidateNote(p, "https://slack/x")).toBe('wants SWE intern\n“interested in SWE intern”\n— via Slack: https://slack/x');
  });
  it("omits missing parts and a null permalink", () => {
    expect(candidateNote({ name: "X", note: "just met", sourceTs: "1.1" }, null)).toBe("just met");
  });
});

describe("buildPeopleNoMatch", () => {
  it("builds 'people' captures keyed on ts+name slug, carrying linkedin + noMatch flag", () => {
    const caps = buildPeopleNoMatch({ id: "e1" }, "C1",
      [{ name: "Adina T.", note: "UX masters", linkedin: "https://li/adina", sourceTs: "9.9" }],
      { "9.9": "https://slack/p9" });
    expect(caps).toHaveLength(1);
    expect(caps[0].home).toBe("people");
    expect(caps[0].summary).toBe("Adina T.");
    expect(caps[0].detail).toBe("UX masters");
    expect(caps[0].source_ref).toBe("https://slack/p9");
    expect(caps[0].flags).toEqual({ noMatch: true, linkedin: "https://li/adina" });
    expect(caps[0].id).toBe(`${captureId("e1", "C1", "9.9", "people")}:adina-t`);
  });
});

describe("meetingsToNudge", () => {
  const ev = (id: string, date: string | null, nudged: string | null = null) => ({ id, name: id, event_date: date, transcript_nudged_at: nudged });
  it("picks events that have happened and weren't nudged yet", () => {
    const got = meetingsToNudge([
      ev("past", "2026-09-20"),                          // happened, not nudged → yes
      ev("today", "2026-09-22"),                         // today → yes
      ev("future", "2026-09-30"),                        // not yet → no
      ev("already", "2026-09-01", "2026-09-02T00:00:00Z"), // nudged → no
      ev("nodate", null),                                // no date → no
    ], "2026-09-22");
    expect(got.map((e) => e.id)).toEqual(["past", "today"]);
  });
});

describe("transcriptNudgeText", () => {
  it("names the event + date and invites a paste into the channel", () => {
    const t = transcriptNudgeText("UofT Career Fair", "2026-09-22");
    expect(t).toContain("UofT Career Fair");
    expect(t).toContain("2026-09-22");
    expect(t.toLowerCase()).toContain("transcript");
  });
});

describe("HOME_LABEL", () => {
  it("maps homes to display labels", () => {
    expect(HOME_LABEL).toMatchObject({ plan: "Plan", person: "Who", open: "Still open", budget: "Budget" });
  });
});
