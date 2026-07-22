import { describe, it, expect } from "vitest";
import { gcalTitle, isEligible, timeOverlap, nameSimilar, isOwned } from "./gcal-helpers.js";

describe("gcalTitle", () => {
  it("joins name and location with a middle dot", () => { expect(gcalTitle("Hackathon", "Waterloo")).toBe("Hackathon · Waterloo"); });
  it("drops the separator with no location", () => { expect(gcalTitle("Hackathon", null)).toBe("Hackathon"); expect(gcalTitle("Hackathon", "  ")).toBe("Hackathon"); });
  it("falls back to 'Untitled event' for a null name", () => { expect(gcalTitle(null, null)).toBe("Untitled event"); expect(gcalTitle(null, "SF")).toBe("Untitled event · SF"); });
});
describe("isEligible", () => {
  it("dated non-template → true", () => { expect(isEligible({ event_date: "2026-09-01", is_template: false })).toBe(true); });
  it("undated → false; template → false", () => {
    expect(isEligible({ event_date: null, is_template: false })).toBe(false);
    expect(isEligible({ event_date: "2026-09-01", is_template: true })).toBe(false);
  });
});
describe("timeOverlap", () => {
  it("all-day same day overlaps", () => { expect(timeOverlap({ start: "2026-09-01", end: "2026-09-02", allDay: true }, { start: "2026-09-01", end: "2026-09-02", allDay: true })).toBe(true); });
  it("timed overlap vs disjoint", () => {
    expect(timeOverlap({ start: "2026-09-01T09:00:00", end: "2026-09-01T11:00:00", allDay: false }, { start: "2026-09-01T10:00:00", end: "2026-09-01T12:00:00", allDay: false })).toBe(true);
    expect(timeOverlap({ start: "2026-09-01T09:00:00", end: "2026-09-01T10:00:00", allDay: false }, { start: "2026-09-01T11:00:00", end: "2026-09-01T12:00:00", allDay: false })).toBe(false);
  });
  it("adjacent spans (a.end == b.start) do NOT overlap (half-open)", () => {
    expect(timeOverlap({ start: "2026-09-01T09:00:00", end: "2026-09-01T10:00:00", allDay: false }, { start: "2026-09-01T10:00:00", end: "2026-09-01T11:00:00", allDay: false })).toBe(false);
  });
});
describe("nameSimilar", () => {
  it("matches near-identical / contained titles", () => {
    expect(nameSimilar("NYC Run Club", "nyc run club")).toBe(true);
    expect(nameSimilar("Waterloo Hackathon 2026", "Waterloo Hackathon")).toBe(true);
  });
  it("matches on Jaccard overlap without containment", () => { expect(nameSimilar("AI Founders Dinner", "AI Founders Brunch")).toBe(true); });
  it("rejects unrelated titles", () => { expect(nameSimilar("NYC Run Club", "Toronto Investor Dinner")).toBe(false); });
  it("does not false-positive on concatenated-letter substrings", () => { expect(nameSimilar("Ana", "Banana Split")).toBe(false); });
});
describe("isOwned", () => {
  it("true when the EventHub marker is present", () => { expect(isOwned("Fun\n\nEventHub: https://app/?event=e1")).toBe(true); });
  it("false otherwise", () => { expect(isOwned("just a normal event")).toBe(false); expect(isOwned(null)).toBe(false); });
});
