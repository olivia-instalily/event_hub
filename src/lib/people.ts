// Small pure helpers for "internal" people (InstaLILY staff).

const INTERNAL_DOMAIN = "@instalily.ai";

/** True when an email belongs to an InstaLILY staffer (case-insensitive, trims whitespace). */
export function isInternalEmail(email: string | null | undefined): boolean {
  return !!email && email.trim().toLowerCase().endsWith(INTERNAL_DOMAIN);
}

/**
 * Suggested internal email from a name — `firstname@instalily.ai`.
 * First name = the first whitespace-separated token, lowercased, non-alphanumerics stripped.
 * Returns "" when there's no usable first name (so the caller can leave the field blank).
 */
export function internalEmailFor(name: string): string {
  const first = (name.trim().split(/\s+/)[0] ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  return first ? `${first}${INTERNAL_DOMAIN}` : "";
}
