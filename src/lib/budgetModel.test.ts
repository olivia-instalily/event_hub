import { describe, it, expect } from "vitest";
import { categoryHeader, budgetRollup } from "./budgetModel";

const L = (status: any, amount: number | null) => ({ status, amount });

describe("categoryHeader ladder (estimate is a separate goal, never fills the header)", () => {
  it("sums paid rows → actual (green)", () => {
    const h = categoryHeader([L("paid", 300), L("paid", 250), L("quoted", 999)]);
    expect(h.kind).toBe("actual");
    expect(h.value).toBe(550);
    expect(h.pendingCount).toBe(1); // the still-quoted row
  });
  it("no paid, quotes → range (amber) — quotes drive the header, not the estimate", () => {
    const h = categoryHeader([L("quoted", 60), L("quoted", 90)]);
    expect(h.kind).toBe("range");
    expect(h.value).toBe(60);
    expect(h.rangeHigh).toBe(90);
  });
  it("single quote → range collapses to one value", () => {
    const h = categoryHeader([L("quoted", 75)]);
    expect(h.kind).toBe("range");
    expect(h.value).toBe(75);
    expect(h.rangeHigh).toBe(75);
  });
  it("nothing concrete → empty", () => {
    expect(categoryHeader([]).kind).toBe("empty");
    expect(categoryHeader([L("estimate", null)]).kind).toBe("empty");
  });
});

describe("budgetRollup", () => {
  it("buckets each row by its own status; committed = quoted + paid", () => {
    const r = budgetRollup([L("paid", 300), L("quoted", 250), L("estimate", 100), L("paid", 50)]);
    expect(r).toEqual({ estimate: 100, quoted: 250, paid: 350, committed: 600 });
  });
});
