import { describe, it, expect } from "vitest";
import { normalizeDocUrl } from "./docLink";

describe("normalizeDocUrl", () => {
  it("keeps an http(s) url, trimmed", () => {
    expect(normalizeDocUrl("  https://docs.google.com/x  ")).toBe("https://docs.google.com/x");
    expect(normalizeDocUrl("http://example.com")).toBe("http://example.com");
  });
  it("rejects non-http and empty input", () => {
    expect(normalizeDocUrl("")).toBeNull();
    expect(normalizeDocUrl("   ")).toBeNull();
    expect(normalizeDocUrl("docs.google.com/x")).toBeNull();
    expect(normalizeDocUrl("mailto:a@b.com")).toBeNull();
  });
});
