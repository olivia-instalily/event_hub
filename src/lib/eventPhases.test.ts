import { describe, it, expect } from "vitest";
import { defaultPhases } from "./eventPhases";
const today = new Date().toISOString().slice(0, 10);
const past = "2020-01-01";
const future = "2999-01-01";
describe("defaultPhases", () => {
  it("past date → single Wrap", () => { expect(defaultPhases(past)).toEqual([{ name: "Wrap", order: 0 }]); });
  it("future date → Plan, Day-of, Wrap", () => { expect(defaultPhases(future)).toEqual([{ name: "Plan", order: 0 }, { name: "Day-of", order: 1 }, { name: "Wrap", order: 2 }]); });
  it("undated → Plan, Day-of, Wrap", () => { expect(defaultPhases(null)).toEqual([{ name: "Plan", order: 0 }, { name: "Day-of", order: 1 }, { name: "Wrap", order: 2 }]); });
  it("today → Plan, Day-of, Wrap (not past)", () => { expect(defaultPhases(today)).toEqual([{ name: "Plan", order: 0 }, { name: "Day-of", order: 1 }, { name: "Wrap", order: 2 }]); });
});
