/** Normalize a pasted Doc/Drive link: keep only trimmed http(s) URLs, else null. */
export function normalizeDocUrl(input: string): string | null {
  const u = input.trim();
  return u && u.startsWith("http") ? u : null;
}
