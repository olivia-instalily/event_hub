// Parsers for promoting a confirmed Slack capture into structured record fields.
// Captures carry human prose (summary / detail); promotion needs a number or a name+role.

/** Pull a dollar figure out of prose. "$1,200 for the night" → 1200, "~$14k" → 14000. Null if none. */
export function parseMoney(text?: string | null): number | null {
  if (!text) return null;
  const m = text.replace(/,/g, "").match(/\$?\s*(\d+(?:\.\d+)?)\s*([kK])?/);
  if (!m) return null;
  let n = parseFloat(m[1]);
  if (Number.isNaN(n)) return null;
  if (m[2]) n *= 1000; // "14k" / "14.5k"
  return n;
}

export type BudgetKind = "estimate" | "quoted" | "paid";

/** Read the payment status from the capture's wording. paid > estimate-ish > default quoted.
 *  estimate = a rough figure we're guessing; quoted = a confirmed number; paid = actually paid out. */
export function parseBudgetStatus(text?: string | null): BudgetKind {
  const t = (text ?? "").toLowerCase();
  if (/\bpaid\b|paid for|paid out|deposit paid/.test(t)) return "paid";
  if (/\bestimat|\brough(ly)?\b|ballpark|around \$|~\s*\$|aiming|guess/.test(t)) return "estimate";
  // A quote, a "confirmed", or just a concrete stated figure → quoted.
  return "quoted";
}

/** Do two budget/line labels refer to the same thing? Case-insensitive, tolerant of extra words:
 *  exact (normalized), one contained in the other, or a shared significant token (len ≥ 4). */
export function labelsMatch(a: string, b: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  const na = norm(a), nb = norm(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const ca = na.replace(/ /g, ""), cb = nb.replace(/ /g, "");
  if (ca.includes(cb) || cb.includes(ca)) return true;
  const stop = new Set(["the", "a", "an", "for", "and", "rental", "cost", "staff", "budget"]);
  const toks = (s: string) => new Set(s.split(" ").filter((w) => w.length >= 4 && !stop.has(w)));
  const ta = toks(na), tb = toks(nb);
  for (const w of ta) if (tb.has(w)) return true;
  return false;
}

/** Split a person capture into name + role. "Thurman — bar" / "Thurman (bar)" / "Doug on sound".
 *  Falls back to a role-only entry (name null) when there's no separator. */
// Verbs that bridge a name and the role they fill ("Olivia runs check-in", "Doug leads AV").
const ROLE_VERB = "runs?|running|leads?|leading|does|doing|handles?|handling|manages?|managing|owns?|owning|covers?|covering|is\\s+on|will\\s+run|to\\s+run|to\\s+lead|on";
const stripRole = (r: string) => r.replace(/^\s*(?:the|our|a)\s+/i, "").trim();

export function parsePersonRole(summary: string, knownNames?: string[]): { name: string | null; role: string } {
  const s = summary.trim();
  // 1. explicit delimiter: "Name — role" / "Name (role)". A plain hyphen must have spaces around it,
  //    so a hyphenated role word ("check-in") isn't split; em/en dashes may be tight.
  let m = s.match(/^(.+?)\s*[—–]\s*(.+)$/) || s.match(/^(.+?)\s+-\s+(.+)$/) || s.match(/^(.+?)\s*\((.+)\)\s*$/);
  if (m) return { name: m[1].trim(), role: stripRole(m[2]) };
  // 2. a known name (owner / team member) at the start → that's the person; the rest, minus a bridging
  //    verb, is the role. "Olivia runs check in" → Olivia / check in.
  const hit = (knownNames ?? []).find((n) => n && new RegExp(`^${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(s));
  if (hit) {
    const rest = s.slice(hit.length).replace(new RegExp(`^\\s*(?:'s)?\\s*(?:${ROLE_VERB})\\b\\s*`, "i"), "").trim();
    return { name: hit, role: stripRole(rest) || stripRole(s.slice(hit.length)) || s };
  }
  // 3. verb bridge tells us where the name ends: "<name> runs <role>"
  m = s.match(new RegExp(`^(.{1,40}?)\\s+(?:${ROLE_VERB})\\s+(.+)$`, "i"));
  if (m) return { name: m[1].trim(), role: stripRole(m[2]) };
  return { name: null, role: s };
}
