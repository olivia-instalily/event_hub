import { describe, it, expect } from "vitest";
import { captureId, resolveEvent, contextBounds, detectConflict, buildCaptures, composeEphemeral,
  type EventRow, type SlackMsg, type Proposal } from "./slack-capture-lib.js";

const ev = (id: string, ch: string | null, date: string | null = null): EventRow => ({ id, slack_channel: ch, event_date: date, name: id });

describe("captureId", () => {
  it("is deterministic per (event,channel,ts,type)", () => {
    expect(captureId("e1", "C1", "111.2", "budget")).toBe("e1:C1:111.2:budget");
    expect(captureId("e1", "C1", "111.2", "budget")).toBe(captureId("e1", "C1", "111.2", "budget"));
  });
});

describe("resolveEvent", () => {
  it("returns null when no event is linked to the channel", () => {
    expect(resolveEvent([ev("e1", "CX")], "C1")).toBeNull();
  });
  it("returns the single linked event", () => {
    expect(resolveEvent([ev("e1", "C1"), ev("e2", "CX")], "C1")?.id).toBe("e1");
  });
  it("picks the most recent by event_date when several share the channel", () => {
    const got = resolveEvent([ev("old", "C1", "2026-01-01"), ev("new", "C1", "2026-09-01")], "C1");
    expect(got?.id).toBe("new");
  });
});

describe("contextBounds", () => {
  const msg = (ts: string, text = "m"): SlackMsg => ({ ts, text });
  it("caps to CTX_MAX messages, keeping the pin", () => {
    const msgs = Array.from({ length: 50 }, (_, i) => msg(String(1000 + i)));
    const out = contextBounds(msgs, "1030", 1_000_000 * 1000);
    expect(out.length).toBeLessThanOrEqual(30);
    expect(out.some((m) => m.ts === "1030")).toBe(true);
  });
  it("drops messages older than the 3h span from the pin", () => {
    const pinSec = 1_000_000;
    const msgs = [msg(String(pinSec - 4 * 3600)), msg(String(pinSec - 60)), msg(String(pinSec))];
    const out = contextBounds(msgs, String(pinSec), pinSec * 1000);
    expect(out.find((m) => m.ts === String(pinSec - 4 * 3600))).toBeUndefined();
    expect(out.length).toBe(2);
  });
});

describe("detectConflict", () => {
  it("flags a budget proposal when a budget is already committed", () => {
    expect(detectConflict({ type: "budget", payload: { amount: 4000 } }, { budget: true })).toEqual({ field: "budget" });
  });
  it("returns null when no conflict", () => {
    expect(detectConflict({ type: "note", payload: { text: "x" } }, { budget: true })).toBeNull();
    expect(detectConflict({ type: "budget", payload: { amount: 1 } }, { budget: false })).toBeNull();
  });
});

describe("buildCaptures", () => {
  const props: Proposal[] = [
    { type: "note", payload: { text: "kickoff moved" }, confidence: 0.9, contextTs: { first: "1", last: "2" } },
    { type: "budget", payload: { amount: 4000 }, confidence: 0.7 },
  ];
  it("stamps deterministic ids, proposed status, provenance, and conflict flags", () => {
    const caps = buildCaptures(ev("e1", "C1"), "C1", "111.2", "U9", "https://link", props, { budget: true });
    expect(caps).toHaveLength(2);
    expect(caps[0]).toMatchObject({ id: "e1:C1:111.2:note", event_id: "e1", status: "proposed", reactor_user: "U9", source_ref: "https://link" });
    const budget = caps.find((c) => c.type === "budget")!;
    expect(budget.flags).toEqual({ conflict: { field: "budget" } });
  });
});

describe("composeEphemeral", () => {
  it("lists captures and surfaces ambiguity/conflict for the reactor", () => {
    const caps = buildCaptures(ev("e1", "C1"), "C1", "1.2", "U9", null,
      [{ type: "budget", payload: { amount: 4000 }, ambiguity: { question: "$4k — budget or venue cost?" } }], { budget: true });
    const text = composeEphemeral("Toronto Summit", caps);
    expect(text).toContain("Toronto Summit");
    expect(text).toContain("budget");
    expect(text).toMatch(/budget or venue cost/);
    expect(text).toMatch(/already set|won't overwrite|conflict/i);
  });
});
