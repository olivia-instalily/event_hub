import { describe, it, expect } from "vitest";
import { visibleFlags, flagEngaged, SETUP_FLAG_KEYS } from "./setupFlags";

const base = {
  date: null, headcount: null, owners: [] as { id: string; name: string; color: string | null }[],
  eventBudgetTarget: null, budget: null as any, deliverables: [] as any[], setupProgress: [] as string[],
};

describe("setupFlags", () => {
  it("shows all five flags for a blank event", () => {
    expect(visibleFlags(base).sort()).toEqual([...SETUP_FLAG_KEYS].sort());
  });
  it("date flag clears once a date is set", () => {
    expect(flagEngaged({ ...base, date: "2026-08-01" }, "date")).toBe(true);
    expect(visibleFlags({ ...base, date: "2026-08-01" })).not.toContain("date");
  });
  it("headcount flag clears once headcount is set", () => {
    expect(visibleFlags({ ...base, headcount: 100 })).not.toContain("headcount");
  });
  it("owners flag needs a SECOND owner (creator is auto-added)", () => {
    const one = [{ id: "a", name: "A", color: null }];
    const two = [...one, { id: "b", name: "B", color: null }];
    expect(flagEngaged({ ...base, owners: one }, "owners")).toBe(false);
    expect(flagEngaged({ ...base, owners: two }, "owners")).toBe(true);
  });
  it("budget flag clears on an overall target OR any line target/amount", () => {
    expect(visibleFlags({ ...base, eventBudgetTarget: 5000 })).not.toContain("budget");
    expect(visibleFlags({ ...base, budget: { id: "b", currency: "USD", targetAmount: null, lines: [{ id: "l", label: "AV", confirmedAmount: 10, target: null, status: "planned", syncUrl: null, docUrl: null, note: null, linkedEngagement: null }] } as any })).not.toContain("budget");
  });
  it("timeline flag clears once a deliverable exists", () => {
    expect(visibleFlags({ ...base, deliverables: [{ id: "d" } as any] })).not.toContain("timeline");
  });
  it("a settled flag is hidden even when not engaged", () => {
    expect(visibleFlags({ ...base, setupProgress: ["date"] })).not.toContain("date");
  });
});
