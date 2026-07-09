// tests/scopingApproval.test.ts
import { describe, expect, it } from "vitest";
import { emptyScoping, scopingToApproval } from "../src/lib/scoping";

describe("scopingToApproval (migrate-on-read bridge)", () => {
  it("returns null for a draft (nothing to migrate)", () => {
    expect(scopingToApproval(emptyScoping())).toBeNull();
  });
  it("maps a submitted record", () => {
    const s = { ...emptyScoping(), status: "submitted" as const, submittedChannel: "#budget" };
    expect(scopingToApproval(s)).toEqual({ status: "submitted", assignedAmount: null, slackChannel: "#budget" });
  });
  it("maps an assigned record, carrying the assigned amount", () => {
    const s = { ...emptyScoping(), status: "assigned" as const, assignedBudget: 8000, submittedChannel: "#budget" };
    expect(scopingToApproval(s)).toEqual({ status: "assigned", assignedAmount: 8000, slackChannel: "#budget" });
  });
});
