import { Request, Response } from "express";
import crypto from "node:crypto";
import { OAuth2Client } from "google-auth-library";
import { getServiceClient } from "../db.js";
import { validateGoogleClaims, signSession, verifySession, parseCookies, type GoogleClaims } from "./auth-lib.js";

const COOKIE = "eh_session";
const TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days
// Tailwind bg-class strings (NOT hex) — the UI applies profile.color as a className (see
// src/lib/profile.tsx PROFILE_COLORS). A hex value here renders an invisible avatar.
const PROFILE_COLORS = ["bg-blue-500", "bg-emerald-500", "bg-violet-500", "bg-rose-500", "bg-amber-500", "bg-teal-500", "bg-fuchsia-500", "bg-indigo-500"];
const oauthClient = new OAuth2Client();

function clientId(): string {
  const id = process.env.GOOGLE_OAUTH_CLIENT_ID;
  if (!id) throw new Error("GOOGLE_OAUTH_CLIENT_ID not configured");
  return id;
}
function secret(): string {
  const s = process.env.POSTGREST_JWT_SECRET;
  if (!s) throw new Error("POSTGREST_JWT_SECRET not configured");
  return s;
}
function setSessionCookie(res: Response, jwt: string) {
  res.cookie(COOKIE, jwt, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: TTL_SECONDS * 1000 });
}

async function findOrCreateProfile(email: string, name: string): Promise<{ id: string; name: string }> {
  const sb = getServiceClient();
  const { data: existing } = await sb.from("profile").select("id, name").eq("email", email).maybeSingle();
  if (existing) return existing as { id: string; name: string };
  const id = "prof-" + crypto.randomUUID();
  const color = PROFILE_COLORS[Math.floor(Math.random() * PROFILE_COLORS.length)];
  const { error } = await sb.from("profile").insert({ id, name, email, color });
  if (error) throw new Error(error.message);
  return { id, name };
}

// GET /auth/config → public client id for the GIS button.
export function authConfig(_req: Request, res: Response) {
  try { res.json({ clientId: clientId() }); }
  catch (e) { res.status(500).json({ error: String((e as Error).message) }); }
}

// POST /auth/google { credential } → verify, link/create profile, set session cookie.
export async function authGoogle(req: Request, res: Response) {
  try {
    const credential = req.body?.credential;
    if (!credential || typeof credential !== "string") { res.status(400).json({ error: "credential required" }); return; }
    const cid = clientId();
    const ticket = await oauthClient.verifyIdToken({ idToken: credential, audience: cid });
    const payload = ticket.getPayload() as GoogleClaims | undefined;
    if (!payload) { res.status(401).json({ error: "invalid token" }); return; }
    const check = validateGoogleClaims(payload, cid);
    if (!check.ok) { res.status(403).json({ error: (check as { ok: false; reason: string }).reason }); return; }
    const profile = await findOrCreateProfile(check.email, check.name);
    const jwt = signSession({ role: "authenticated", email: check.email, profile_id: profile.id }, secret(), TTL_SECONDS);
    setSessionCookie(res, jwt);
    res.json({ profileId: profile.id, email: check.email, name: profile.name });
  } catch (e) {
    console.error(JSON.stringify({ fn: "auth/google", error: String((e as Error)?.message ?? e) }));
    res.status(401).json({ error: "sign-in failed" });
  }
}

// GET /auth/me → current session or 401.
export function authMe(req: Request, res: Response) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  const claims = token ? verifySession(token, secret()) : null;
  if (!claims || claims.role !== "authenticated") { res.status(401).json({ error: "unauthenticated" }); return; }
  res.json({ profileId: claims.profile_id, email: claims.email, name: claims.email });
}

// POST /auth/logout → clear the cookie.
export function authLogout(_req: Request, res: Response) {
  res.clearCookie(COOKIE, { path: "/" });
  res.status(204).end();
}
