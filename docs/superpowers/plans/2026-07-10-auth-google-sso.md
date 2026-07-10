# Google SSO Auth (gated to @instalily.ai) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gate EventHub behind Google Identity Services sign-in restricted to verified `@instalily.ai` accounts, each tied to a `profile`.

**Architecture:** GIS gives the browser a Google ID token; a new `auth` Node function verifies it, links/creates a profile, and mints a PostgREST-role session JWT stored in an HttpOnly cookie. Caddy forwards that cookie as the `Bearer` token to PostgREST; the `anon` role is stripped of grants so the API is genuinely gated. Frontend shows a login wall until `/auth/me` confirms a session.

**Tech Stack:** TypeScript, Node 22 (ESM, NodeNext), Express, `google-auth-library`, `node:crypto` (hand-rolled HS256 session JWT), PostgREST, Caddy, React 18 + Vite, `@google/gsi` script.

## Global Constraints

- Domain allowed: `instalily.ai` (verified email + `hd` claim). Copy verbatim.
- Session cookie: name `eh_session`; `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=604800` (7 days).
- Session JWT: HS256, signed with env `POSTGREST_JWT_SECRET`; claims `{ role: 'authenticated', email, profile_id, iat, exp }`.
- Server env for GIS: `GOOGLE_OAUTH_CLIENT_ID` (public client_id; safe to expose to the browser).
- cloud-functions use ESM with `.js` import specifiers (NodeNext); frontend uses Vite bundler resolution.
- Profile id format: `prof-<uuid>` (matches `newId('prof')`).
- Local dev (`proxiedBackend === false`) bypasses the login wall entirely.
- Deploy parity: the `auth` function + `Caddyfile` ship via the image build on push; the DB migration, `GOOGLE_OAUTH_CLIENT_ID` env, and Google Console client are MANUAL (Task 7).

---

### Task 1: Auth core helpers (pure, TDD)

Pure, dependency-free logic: Google-claim validation, session JWT sign/verify, cookie parsing. Isolated in `auth-lib.ts` (imports only `node:crypto`) so it's unit-testable without network or the `.js`-specifier DB imports.

**Files:**
- Create: `cloud-functions/src/functions/auth-lib.ts`
- Create: `cloud-functions/src/functions/auth-lib.test.ts`
- Modify: `cloud-functions/package.json` (add `vitest` devDep + `test` script)
- Create: `cloud-functions/vitest.config.ts`

**Interfaces:**
- Produces:
  - `validateGoogleClaims(payload: GoogleClaims, clientId: string): { ok: true; email: string; name: string } | { ok: false; reason: string }`
  - `signSession(claims: Record<string, unknown>, secret: string, ttlSeconds: number): string`
  - `verifySession(token: string, secret: string): Record<string, any> | null`
  - `parseCookies(header: string | undefined): Record<string, string>`
  - `type GoogleClaims = { email?: string; email_verified?: boolean | string; hd?: string; name?: string; aud?: string }`

- [ ] **Step 1: Add vitest to cloud-functions**

Modify `cloud-functions/package.json` — add to `devDependencies` and `scripts`:

```json
{
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "test": "vitest run"
  },
  "devDependencies": {
    "@types/cors": "^2.8.17",
    "@types/express": "^5.0.0",
    "@types/node": "^22.0.0",
    "typescript": "^5.6.3",
    "vitest": "^3.0.0"
  }
}
```

Create `cloud-functions/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
```

Run: `cd cloud-functions && npm install`
Expected: `vitest` installed, no errors.

- [ ] **Step 2: Write the failing tests**

Create `cloud-functions/src/functions/auth-lib.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { validateGoogleClaims, signSession, verifySession, parseCookies } from "./auth-lib.js";

const CID = "test-client-id.apps.googleusercontent.com";

describe("validateGoogleClaims", () => {
  it("accepts a verified instalily account", () => {
    const r = validateGoogleClaims({ aud: CID, email: "Ada@instalily.ai", email_verified: true, hd: "instalily.ai", name: "Ada" }, CID);
    expect(r).toEqual({ ok: true, email: "ada@instalily.ai", name: "Ada" });
  });
  it("rejects a wrong audience", () => {
    expect(validateGoogleClaims({ aud: "other", email: "a@instalily.ai", email_verified: true }, CID).ok).toBe(false);
  });
  it("rejects an unverified email", () => {
    expect(validateGoogleClaims({ aud: CID, email: "a@instalily.ai", email_verified: false }, CID).ok).toBe(false);
  });
  it("rejects a non-instalily domain", () => {
    expect(validateGoogleClaims({ aud: CID, email: "a@gmail.com", email_verified: true }, CID).ok).toBe(false);
  });
  it("rejects a mismatched hd claim", () => {
    expect(validateGoogleClaims({ aud: CID, email: "a@instalily.ai", email_verified: true, hd: "evil.com" }, CID).ok).toBe(false);
  });
});

describe("session jwt", () => {
  it("round-trips claims and verifies signature", () => {
    const t = signSession({ role: "authenticated", email: "a@instalily.ai", profile_id: "prof-1" }, "secret", 3600);
    const p = verifySession(t, "secret");
    expect(p?.role).toBe("authenticated");
    expect(p?.profile_id).toBe("prof-1");
  });
  it("rejects a tampered token", () => {
    const t = signSession({ role: "authenticated" }, "secret", 3600);
    expect(verifySession(t + "x", "secret")).toBeNull();
    expect(verifySession(t, "wrong-secret")).toBeNull();
  });
  it("rejects an expired token", () => {
    const t = signSession({ role: "authenticated" }, "secret", -1);
    expect(verifySession(t, "secret")).toBeNull();
  });
});

describe("parseCookies", () => {
  it("parses a cookie header", () => {
    expect(parseCookies("eh_session=abc.def; other=1")).toEqual({ eh_session: "abc.def", other: "1" });
  });
  it("handles undefined", () => {
    expect(parseCookies(undefined)).toEqual({});
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd cloud-functions && npm test`
Expected: FAIL — `Cannot find module './auth-lib.js'`.

- [ ] **Step 4: Implement `auth-lib.ts`**

Create `cloud-functions/src/functions/auth-lib.ts`:

```ts
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
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd cloud-functions && npm test`
Expected: PASS (all tests green).

- [ ] **Step 6: Commit**

```bash
git add cloud-functions/src/functions/auth-lib.ts cloud-functions/src/functions/auth-lib.test.ts cloud-functions/vitest.config.ts cloud-functions/package.json cloud-functions/package-lock.json
git commit -m "feat(auth): pure auth-lib helpers (claim validation, session JWT, cookies)"
```

---

### Task 2: Auth function handlers + route registration

**Files:**
- Create: `cloud-functions/src/functions/auth.ts`
- Modify: `cloud-functions/src/index.ts`
- Modify: `cloud-functions/package.json` (add `google-auth-library` dependency)

**Interfaces:**
- Consumes: `validateGoogleClaims`, `signSession`, `verifySession`, `parseCookies` from `./auth-lib.js`; `getServiceClient` from `../db.js`.
- Produces: Express handlers `authConfig`, `authGoogle`, `authMe`, `authLogout`; routes `GET /auth/config`, `POST /auth/google`, `GET /auth/me`, `POST /auth/logout`.

- [ ] **Step 1: Add the dependency**

Modify `cloud-functions/package.json` `dependencies` — add `"google-auth-library": "^9.15.0"`.

Run: `cd cloud-functions && npm install`
Expected: installs cleanly.

- [ ] **Step 2: Implement `auth.ts`**

Create `cloud-functions/src/functions/auth.ts`:

```ts
import { Request, Response } from "express";
import crypto from "node:crypto";
import { OAuth2Client } from "google-auth-library";
import { getServiceClient } from "../db.js";
import { validateGoogleClaims, signSession, verifySession, parseCookies, type GoogleClaims } from "./auth-lib.js";

const COOKIE = "eh_session";
const TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days
const PROFILE_COLORS = ["#3b82f6", "#10b981", "#8b5cf6", "#f43f5e", "#f59e0b", "#14b8a6", "#d946ef", "#6366f1"];
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
    if (!check.ok) { res.status(403).json({ error: check.reason }); return; }
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
```

Note: `authMe` returns `email` as `name` (the JWT carries no name); the SPA shows the profile name from its own profile list. This is deliberate — keeps the JWT lean.

- [ ] **Step 3: Register routes in `index.ts`**

Modify `cloud-functions/src/index.ts` — add the import near the other function imports:

```ts
import { authConfig, authGoogle, authMe, authLogout } from './functions/auth.js';
```

And register the routes AFTER `app.use(express.json(...))` (so `POST /auth/google` gets a parsed body), e.g. right after the `/attach-luma` line:

```ts
app.get('/auth/config',   authConfig);
app.post('/auth/google',  authGoogle);
app.get('/auth/me',       authMe);
app.post('/auth/logout',  authLogout);
```

- [ ] **Step 4: Build to verify it compiles**

Run: `cd cloud-functions && npm run build`
Expected: `tsc` succeeds, no errors, `dist/functions/auth.js` emitted.

- [ ] **Step 5: Commit**

```bash
git add cloud-functions/src/functions/auth.ts cloud-functions/src/index.ts cloud-functions/package.json cloud-functions/package-lock.json
git commit -m "feat(auth): auth function (config/google/me/logout) + routes"
```

---

### Task 3: Real gate — Caddy cookie forwarding + DB grants

Make the gate real: Caddy forwards the session cookie to PostgREST; the migration moves table privileges from `anon` to `authenticated`. These ship together — either alone breaks access.

**Files:**
- Modify: `Caddyfile`
- Create: `supabase/migrations/20260710000000_auth_grants.sql`

- [ ] **Step 1: Update Caddy `/rest/*` to forward the session cookie**

Modify `Caddyfile` — replace the PostgREST block in the public server:

```
	# PostgREST REST API  →  strip /rest/v1 prefix, forward the session cookie as the bearer.
	# No cookie ⇒ empty bearer ⇒ PostgREST falls back to the (locked-down) anon role ⇒ denied.
	handle /rest/* {
		uri strip_prefix /rest/v1
		reverse_proxy localhost:3000 {
			header_up Authorization "Bearer {http.request.cookie.eh_session}"
			header_up apikey ""
		}
	}
```

- [ ] **Step 2: Write the grants migration**

Create `supabase/migrations/20260710000000_auth_grants.sql`:

```sql
-- Auth gate: signed-in sessions run as the `authenticated` role; unauthenticated requests fall to
-- `anon`. Move all data privileges from anon → authenticated so a request without a valid session
-- cookie can't read or write anything. (Roles exist in the Supabase-derived DB; created defensively.)
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
END $$;

GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO authenticated;

-- Lock down anon: no data access for unauthenticated requests.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
```

- [ ] **Step 3: Validate the Caddyfile locally (best effort)**

Run: `command -v caddy >/dev/null && caddy validate --config Caddyfile --adapter caddyfile || echo "caddy not installed — validated by the image build"`
Expected: `Valid configuration`, or the skip message.

- [ ] **Step 4: Commit**

```bash
git add Caddyfile supabase/migrations/20260710000000_auth_grants.sql
git commit -m "feat(auth): gate /rest via session cookie + move grants anon→authenticated"
```

---

### Task 4: Frontend AuthProvider + dev bypass

**Files:**
- Create: `src/lib/auth.tsx`
- Modify: `src/main.tsx`

**Interfaces:**
- Consumes: `proxiedBackend` from `./supabase`.
- Produces: `AuthProvider`, `useAuth(): { status: 'loading'|'authed'|'unauthed'; user: AuthUser|null; refresh: ()=>Promise<void>; signOut: ()=>Promise<void> }`, `type AuthUser = { profileId: string; email: string; name: string }`.

- [ ] **Step 1: Implement `auth.tsx`**

Create `src/lib/auth.tsx`:

```tsx
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { proxiedBackend } from "./supabase";

export interface AuthUser { profileId: string; email: string; name: string; }
type Status = "loading" | "authed" | "unauthed";
interface AuthCtx { status: Status; user: AuthUser | null; refresh: () => Promise<void>; signOut: () => Promise<void>; }

const Ctx = createContext<AuthCtx>({ status: "loading", user: null, refresh: async () => {}, signOut: async () => {} });
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const [user, setUser] = useState<AuthUser | null>(null);

  const refresh = async () => {
    // Local dev talks to the Supabase stack directly (no Caddy/cookie), so skip the gate.
    if (!proxiedBackend) {
      setUser({ profileId: "", email: "dev@instalily.ai", name: "Dev" });
      setStatus("authed");
      return;
    }
    try {
      const res = await fetch("/functions/v1/auth/me", { credentials: "same-origin" });
      if (res.ok) { setUser((await res.json()) as AuthUser); setStatus("authed"); }
      else { setUser(null); setStatus("unauthed"); }
    } catch { setUser(null); setStatus("unauthed"); }
  };

  useEffect(() => { void refresh(); }, []);

  const signOut = async () => {
    await fetch("/functions/v1/auth/logout", { method: "POST", credentials: "same-origin" }).catch(() => {});
    setUser(null);
    setStatus("unauthed");
  };

  return <Ctx.Provider value={{ status, user, refresh, signOut }}>{children}</Ctx.Provider>;
}
```

- [ ] **Step 2: Wrap the app in `main.tsx`**

Modify `src/main.tsx`:

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { AuthProvider } from './lib/auth';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </StrictMode>,
);
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/auth.tsx src/main.tsx
git commit -m "feat(auth): AuthProvider with /auth/me check and dev bypass"
```

---

### Task 5: LoginScreen (GIS) + App gating

**Files:**
- Create: `src/components/LoginScreen.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `useAuth` from `../lib/auth`.
- Produces: `LoginScreen` component (renders the GIS button, posts the credential, calls `refresh` on success).

- [ ] **Step 1: Implement `LoginScreen.tsx`**

Create `src/components/LoginScreen.tsx`:

```tsx
import { useEffect, useRef, useState } from "react";
import { useAuth } from "../lib/auth";

// Loads the Google Identity Services script once and renders the official "Sign in with Google"
// button. On credential, posts to /auth/google; the backend enforces the instalily.ai domain.
declare global { interface Window { google?: any; } }

function loadGis(): Promise<void> {
  if (window.google?.accounts?.id) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true; s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Failed to load Google sign-in"));
    document.head.appendChild(s);
  });
}

export function LoginScreen() {
  const { refresh } = useAuth();
  const btnRef = useRef<HTMLDivElement>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const cfg = await fetch("/functions/v1/auth/config").then((r) => r.json());
        await loadGis();
        if (cancelled || !btnRef.current || !cfg.clientId) return;
        window.google.accounts.id.initialize({
          client_id: cfg.clientId,
          hd: "instalily.ai",
          callback: async (resp: { credential: string }) => {
            setErr(null);
            const r = await fetch("/functions/v1/auth/google", {
              method: "POST", credentials: "same-origin",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ credential: resp.credential }),
            });
            if (r.ok) { await refresh(); }
            else { const b = await r.json().catch(() => ({})); setErr(b.error === "not an instalily.ai account" ? "Use your @instalily.ai Google account." : "Sign-in failed. Try again."); }
          },
        });
        window.google.accounts.id.renderButton(btnRef.current, { theme: "outline", size: "large", type: "standard" });
      } catch { if (!cancelled) setErr("Couldn't load Google sign-in. Refresh to retry."); }
    })();
    return () => { cancelled = true; };
  }, [refresh]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="bg-white border border-border rounded-2xl shadow-sm px-8 py-10 w-full max-w-sm text-center">
        <h1 className="text-2xl mb-1">EventHub</h1>
        <p className="text-sm text-gray-500 mb-6">Sign in with your Instalily account.</p>
        <div ref={btnRef} className="flex justify-center" />
        {err && <p className="text-[13px] text-red-600 mt-4">{err}</p>}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Gate the app in `App.tsx`**

Modify `src/App.tsx`. Add imports at top:

```tsx
import { useAuth } from './lib/auth';
import { LoginScreen } from './components/LoginScreen';
import { proxiedBackend } from './lib/supabase';
```

Inside `export default function Component()`, add near the other hooks (unconditional):

```tsx
  const { status: authStatus, user: authUser } = useAuth();
```

Then, immediately before the existing `return (` of the component, add the gate:

```tsx
  if (authStatus === 'loading') {
    return <div className="min-h-screen flex items-center justify-center text-gray-400">Loading…</div>;
  }
  if (authStatus === 'unauthed') {
    return <LoginScreen />;
  }
```

Change the existing `<ProfileProvider>` opening tag to pass the authenticated profile in prod:

```tsx
    <ProfileProvider forcedProfileId={proxiedBackend ? (authUser?.profileId || null) : null}>
```

(`forcedProfileId` is added to `ProfileProvider` in Task 6. Until then it's an ignored prop — harmless.)

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no new errors (a TS error on unknown `forcedProfileId` prop resolves in Task 6; if strict, do Task 6 before re-checking).

- [ ] **Step 4: Commit**

```bash
git add src/components/LoginScreen.tsx src/App.tsx
git commit -m "feat(auth): Google sign-in screen + app login gate"
```

---

### Task 6: Lock the current profile to the signed-in user

Replace honor-system profile switching (in prod) with the authenticated identity; keep the dev switcher.

**Files:**
- Modify: `src/lib/profile.tsx`
- Modify: `src/components/ProfileSwitcher.tsx`

**Interfaces:**
- `ProfileProvider` gains optional prop `forcedProfileId?: string | null`.
- `useProfile()` context gains `locked: boolean` (true when `forcedProfileId` is set).

- [ ] **Step 1: Add `forcedProfileId` + `locked` to `ProfileProvider`**

Modify `src/lib/profile.tsx`:

- Add `locked: boolean;` to the `ProfileCtx` interface and its default (`locked: false`).
- Change the provider signature and body:

```tsx
export function ProfileProvider({ children, forcedProfileId = null }: { children: ReactNode; forcedProfileId?: string | null }) {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(() => forcedProfileId ?? localStorage.getItem(KEY));

  const refresh = async () => {
    const p = await listProfiles().catch(() => [] as Profile[]);
    setProfiles(p);
    setCurrentId((id) => forcedProfileId ?? (id && p.some((x) => x.id === id) ? id : p[0]?.id ?? null));
  };
  useEffect(() => { void refresh(); }, []);
  // Keep the current profile pinned to the signed-in user when forced.
  useEffect(() => { if (forcedProfileId) setCurrentId(forcedProfileId); }, [forcedProfileId]);

  const setCurrent = (id: string | null) => {
    if (forcedProfileId) return; // switching disabled when auth pins the identity
    setCurrentId(id);
    if (id) localStorage.setItem(KEY, id); else localStorage.removeItem(KEY);
  };

  const current = profiles.find((p) => p.id === currentId) ?? null;
  return <Ctx.Provider value={{ profiles, current, setCurrent, refresh, locked: !!forcedProfileId }}>{children}</Ctx.Provider>;
}
```

- [ ] **Step 2: Make `ProfileSwitcher` read-only + Sign out when locked**

Modify `src/components/ProfileSwitcher.tsx` — add `useAuth` import and a locked branch at the top of the returned JSX:

```tsx
import { useAuth } from "../lib/auth";
```

Pull `locked` from the profile context (`const { profiles, current, setCurrent, refresh, locked } = useProfile();`) and `const { signOut } = useAuth();`, then at the start of `return (`:

```tsx
  if (locked) {
    return (
      <div className="flex items-center gap-2">
        <Avatar p={current} />
        <span className="text-sm text-gray-700 max-w-[10rem] truncate">{current?.name ?? "…"}</span>
        <button onClick={() => void signOut()} className="text-sm text-gray-500 hover:text-gray-900 ml-1">Sign out</button>
      </div>
    );
  }
```

(The existing dropdown implementation stays below for dev/unlocked mode.)

- [ ] **Step 3: Typecheck + full test suite**

Run: `npx tsc --noEmit -p tsconfig.json && npx vitest run`
Expected: no type errors; all existing tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/lib/profile.tsx src/components/ProfileSwitcher.tsx
git commit -m "feat(auth): pin current profile to signed-in user; read-only switcher + sign out"
```

---

### Task 7: Rollout & manual verification (MANUAL — not code)

These steps do NOT happen on `git push`. Do them to make auth live.

- [ ] **Step 1: Google Cloud Console — Web OAuth client**

In Google Cloud Console → APIs & Services → Credentials, confirm or create an **OAuth 2.0 Client ID** of type **Web application**. Under **Authorized JavaScript origins**, add the deployed origin (e.g. `https://eventhub-licvsmaspa-uc.a.run.app` and any custom domain). Copy the **Client ID**.

- [ ] **Step 2: Set the server env var on Cloud Run**

Add `GOOGLE_OAUTH_CLIENT_ID=<the client id>` to the `deploy.yml` `--set-env-vars` list (it is public — an env var, not a secret). `POSTGREST_JWT_SECRET` is already wired via `--set-secrets`.

Modify `.github/workflows/deploy.yml`: append `,GOOGLE_OAUTH_CLIENT_ID=<client-id>` to the `--set-env-vars` value (or add it as a repo secret and reference `${{ secrets.GOOGLE_OAUTH_CLIENT_ID }}`).

- [ ] **Step 3: Apply the grants migration to Cloud SQL**

Apply `supabase/migrations/20260710000000_auth_grants.sql` to the production database (same path you use for other migrations against Cloud SQL). Verify: `anon` has no table privileges; `authenticated` does.

- [ ] **Step 4: Deploy**

Merge/push so the image build ships the `auth` function + Caddy change. Confirm a new Cloud Run revision.

- [ ] **Step 5: Manual smoke test (deployed)**

1. Open the app in a fresh/incognito window → the login screen appears.
2. Sign in with an `@instalily.ai` account → lands in the app; the header shows your name + Sign out.
3. `curl -i https://<app>/rest/v1/event?select=id` with no cookie → not 200 (denied).
4. Sign out → back to the login screen.
5. (If testable) a non-instalily Google account → "Use your @instalily.ai Google account."

---

## Self-Review

- **Spec coverage:** GIS sign-in (T5) ✓; server verify + domain/email checks (T1/T2) ✓; auto-provision profile by email (T2) ✓; PostgREST-JWT session cookie (T1/T2) ✓; Caddy cookie forward (T3) ✓; anon lockdown / real gate (T3) ✓; per-user-ready claims (T1/T2) ✓; login wall + dev bypass (T4/T5) ✓; read-only current-user + sign out (T6) ✓; manual Google/env/migration steps (T7) ✓; 7-day session + `SameSite=Lax` + HttpOnly (T2, Global Constraints) ✓.
- **Placeholder scan:** none — all steps carry real code/SQL/commands.
- **Type consistency:** `AuthUser {profileId,email,name}` consistent across T4/T5; `forcedProfileId`/`locked` defined in T6 and consumed in T5/T6; cookie name `eh_session`, role `authenticated`, claims `email`/`profile_id` consistent across T1/T2/T3.
