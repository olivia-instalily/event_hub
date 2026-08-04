import { describe, it, expect } from "vitest";
import { parseSlashCommand, buildEventContext, type EventFacts, type DeliverableFact, type BudgetFact } from "./slack-command.js";

describe("parseSlashCommand", () => {
  it("pulls the question, channel, and response_url out of the urlencoded body", () => {
    const raw = "command=%2Feventhub&text=what%27s+the+plan+for+day+of%3F&channel_id=C123&user_id=U9&response_url=https%3A%2F%2Fhooks.slack.com%2Fabc";
    const c = parseSlashCommand(raw);
    expect(c.command).toBe("/eventhub");
    expect(c.text).toBe("what's the plan for day of?");
    expect(c.channelId).toBe("C123");
    expect(c.userId).toBe("U9");
    expect(c.responseUrl).toBe("https://hooks.slack.com/abc");
  });
  it("trims and tolerates a missing text", () => {
    expect(parseSlashCommand("command=%2Feventhub&text=+&channel_id=C1").text).toBe("");
  });
});

const facts = (o: Partial<EventFacts> = {}): EventFacts => ({
  name: "Series B Celebration", event_date: "2026-09-20", start_time: "18:00", end_time: "22:00",
  location: "Ace Hotel", office: null, status: "planning", macro_stage: null, headcount: 120, rsvp: null,
  capacity: null, why: null, verdict: null, overview_summary: null, agenda: null, staff_roles: null,
  role_assignments: null, plan_items: null, reflections: null,
  luma_url: null, live_url: null, preview_url: null, info_url: null, gcal_html_link: null, doc_link: null, ...o,
});

describe("buildEventContext", () => {
  it("always includes basics and reflects the values", () => {
    const ctx = buildEventContext(facts(), [], []);
    expect(ctx).toContain("## Event basics");
    expect(ctx).toContain("Series B Celebration");
    expect(ctx).toContain("Ace Hotel");
    expect(ctx).toContain("Headcount: 120");
  });
  it("renders run of show, staffing, budget, and notes when present", () => {
    const ctx = buildEventContext(
      facts({
        agenda: [{ time: "6:00 PM", title: "Doors" }, { time: "7:00 PM", title: "Toast" }],
        staff_roles: ["check-in", "bar"], role_assignments: { "check-in": "Olivia" },
        plan_items: [{ text: "Fireside not a panel" }],
      }),
      [{ title: "Merch ordered", status: "Done", phase: "Day-of", resolved_due_date: null }],
      [{ label: "bar", confirmed_amount: 800, payment_status: "quoted", vendor_name: "Thurman" }],
    );
    expect(ctx).toContain("## Run of show");
    expect(ctx).toContain("6:00 PM — Doors");
    expect(ctx).toContain("check-in — Olivia");
    expect(ctx).toContain("## Deliverables");
    expect(ctx).toContain("Merch ordered [Done]");
    expect(ctx).toContain("vendor: Thurman");
    expect(ctx).toContain("$800");
    expect(ctx).toContain("Fireside not a panel");
  });
  it("lists the event's URLs so 'what's the URL' is answerable (live page preferred over preview)", () => {
    const ctx = buildEventContext(facts({ luma_url: "https://lu.ma/abc", live_url: "https://event.example/live", preview_url: "https://event.example/preview", info_url: "https://info.example" }), [], []);
    expect(ctx).toContain("## Links / URLs");
    expect(ctx).toContain("https://lu.ma/abc");
    expect(ctx).toContain("Live page: https://event.example/live");
    expect(ctx).not.toContain("preview"); // live present → preview suppressed
    expect(ctx).toContain("https://info.example");
  });
  it("omits sections that have no data (so 'not stated' stays absent)", () => {
    const ctx = buildEventContext(facts(), [], []);
    expect(ctx).not.toContain("## Run of show");
    expect(ctx).not.toContain("## Budget");
    expect(ctx).not.toContain("## Staffing");
    expect(ctx).not.toContain("## Learnings");
  });
});
