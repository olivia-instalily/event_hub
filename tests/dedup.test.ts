import { describe, expect, it } from "vitest";
import { titlesSimilar, filesMatch, sharedFiles, findDuplicateEvent, type DupEvent } from "../src/lib/dedup";

const ev = (o: Partial<DupEvent> & { id: string; title: string }): DupEvent => ({
  date: null, tags: [], isTemplate: false, ...o,
});

describe("titlesSimilar", () => {
  it("matches identical titles (case/punctuation-insensitive)", () => {
    expect(titlesSimilar("Q3 Client Dinner", "q3  client-dinner")).toBe(true);
  });
  it("matches when one title is a superset of the other", () => {
    // The exact real case: manual event vs the fuller Luma-style title.
    expect(titlesSimilar("Building AI for Enterprise", "Building AI for Enterprise with InstaLILY x Google")).toBe(true);
  });
  it("does not match unrelated titles", () => {
    expect(titlesSimilar("Summer Rooftop Party", "Q4 Investor Breakfast")).toBe(false);
  });
  it("does not match two instances that only share a series name", () => {
    expect(titlesSimilar("NYC Run Club — Aug 8", "NYC Run Club — Sep 5")).toBe(false);
  });
  it("is false for empty input", () => {
    expect(titlesSimilar("", "anything")).toBe(false);
  });
});

describe("filesMatch", () => {
  it("is true when every dropped file is already attached (name, case-insensitive)", () => {
    expect(filesMatch(["Brief.md", "budget.csv"], ["brief.md", "BUDGET.CSV", "cover.png"])).toBe(true);
  });
  it("is false when a dropped file is not present", () => {
    expect(filesMatch(["brief.md", "new.csv"], ["brief.md"])).toBe(false);
  });
  it("is false for an empty drop", () => {
    expect(filesMatch([], ["brief.md"])).toBe(false);
  });
});

describe("sharedFiles", () => {
  it("returns the dropped names that already exist (case-insensitive), for ANY overlap", () => {
    expect(sharedFiles(["run-of-show.md", "new.csv"], ["RUN-OF-SHOW.MD", "budget.csv"])).toEqual(["run-of-show.md"]);
  });
  it("returns all overlaps when several match", () => {
    expect(sharedFiles(["a.md", "b.csv"], ["a.md", "b.csv", "c.png"]).sort()).toEqual(["a.md", "b.csv"]);
  });
  it("is empty when nothing overlaps", () => {
    expect(sharedFiles(["a.md"], ["b.md"])).toEqual([]);
  });
  it("is empty for an empty drop", () => {
    expect(sharedFiles([], ["a.md"])).toEqual([]);
  });
});

describe("findDuplicateEvent", () => {
  const existing: DupEvent[] = [
    ev({ id: "e1", title: "Building AI for Enterprise", date: "2026-05-25", tags: ["Brand & community event"] }),
    ev({ id: "e2", title: "Q4 Investor Breakfast", date: "2026-11-02", tags: ["Client Briefing"] }),
    ev({ id: "t1", title: "Fireside Template", date: null, tags: ["Brand & community event"], isTemplate: true }),
  ];

  it("flags a re-drop with the same title, date, and type (the reported bug)", () => {
    const m = findDuplicateEvent(
      { name: "Building AI for Enterprise with InstaLILY x Google", date: "2026-05-25", tag: "Brand & community event", isTemplate: false },
      existing,
    );
    expect(m?.event.id).toBe("e1");
    expect(m?.reason).toBe("similar");
  });

  it("does not flag when the date differs", () => {
    const m = findDuplicateEvent(
      { name: "Building AI for Enterprise", date: "2026-06-01", tag: "Brand & community event", isTemplate: false },
      existing,
    );
    expect(m).toBeNull();
  });

  it("does not flag when the type/tag differs", () => {
    const m = findDuplicateEvent(
      { name: "Building AI for Enterprise", date: "2026-05-25", tag: "Client Briefing", isTemplate: false },
      existing,
    );
    expect(m).toBeNull();
  });

  it("does not flag a template candidate against a dated event", () => {
    const m = findDuplicateEvent(
      { name: "Building AI for Enterprise", date: null, tag: "Brand & community event", isTemplate: true },
      existing,
    );
    expect(m?.event.id).not.toBe("e1"); // e1 is a dated event, candidate is a template
  });

  it("returns null when nothing is close", () => {
    const m = findDuplicateEvent(
      { name: "Brand New Offsite", date: "2026-05-25", tag: "Internal Social", isTemplate: false },
      existing,
    );
    expect(m).toBeNull();
  });
});
