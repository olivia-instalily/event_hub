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

/** Split a person capture into name + role. "Thurman — bar" / "Thurman (bar)" / "Doug on sound".
 *  Falls back to a role-only entry (name null) when there's no separator. */
export function parsePersonRole(summary: string): { name: string | null; role: string } {
  const s = summary.trim();
  const m =
    s.match(/^(.+?)\s*[—–-]\s*(.+)$/) ||       // Name — role / Name - role
    s.match(/^(.+?)\s*\((.+)\)\s*$/) ||         // Name (role)
    s.match(/^(.+?)\s+on\s+(.+)$/i);            // Name on role
  if (m) return { name: m[1].trim(), role: m[2].trim() };
  return { name: null, role: s };
}
