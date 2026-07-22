// Parse a dropped vendor list (CSV/TSV) into rows the ingest can turn into engagements + candidates.
// A vendor list is distinguished from a budget sheet by its HEADER — it must name a vendor column
// ("Vendor" / "Supplier" / "Company"). Without that we return null so the doc falls through to the
// budget/prose paths (a bare amount table is a budget, not a vendor list).
type EngagementStage = "Sourced" | "Contracted"; // mirrors db.ENGAGEMENT_STAGES

export interface VendorRow {
  category: string;          // the engagement slot (falls back to the vendor name)
  vendor: string | null;     // the named vendor (a candidate under the category)
  amount: number | null;     // quote / contracted amount
  status: string | null;     // raw status text from the sheet
  link: string | null;
  note: string | null;
}

function splitRow(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === delim) { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}
const pickDelim = (first: string) => [",", "\t", ";"].sort((a, b) => first.split(b).length - first.split(a).length)[0];
const parseAmt = (s: string | undefined): number | null => {
  if (s == null) return null;
  const t = s.trim();
  if (!/[0-9]/.test(t)) return null;
  const n = Number(t.replace(/[^0-9.]/g, ""));
  return Number.isNaN(n) ? null : (/^\(.*\)$/.test(t) ? -n : n);
};

/** Map free-text status → a canonical engagement stage. Committed language → Contracted; everything
 *  else (sourcing, quoting, selecting) is still "deciding" → Sourced. */
export function vendorStage(status: string | null): EngagementStage {
  const s = (status ?? "").toLowerCase();
  if (/\b(contract|book(ed)?|confirm|sign(ed)?|won|hired?|paid|final)\b/.test(s)) return "Contracted";
  return "Sourced";
}

export function parseVendors(text: string): VendorRow[] | null {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return null;
  const delim = pickDelim(lines[0]);
  const header = splitRow(lines[0], delim).map((h) => h.toLowerCase());
  const col = (rx: RegExp) => header.findIndex((h) => rx.test(h));
  const vi = col(/\b(vendor|supplier|company|provider)\b/);
  if (vi === -1) return null; // no vendor column → not a vendor list

  const ci = col(/\b(category|type|service|item|line|role)\b/);
  const ai = col(/\b(amount|cost|price|quote|total|spend|budget)\b/) >= 0 ? col(/\b(amount|cost|price|quote|total|spend|budget)\b/) : col(/\$/);
  const si = col(/\b(status|stage|state)\b/);
  const li = col(/\b(link|url|portal|website|site)\b/);
  const ni = col(/\b(note|notes|comment|detail)\b/);

  const rows: VendorRow[] = [];
  for (const line of lines.slice(1)) {
    const cells = splitRow(line, delim);
    const vendor = (vi >= 0 ? cells[vi] : "")?.trim() || null;
    const category = ((ci >= 0 ? cells[ci] : "")?.trim()) || vendor || "";
    if (!category && !vendor) continue;
    rows.push({
      category: category || vendor || "Vendor",
      vendor,
      amount: ai >= 0 ? parseAmt(cells[ai]) : null,
      status: (si >= 0 ? cells[si]?.trim() : "") || null,
      link: (li >= 0 ? cells[li]?.trim() : "") || null,
      note: (ni >= 0 ? cells[ni]?.trim() : "") || null,
    });
  }
  return rows.length ? rows : null;
}
