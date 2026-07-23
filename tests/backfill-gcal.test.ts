import { describe, expect, test } from "vitest";
// The backfill classifier is a plain-JS module (the runner is a standalone .mjs script,
// like scripts/luma-sync.mjs). We test its pure decision logic here.
// @ts-expect-error — .mjs module without types
import { classify, nameSimilar, isOwned } from "../scripts/backfill-gcal.classify.mjs";

// A GCal list item as the Calendar API returns it (all-day form unless noted).
const cand = (over: Partial<Record<string, unknown>> = {}) => ({
  id: "g1",
  summary: "Founder Dinner",
  description: "",
  start: { date: "2026-03-10" },
  end: { date: "2026-03-11" },
  htmlLink: "https://cal/g1",
  ...over,
});

const ev = (over: Partial<Record<string, unknown>> = {}) => ({
  name: "Founder Dinner",
  event_date: "2026-03-10",
  start_time: null,
  end_time: null,
  location: null,
  ...over,
});

describe("nameSimilar", () => {
  test("token containment matches regardless of extra words", () => {
    expect(nameSimilar("Founder Dinner", "Founder Dinner · NYC")).toBe(true);
  });
  test("unrelated titles do not match", () => {
    expect(nameSimilar("Founder Dinner", "Banana Split")).toBe(false);
  });
});

describe("isOwned", () => {
  test("true when the EventHub marker is present", () => {
    expect(isOwned("some notes\n\nEventHub: https://app/?event=abc")).toBe(true);
  });
  test("false for a plain description", () => {
    expect(isOwned("some notes")).toBe(false);
  });
});

describe("classify", () => {
  test("no candidates in the window → create", () => {
    const r = classify(ev(), []);
    expect(r.bucket).toBe("create");
  });

  test("exactly one same-name same-date candidate → confident link", () => {
    const r = classify(ev(), [cand()]);
    expect(r.bucket).toBe("confident");
    expect(r.candidate.id).toBe("g1");
  });

  test("candidate off by a day → ambiguous (never auto-touched)", () => {
    const r = classify(ev(), [cand({ start: { date: "2026-03-11" }, end: { date: "2026-03-12" } })]);
    expect(r.bucket).toBe("ambiguous");
    expect(r.candidates).toHaveLength(1);
  });

  test("weak Jaccard-only overlap (no full containment) → ambiguous", () => {
    // 2 of 3 tokens shared → Jaccard 0.5 passes nameSimilar, but not full containment.
    const r = classify(ev({ name: "Spring Founder Mixer" }), [cand({ summary: "Fall Founder Mixer" })]);
    expect(r.bucket).toBe("ambiguous");
  });

  test("two matching candidates → ambiguous", () => {
    const r = classify(ev(), [cand({ id: "g1" }), cand({ id: "g2", htmlLink: "https://cal/g2" })]);
    expect(r.bucket).toBe("ambiguous");
    expect(r.candidates).toHaveLength(2);
  });

  test("only candidate already owned by EventHub → treated as create (skip owned)", () => {
    const r = classify(ev(), [cand({ description: "EventHub: https://app/?event=xyz" })]);
    expect(r.bucket).toBe("create");
  });

  test("timed event overlapping a timed candidate, same name/date → confident", () => {
    const r = classify(
      ev({ start_time: "18:00", end_time: "20:00" }),
      [cand({ start: { dateTime: "2026-03-10T18:30:00-05:00" }, end: { dateTime: "2026-03-10T21:00:00-05:00" } })],
    );
    expect(r.bucket).toBe("confident");
  });

  test("ambiguous reason names the day-off case", () => {
    const r = classify(ev(), [cand({ start: { date: "2026-03-11" }, end: { date: "2026-03-12" } })]);
    expect(r.reason).toMatch(/day/i);
  });

  test("ambiguous reason names the multiple-match case", () => {
    const r = classify(ev(), [cand({ id: "g1" }), cand({ id: "g2" })]);
    expect(r.reason).toMatch(/2 possible|multiple/i);
  });

  test("ambiguous reason names the loose-title case", () => {
    const r = classify(ev({ name: "Spring Founder Mixer" }), [cand({ summary: "Fall Founder Mixer" })]);
    expect(r.reason).toMatch(/loosely|title/i);
  });
});
