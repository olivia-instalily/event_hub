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
