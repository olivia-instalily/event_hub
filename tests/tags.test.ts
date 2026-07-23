import { describe, expect, it } from "vitest";
import {
  EVENT_TAGS, tagColor, tagBadgeVariant,
  EXTERNAL_TYPE_TAGS, EXTERNAL_SUBTYPE_TAGS, externalTagOf,
} from "../src/lib/tags";

describe("external taxonomy", () => {
  it("registers the two external tags", () => {
    expect(EVENT_TAGS).toContain("Ext. Industry");
    expect(EVENT_TAGS).toContain("Ext. PE");
  });
  it("colors external tags purple", () => {
    expect(tagColor("Ext. Industry")).toContain("purple");
    expect(tagColor("Ext. PE")).toContain("purple");
    expect(tagBadgeVariant("Ext. PE")).toBe("purple");
  });
  it("moves Internal off purple", () => {
    expect(tagColor("Internal team social")).not.toContain("purple");
    expect(tagColor("Internal team social")).toContain("rose");
    expect(tagBadgeVariant("Company milestone")).not.toBe("purple");
  });
  it("maps a type to its tag", () => {
    expect(EXTERNAL_TYPE_TAGS.Industry).toBe("Ext. Industry");
    expect(EXTERNAL_TYPE_TAGS.PE).toBe("Ext. PE");
    expect(EXTERNAL_SUBTYPE_TAGS).toEqual(["Ext. Industry", "Ext. PE"]);
  });
  it("extracts the external subtype tag from a tag list", () => {
    expect(externalTagOf(["Ext. PE"])).toBe("Ext. PE");
    expect(externalTagOf(["Client summit"])).toBeNull();
    expect(externalTagOf([])).toBeNull();
  });
});
