import { afterEach, describe, expect, it } from "vitest";
import {
  parseDeepLink,
  buildEventDeepLink,
  buildAppLink,
  locationSearch,
  setPendingScopingBudget,
  takePendingScopingBudget,
} from "../src/lib/deepLink";

describe("parseDeepLink", () => {
  it("reads the event id and budget view off the query string", () => {
    expect(parseDeepLink("?event=evt_123&view=budget")).toEqual({ page: null, eventId: "evt_123", seriesId: null, view: "budget", tab: null });
  });

  it("accepts a leading '?' or not", () => {
    expect(parseDeepLink("event=evt_9")).toEqual({ page: null, eventId: "evt_9", seriesId: null, view: null, tab: null });
  });

  it("reads a series id and optional tab", () => {
    expect(parseDeepLink("?series=ser_1&tab=people")).toEqual({ page: null, eventId: null, seriesId: "ser_1", view: null, tab: "people" });
  });

  it("reads a known top-level page and ignores unknown pages", () => {
    expect(parseDeepLink("?page=calendar")?.page).toBe("calendar");
    expect(parseDeepLink("?page=nonsense")).toBeNull();
  });

  it("returns null when it targets nothing", () => {
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

describe("locationSearch", () => {
  it("is empty on home", () => {
    expect(locationSearch({ page: "home", eventId: null, seriesId: null })).toBe("");
  });
  it("prefers an open event over everything", () => {
    expect(locationSearch({ page: "series", eventId: "e1", seriesId: "s1" })).toBe("?event=e1");
  });
  it("encodes a selected series and its tab", () => {
    expect(locationSearch({ page: "series", eventId: null, seriesId: "s1", seriesTab: "budget" })).toBe("?series=s1&tab=budget");
  });
  it("encodes a plain top-level page", () => {
    expect(locationSearch({ page: "calendar", eventId: null, seriesId: null })).toBe("?page=calendar");
  });
  it("round-trips a series link through parseDeepLink", () => {
    const s = locationSearch({ page: "series", eventId: null, seriesId: "s9", seriesTab: "people" });
    expect(parseDeepLink(s)).toMatchObject({ seriesId: "s9", tab: "people" });
  });
});

describe("buildAppLink", () => {
  it("joins origin + search without a double slash", () => {
    expect(buildAppLink("https://x.io/", { page: "events", eventId: "e1", seriesId: null })).toBe("https://x.io/?event=e1");
    expect(buildAppLink("https://x.io", { page: "home", eventId: null, seriesId: null })).toBe("https://x.io/");
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
    expect(parseDeepLink(search)).toMatchObject({ eventId: "evt_round", view: "budget" });
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
