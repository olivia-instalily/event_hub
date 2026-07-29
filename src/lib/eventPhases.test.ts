import { describe, it, expect } from "vitest";
import { defaultPhases } from "./eventPhases";
const today = new Date().toISOString().slice(0, 10);
const past = "2020-01-01";
const future = "2999-01-01";
describe("defaultPhases", () => {
  it("past date → single Post", () => { expect(defaultPhases(past)).toEqual([{ name: "Post", order: 0 }]); });
  it("future date → Planning, Day-of, Post", () => { expect(defaultPhases(future)).toEqual([{ name: "Planning", order: 0 }, { name: "Day-of", order: 1 }, { name: "Post", order: 2 }]); });
  it("undated → Planning, Day-of, Post", () => { expect(defaultPhases(null)).toEqual([{ name: "Planning", order: 0 }, { name: "Day-of", order: 1 }, { name: "Post", order: 2 }]); });
  it("today → Planning, Day-of, Post (not past)", () => { expect(defaultPhases(today)).toEqual([{ name: "Planning", order: 0 }, { name: "Day-of", order: 1 }, { name: "Post", order: 2 }]); });
});
