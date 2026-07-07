import { describe, expect, it } from "vitest";
import { buildScopingSummary, emptyScoping } from "../src/lib/scoping";

const base = {
  title: "Q3 Client Dinner",
  date: "2026-09-01",
  tags: ["Client Briefing"],
  scoping: { ...emptyScoping(), type: "Dinner", audience: "Clients", headcount: "20", strategicJustification: "It matters." },
  roughTotal: 8000,
};

describe("buildScopingSummary — Slack deep link (CTA)", () => {
  it("embeds a Slack mrkdwn link when a link is provided", () => {
    const link = "https://app.example.com/?event=evt_1&view=budget";
    const out = buildScopingSummary({ ...base, link });
    expect(out).toContain(`<${link}|Review & assign budget →>`);
  });

  it("omits the CTA line entirely when no link is provided (still valid)", () => {
    const out = buildScopingSummary(base);
    expect(out).not.toContain("Review & assign budget");
    // The rest of the summary is unaffected.
    expect(out).toContain("*Scoping request — Q3 Client Dinner*");
    expect(out).toContain("*Requested budget:*");
  });
});
