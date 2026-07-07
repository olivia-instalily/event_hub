import { afterEach, describe, expect, it } from "vitest";
import {
  parseDeepLink,
  buildEventDeepLink,
  setPendingScopingBudget,
  takePendingScopingBudget,
} from "../src/lib/deepLink";

describe("parseDeepLink", () => {
  it("reads the event id and budget view off the query string", () => {
    expect(parseDeepLink("?event=evt_123&view=budget")).toEqual({ eventId: "evt_123", view: "budget" });
  });

  it("accepts a leading '?' or not", () => {
    expect(parseDeepLink("event=evt_9")).toEqual({ eventId: "evt_9", view: null });
  });

  it("returns null when there is no event id", () => {
    expect(parseDeepLink("")).toBeNull();
    expect(parseDeepLink("?view=budget")).toBeNull();
    expect(parseDeepLink("?foo=bar")).toBeNull();
  });

  it("only recognizes the budget view; anything else is null", () => {
    expect(parseDeepLink("?event=e1&view=people")?.view).toBeNull();
    expect(parseDeepLink("?event=e1")?.view).toBeNull();
  });

  it("url-decodes the event id", () => {
    expect(parseDeepLink("?event=evt%20a&view=budget")?.eventId).toBe("evt a");
  });
});

describe("buildEventDeepLink", () => {
  it("builds <origin>/?event=<id>&view=budget", () => {
    expect(buildEventDeepLink("https://app.example.com", "evt_123")).toBe(
      "https://app.example.com/?event=evt_123&view=budget",
    );
  });

  it("does not double the slash when origin has a trailing slash", () => {
    expect(buildEventDeepLink("https://app.example.com/", "e1")).toBe(
      "https://app.example.com/?event=e1&view=budget",
    );
  });

  it("url-encodes a funny event id", () => {
    expect(buildEventDeepLink("https://x.io", "a b")).toBe("https://x.io/?event=a+b&view=budget");
  });

  it("round-trips through parseDeepLink", () => {
    const url = buildEventDeepLink("https://x.io", "evt_round");
    const search = url.slice(url.indexOf("?"));
    expect(parseDeepLink(search)).toEqual({ eventId: "evt_round", view: "budget" });
  });
});

describe("pending scoping intent (one-shot)", () => {
  afterEach(() => setPendingScopingBudget(null));

  it("is consumed exactly once, and only by the matching event", () => {
    setPendingScopingBudget("evt_1");
    expect(takePendingScopingBudget("evt_other")).toBe(false); // wrong event: leave it
    expect(takePendingScopingBudget("evt_1")).toBe(true); // matching event: consume
    expect(takePendingScopingBudget("evt_1")).toBe(false); // already consumed: don't re-open
  });

  it("defaults to no pending intent", () => {
    expect(takePendingScopingBudget("anything")).toBe(false);
  });
});
