import { describe, it, expect } from "vitest";
import { slugifyChannel } from "../src/lib/slackChannel";

describe("slugifyChannel", () => {
  it("lowercases, prefixes evt-, and hyphenates spaces", () => {
    expect(slugifyChannel("Toronto Summit")).toBe("evt-toronto-summit");
  });
  it("strips punctuation and collapses repeats", () => {
    expect(slugifyChannel("Q3  Client   Dinner!!")).toBe("evt-q3-client-dinner");
  });
  it("trims leading/trailing hyphens from the slug body", () => {
    expect(slugifyChannel("  --Kickoff--  ")).toBe("evt-kickoff");
  });
  it("drops non-ascii", () => {
    expect(slugifyChannel("Café Résumé")).toBe("evt-caf-rsum");
  });
  it("caps total length at 80 chars", () => {
    expect(slugifyChannel("x".repeat(200)).length).toBeLessThanOrEqual(80);
  });
  it("falls back to evt-event when nothing usable remains", () => {
    expect(slugifyChannel("!!!")).toBe("evt-event");
  });
});
