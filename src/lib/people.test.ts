import { describe, it, expect } from "vitest";
import { isInternalEmail, internalEmailFor } from "./people";

describe("isInternalEmail", () => {
  it("matches @instalily.ai regardless of case/whitespace", () => {
    expect(isInternalEmail("olivia@instalily.ai")).toBe(true);
    expect(isInternalEmail("  Olivia@Instalily.AI  ")).toBe(true);
  });
  it("rejects other domains and empty values", () => {
    expect(isInternalEmail("someone@gmail.com")).toBe(false);
    expect(isInternalEmail("olivia@instalily.com")).toBe(false);
    expect(isInternalEmail("")).toBe(false);
    expect(isInternalEmail(null)).toBe(false);
    expect(isInternalEmail(undefined)).toBe(false);
  });
});

describe("internalEmailFor", () => {
  it("uses the lowercased first name", () => {
    expect(internalEmailFor("Olivia Joergens")).toBe("olivia@instalily.ai");
    expect(internalEmailFor("  Sam  ")).toBe("sam@instalily.ai");
  });
  it("strips non-alphanumerics from the first name", () => {
    expect(internalEmailFor("Jean-Luc Picard")).toBe("jeanluc@instalily.ai");
  });
  it("returns empty string when there's no usable name", () => {
    expect(internalEmailFor("")).toBe("");
    expect(internalEmailFor("   ")).toBe("");
  });
});
