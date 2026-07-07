import { describe, expect, it } from "vitest";
import { parseBudgetText } from "../src/components/BudgetImport";

// A real "Budget Projection" tab: a title + subtitle above the table, a leading "#" index column,
// TWO money columns (Pitched = projected, Actual = final spend), section headers, per-section
// subtotals, a grand total, and a "Per Person" derived row. Final spend must come from Actual —
// labelled by the "Line Item" column, one line per real item, no headers/subtotals/totals.
const BUDGET_TAB = [
  "Bain Event Planning,,,,,",
  '"Tuesday, June 30, 2026 | 3:30 – 6:00 PM | Rooftop, NYC | Est. 50 guests",,,,,',
  ",,,,,",
  "#,Line Item,,Pitched,Actual,Notes",
  "AV & PRODUCTION,,,,,",
  '1,AV Package,,$0,$0,2-mics; display; tech',
  ",AV & PRODUCTION Subtotal,,$0,$0,",
  "FOOD & BEVERAGE,,,,,",
  "2,Aperitivo Catering,,$600,$0,Eli Zabars; delivery; tax; tip",
  "3,Pizza,,$450,$0,Ceres + Rubirosa",
  "4,Bar Package,,$225,$183,beverages + ice",
  "5,Miscellaneous,,$150,$66,napkins + glassware",
  ',FOOD & BEVERAGE Subtotal,,"$1,425",$250,',
  "STAFFING (itemized),,,,,",
  "6,Bartenders (x1),,$300,$360,5-6:30pm incl. tip and setup",
  "7,Licensed Security (x1),,$441,$441,1 guard 3:00-6:00 PM",
  "8,Cleanup Crew,,$0,$0,post-event breakdown",
  ",STAFFING (itemized) Subtotal,,$741,$801,",
  "GUEST EXPERIENCE & COMFORT,,,,,",
  '9,"Furniture (chairs, tables)",,"$1,000",$927,rental chairs; round tables',
  ',GUEST EXPERIENCE & COMFORT Subtotal,,"$1,000",$927,',
  "CONTINGENCY,,,,,",
  "10,,,$200,$0,overtime; weather pivots",
  ",CONTINGENCY Subtotal,,$200,$0,",
  ',GRAND TOTAL,,"$3,366","$1,979",',
  ",Per Person (est. 30 guests),,,$112,",
].join("\n");

describe("parseBudgetText — real Budget Projection tab (final spend)", () => {
  const lines = parseBudgetText(BUDGET_TAB);
  const byLabel = new Map(lines.map((l) => [l.label, l.amount] as const));

  it("labels lines by the Line Item column, not the # index", () => {
    expect(byLabel.has("Bar Package")).toBe(true);
    // The bug: labels came out as "1","2","3"… from the leading # column.
    expect(byLabel.has("1")).toBe(false);
    expect(byLabel.has("4")).toBe(false);
  });

  it("reads amounts from the Actual (final spend) column, not Pitched", () => {
    expect(byLabel.get("Bar Package")).toBe(183); // Pitched was 225
    expect(byLabel.get("Miscellaneous")).toBe(66); // Pitched was 150
    expect(byLabel.get("Bartenders (x1)")).toBe(360); // Pitched was 300
    expect(byLabel.get("Furniture (chairs, tables)")).toBe(927); // Pitched was 1000
    expect(byLabel.get("Aperitivo Catering")).toBe(0); // Pitched was 600
  });

  it("skips section headers, subtotals, grand total and the per-person row", () => {
    expect(byLabel.has("FOOD & BEVERAGE")).toBe(false); // section header (no amount)
    expect([...byLabel.keys()].some((l) => /subtotal/i.test(l))).toBe(false);
    expect([...byLabel.keys()].some((l) => /grand total/i.test(l))).toBe(false);
    expect([...byLabel.keys()].some((l) => /per person/i.test(l))).toBe(false);
  });

  it("produces one line per real item — not a line per row", () => {
    // 9 named items with an Actual value (contingency row 10 has no Line Item label).
    const named = lines.filter((l) => l.label && l.label !== "Untitled" && l.amount != null);
    expect(named).toHaveLength(9);
  });
});

describe("parseBudgetText — simple pasted list still works", () => {
  it("parses a headerless label,amount list", () => {
    const lines = parseBudgetText("Venue, 5000\nCatering, 3200\nA/V, 1500");
    expect(lines).toEqual([
      { label: "Venue", amount: 5000 },
      { label: "Catering", amount: 3200 },
      { label: "A/V", amount: 1500 },
    ]);
  });

  it("uses a header row to pick the amount column when present", () => {
    const lines = parseBudgetText("Category,Amount\nVenue,5000\nCatering,3200");
    expect(lines).toEqual([
      { label: "Venue", amount: 5000 },
      { label: "Catering", amount: 3200 },
    ]);
  });
});
