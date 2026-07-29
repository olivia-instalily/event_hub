import { describe, it, expect } from "vitest";
import { PHASES, phaseForTiming, nextTagSelection } from "./phases";

describe("phases", () => {
  it("has exactly the three phase keys in order", () => {
    expect(PHASES).toEqual(["planning", "day-of", "post"]);
  });
  it("phaseForTiming uses offset first", () => {
    expect(phaseForTiming(-5, null, "2026-08-01")).toBe("planning");
    expect(phaseForTiming(0, null, "2026-08-01")).toBe("day-of");
    expect(phaseForTiming(3, null, "2026-08-01")).toBe("post");
  });
  it("phaseForTiming falls back to due vs event date", () => {
    expect(phaseForTiming(null, "2026-07-30", "2026-08-01")).toBe("planning");
    expect(phaseForTiming(null, "2026-08-01", "2026-08-01")).toBe("day-of");
    expect(phaseForTiming(null, "2026-08-05", "2026-08-01")).toBe("post");
  });
  it("phaseForTiming defaults to planning when undated/unknown", () => {
    expect(phaseForTiming(null, null, null)).toBe("planning");
  });
  it("nextTagSelection is single-select with deselect", () => {
    expect(nextTagSelection(null, "Venue")).toBe("Venue");   // select
    expect(nextTagSelection("Venue", "Marketing")).toBe("Marketing"); // replace
    expect(nextTagSelection("Venue", "Venue")).toBe(null);   // deselect → all
  });
});
