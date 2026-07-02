import { describe, expect, it } from "vitest";
import { eventFocus } from "../src/lib/eventFocus";

describe("eventFocus", () => {
  it("classifies a run club as neither (engagement, not hiring/client)", () => {
    expect(eventFocus(["Run Club"], "Run")).toBe("neither");
    expect(eventFocus(["Community"])).toBe("neither");
    expect(eventFocus([], null)).toBe("neither");
  });

  it("classifies recruiting events as hiring", () => {
    expect(eventFocus(["Recruiting Fireside"])).toBe("hiring");
    expect(eventFocus(["Campus"], "Career fair")).toBe("hiring");
  });

  it("classifies client/GTM and partner events as client", () => {
    expect(eventFocus(["Client Briefing"])).toBe("client");
    expect(eventFocus(["GTM Dinner"])).toBe("client");
    expect(eventFocus(["Sponsorship"])).toBe("client"); // partner/sponsor → client-side, not community
  });
});
