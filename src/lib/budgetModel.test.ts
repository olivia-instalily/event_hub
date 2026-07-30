import { describe, it, expect } from "vitest";
import { categoryHeader, budgetRollup } from "./budgetModel";

const L = (status: any, amount: number | null) => ({ status, amount });

describe("categoryHeader ladder", () => {
  it("sums paid rows → actual (green)", () => {
    const h = categoryHeader([L("paid", 300), L("paid", 250), L("quoted", 999)], 500);
    expect(h.kind).toBe("actual");
    expect(h.value).toBe(550);
    expect(h.estWas).toBe(500); // original estimate persists as a hint
    expect(h.pendingCount).toBe(1); // the still-quoted row
  });
  it("typed estimate holds over quotes when nothing paid → estimate (grey)", () => {
    const h = categoryHeader([L("quoted", 60), L("quoted", 90)], 600);
    expect(h.kind).toBe("estimate");
    expect(h.value).toBe(600);
    expect(h.estWas).toBeNull(); // not superseded → no "was" hint
  });
  it("no paid, no estimate, quotes → range (amber)", () => {
    const h = categoryHeader([L("quoted", 60), L("quoted", 90)], null);
    expect(h.kind).toBe("range");
    expect(h.value).toBe(60);
    expect(h.rangeHigh).toBe(90);
  });
  it("single quote with no estimate → range collapses to one value", () => {
    const h = categoryHeader([L("quoted", 75)], null);
    expect(h.kind).toBe("range");
    expect(h.value).toBe(75);
    expect(h.rangeHigh).toBe(75);
  });
  it("nothing → empty", () => {
    expect(categoryHeader([], null).kind).toBe("empty");
    expect(categoryHeader([L("estimate", null)], null).kind).toBe("empty");
  });
});

describe("budgetRollup", () => {
  it("buckets each row by its own status; committed = quoted + paid", () => {
    const r = budgetRollup([L("paid", 300), L("quoted", 250), L("estimate", 100), L("paid", 50)]);
    expect(r).toEqual({ estimate: 100, quoted: 250, paid: 350, committed: 600 });
  });
});
