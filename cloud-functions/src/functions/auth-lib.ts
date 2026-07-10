import crypto from "node:crypto";

export type GoogleClaims = { email?: string; email_verified?: boolean | string; hd?: string; name?: string; aud?: string };

const DOMAIN = "instalily.ai";

// Validate a decoded Google ID-token payload. Signature/issuer/expiry are checked by
// google-auth-library upstream; this enforces our org rules on the already-verified payload.
export function validateGoogleClaims(p: GoogleClaims, clientId: string):
  | { ok: true; email: string; name: string }
  | { ok: false; reason: string } {
  if (!p.aud || p.aud !== clientId) return { ok: false, reason: "wrong audience" };
  const verified = p.email_verified === true || p.email_verified === "true";
  if (!verified) return { ok: false, reason: "email not verified" };
  const email = (p.email ?? "").trim().toLowerCase();
  if (!email.endsWith("@" + DOMAIN)) return { ok: false, reason: "not an instalily.ai account" };
  if (p.hd && p.hd !== DOMAIN) return { ok: false, reason: "wrong workspace domain" };
  return { ok: true, email, name: (p.name ?? email).trim() };
}

const b64url = (b: Buffer) => b.toString("base64url");
const enc = (o: unknown) => b64url(Buffer.from(JSON.stringify(o)));

export function signSession(claims: Record<string, unknown>, secret: string, ttlSeconds: number): string {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "HS256", typ: "JWT" };
  const payload = { ...claims, iat: now, exp: now + ttlSeconds };
  const data = `${enc(header)}.${enc(payload)}`;
  const sig = b64url(crypto.createHmac("sha256", secret).update(data).digest());
  return `${data}.${sig}`;
}

export function verifySession(token: string, secret: string): Record<string, any> | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [h, p, s] = parts;
  const expected = b64url(crypto.createHmac("sha256", secret).update(`${h}.${p}`).digest());
  const a = Buffer.from(s), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let payload: any;
  try { payload = JSON.parse(Buffer.from(p, "base64url").toString("utf8")); } catch { return null; }
  if (typeof payload.exp === "number" && payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (k) out[k] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
