import { describe, it, expect } from "vitest";
import { dedupeCategories } from "./vendorCategories";

describe("dedupeCategories", () => {
  it("trims, drops blanks/nulls, and sorts case-insensitively", () => {
    expect(dedupeCategories(["  Venue ", "", null, "AV", undefined, "  "])).toEqual(["AV", "Venue"]);
  });
  it("de-dupes case-insensitively, keeping the first-seen casing", () => {
    expect(dedupeCategories(["Catering", "catering", "CATERING"])).toEqual(["Catering"]);
  });
});
