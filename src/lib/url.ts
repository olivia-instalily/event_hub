// Vendor matching keys off the URL the user already enters: we derive a domain from
// the vendor link and match inbound email senders by domain (so sales@, john@,
// billing@ at the same company all match one vendor — no per-address entry).

/** Hostname of a URL, lowercased, without a leading www. Accepts bare domains too. */
export function domainFromUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.trim();
  if (!s) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
    const h = u.hostname.toLowerCase().replace(/^www\./, "");
    return h || null;
  } catch {
    return null;
  }
}

/** Domain part of an email address. */
export function emailDomain(email: string | null | undefined): string | null {
  const m = (email ?? "").trim().toLowerCase().match(/@([^@\s>]+)/);
  return m ? m[1] : null;
}

// Free / shared mail providers — never match a whole vendor on these.
const FREE_MAIL = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com",
  "yahoo.com", "icloud.com", "me.com", "aol.com", "proton.me", "protonmail.com",
]);

export function isFreeMailDomain(d: string | null | undefined): boolean {
  return !!d && FREE_MAIL.has(d.toLowerCase());
}

/** True if two domains are the same company, tolerant of subdomains
 *  (mail.maplecatering.com ↔ maplecatering.com). Free-mail domains never match. */
export function domainsMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const x = a.toLowerCase(), y = b.toLowerCase();
  if (isFreeMailDomain(x) || isFreeMailDomain(y)) return false;
  return x === y || x.endsWith(`.${y}`) || y.endsWith(`.${x}`);
}
