import { describe, it, expect } from "vitest";
import { categoryHeader, budgetRollup } from "./budgetModel";

const L = (status: any, amount: number | null) => ({ status, amount });

describe("categoryHeader — sum of the most advanced stage present", () => {
  it("any paid → sum of paid rows (green); more-advanced wins over quoted", () => {
    const h = categoryHeader([L("paid", 300), L("paid", 250), L("quoted", 999)]);
    expect(h.kind).toBe("paid");
    expect(h.value).toBe(550);
  });
  it("no paid, quoted present → sum of quoted rows", () => {
    const h = categoryHeader([L("quoted", 60), L("quoted", 90), L("estimate", 5)]);
    expect(h.kind).toBe("quoted");
    expect(h.value).toBe(150);
  });
  it("only estimate rows → sum of estimates", () => {
    const h = categoryHeader([L("estimate", 100), L("estimate", 50)]);
    expect(h.kind).toBe("estimate");
    expect(h.value).toBe(150);
  });
  it("nothing with an amount → empty", () => {
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
