// The curated default categories offered in the vendor combobox. Kept small and deliberate — the
// dropdown does NOT scrape every category that happens to exist on some engagement (that pulled in
// junk like "Eli Zabar (bagels etc.)"). New categories only appear when a user explicitly adds one.
export const VENDOR_CATEGORY_DEFAULTS = [
  "AV", "Bar", "Catering", "Merch & giveaways", "Photography", "Venue", "Videography",
];

// Distinct vendor categories for the combobox: trim, drop blanks, case-insensitive de-dupe
// (keep the first-seen casing as the display value), sorted case-insensitively.
export function dedupeCategories(raw: (string | null | undefined)[]): string[] {
  const seen = new Map<string, string>(); // lowercased key → first-seen display
  for (const r of raw) {
    const s = (r ?? "").trim();
    if (!s) continue;
    const k = s.toLowerCase();
    if (!seen.has(k)) seen.set(k, s);
  }
  return [...seen.values()].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
}
