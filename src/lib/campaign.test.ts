import { describe, it, expect } from "vitest";
import {
  personLabel, distinctPeople, peakHeadcount, travelerLocalCounts,
  travelEstimate, memberBudgetTotal, personBrief, type Campaign,
} from "./campaign";

function fixture(): Campaign {
  return {
    drive: "recruiting",
    travelRatePerWave: 500,
    accommodationRatePerNight: null,
    anchorEventIds: ["e-hack"],
    currency: "CAD",
    estimatedLines: [],
    pendingItems: [],
    waves: [
      { id: "w1", name: "Wave 1", start: "2026-09-01", end: "2026-09-07", eventIds: ["e-hack", "e-mixer"] },
      { id: "w2", name: "Wave 2", start: "2026-09-08", end: "2026-09-14", eventIds: ["e-hack"] },
    ],
    people: [
      { id: "p1", profileId: "prof-a", waveIds: ["w1", "w2"], travel: "flying" },       // 2 waves, flies both
      { id: "p2", name: "Cathy", email: "cathy@instalily.ai", waveIds: ["w1"], travel: "local" },
      { id: "p3", name: "Sam", waveIds: ["w2"], travel: "flying", lodging: "Hotel X" },
    ],
  };
}

describe("headcount", () => {
  it("counts distinct people once even across multiple waves", () => {
    expect(distinctPeople(fixture())).toBe(3);
  });
  it("peak = max distinct people on any single wave", () => {
    expect(peakHeadcount(fixture())).toBe(2); // w1: p1,p2  w2: p1,p3
  });
  it("splits travelers vs locals by distinct people", () => {
    expect(travelerLocalCounts(fixture())).toEqual({ traveling: 2, local: 1 });
  });
});

describe("travelEstimate", () => {
  it("charges flyers per wave × rate; locals add $0", () => {
    // w1 flyers: p1 → 1 ; w2 flyers: p1,p3 → 2 ; (1+2)*500 = 1500
    expect(travelEstimate(fixture())).toBe(1500);
  });
  it("is 0 when rate is null", () => {
    expect(travelEstimate({ ...fixture(), travelRatePerWave: null })).toBe(0);
  });
});

describe("memberBudgetTotal", () => {
  it("sums event_budget_target, skipping nulls", () => {
    expect(memberBudgetTotal([{ eventBudgetTarget: 1000 }, { eventBudgetTarget: null }, { eventBudgetTarget: 250 }])).toBe(1250);
  });
});

describe("personLabel", () => {
  it("prefers profile-less name, else the linked-profile placeholder", () => {
    expect(personLabel({ id: "x", name: "Cathy", waveIds: [], travel: "local" })).toBe("Cathy");
    expect(personLabel({ id: "x", profileId: "prof-a", waveIds: [], travel: "flying" })).toBe("Teammate");
  });
});

describe("personBrief", () => {
  const eventsById = {
    "e-hack": { id: "e-hack", name: "Hackathon", date: "2026-09-03", location: "Toronto" },
    "e-mixer": { id: "e-mixer", name: "Mixer", date: "2026-09-05", location: "Toronto" },
  };
  it("filters to the person's waves and their events; 'to confirm' when unset", () => {
    const b = personBrief(fixture(), "p3", eventsById)!;
    expect(b.waves.map((w) => w.wave.id)).toEqual(["w2"]);
    expect(b.waves[0].events.map((e) => e.id)).toEqual(["e-hack"]); // only w2's events that exist
    expect(b.lodging).toBe("Hotel X");
    expect(b.travelDetail).toBe("to confirm");
    expect(b.traveling).toBe(true);
  });
  it("respects an explicit eventIds override", () => {
    const c = fixture();
    c.people[0].eventIds = ["e-mixer"]; // p1 tagged to just the mixer
    const b = personBrief(c, "p1", eventsById)!;
    expect(b.waves.flatMap((w) => w.events.map((e) => e.id))).toEqual(["e-mixer"]);
  });
  it("returns null for an unknown person", () => {
    expect(personBrief(fixture(), "nope", eventsById)).toBeNull();
  });
});

import {
  normalizeCampaign, manualEstimatedTotal, autoEstimateLines, estimatedSubtotal, formatMoney,
} from "./campaign";

describe("budget: normalizeCampaign defaults", () => {
  it("defaults currency to CAD and budget arrays to empty", () => {
    const c = normalizeCampaign({});
    expect(c.currency).toBe("CAD");
    expect(c.estimatedLines).toEqual([]);
    expect(c.pendingItems).toEqual([]);
  });
  it("preserves provided budget fields", () => {
    const c = normalizeCampaign({ currency: "USD", estimatedLines: [{ id: "l1", item: "Merch", detail: "tees", amount: 300 }], pendingItems: ["videographer TBD"] });
    expect(c.currency).toBe("USD");
    expect(c.estimatedLines).toEqual([{ id: "l1", item: "Merch", detail: "tees", amount: 300 }]);
    expect(c.pendingItems).toEqual(["videographer TBD"]);
  });
});

describe("budget: estimated totals", () => {
  const base = normalizeCampaign({
    currency: "CAD",
    travelRatePerWave: 500,
    accommodationRatePerNight: null,
    estimatedLines: [{ id: "l1", item: "Merch", detail: "tees", amount: 300 }, { id: "l2", item: "Signage", detail: "banner", amount: 200 }],
    waves: [{ id: "w1", name: "W1", start: "2026-09-01", end: "2026-09-03", eventIds: [] }],
    people: [{ id: "p1", waveIds: ["w1"], travel: "flying" }, { id: "p2", waveIds: ["w1"], travel: "local" }],
  });
  it("sums manual estimated lines", () => {
    expect(manualEstimatedTotal(base)).toBe(500);
  });
  it("derives a travel auto line (1 flyer × 1 wave × 500)", () => {
    const autos = autoEstimateLines(base);
    const travel = autos.find((a) => a.key === "travel");
    expect(travel?.amount).toBe(500);
  });
  it("omits the hotel auto line when the rate is null", () => {
    expect(autoEstimateLines(base).some((a) => a.key === "hotel")).toBe(false);
  });
  it("estimated subtotal = manual + autos (500 manual + 500 travel)", () => {
    expect(estimatedSubtotal(base)).toBe(1000);
  });
  it("no travel auto line when the travel rate is null", () => {
    const c = normalizeCampaign({ ...base, travelRatePerWave: null });
    expect(autoEstimateLines(c).some((a) => a.key === "travel")).toBe(false);
    expect(estimatedSubtotal(c)).toBe(500); // just the manual lines
  });
});

describe("budget: formatMoney", () => {
  it("formats with the given currency, no cents", () => {
    expect(formatMoney(1500, "CAD")).toMatch(/1,500/);
  });
});
