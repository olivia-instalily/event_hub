import { describe, it, expect } from "vitest";
import { parseMoney, parsePersonRole } from "./capturePromote";

describe("parseMoney", () => {
  it("pulls a dollar figure out of prose", () => {
    expect(parseMoney("$1,200 for the night")).toBe(1200);
    expect(parseMoney("1200")).toBe(1200);
  });
  it("expands the k shorthand", () => {
    expect(parseMoney("aiming ~$14k")).toBe(14000);
    expect(parseMoney("$14.5k")).toBe(14500);
  });
  it("is null when there's no figure", () => {
    expect(parseMoney("only if concept comes together")).toBeNull();
    expect(parseMoney(null)).toBeNull();
    expect(parseMoney(undefined)).toBeNull();
  });
});

describe("parsePersonRole", () => {
  it("splits name from role on a dash", () => {
    expect(parsePersonRole("Thurman — bar")).toEqual({ name: "Thurman", role: "bar" });
    expect(parsePersonRole("Alice Chen - lead host")).toEqual({ name: "Alice Chen", role: "lead host" });
  });
  it("splits parenthetical and 'on' phrasing", () => {
    expect(parsePersonRole("Thurman (bar)")).toEqual({ name: "Thurman", role: "bar" });
    expect(parsePersonRole("Doug on sound")).toEqual({ name: "Doug", role: "sound" });
  });
  it("treats an un-splittable label as a role with no name", () => {
    expect(parsePersonRole("Photographer")).toEqual({ name: null, role: "Photographer" });
  });
});
