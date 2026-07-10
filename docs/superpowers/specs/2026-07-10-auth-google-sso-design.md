# Authentication — Google Identity Services, gated to @instalily.ai

**Status:** Approved design (2026-07-10)
**Scope:** Add a real login gate to EventHub. Every account is a verified `@instalily.ai`
Google Workspace identity, linked to a `profile` row. Gate-only authorization for now,
architected so per-user permissions can be layered on later without an auth rewrite.

## Goals

- Only verified `@instalily.ai` Google accounts can use the app (UI **and** API).
- Each session is tied to a `profile` (linked or auto-created by email).
- Minimal new infrastructure — runs on the existing prod stack (Caddy + PostgREST + Node
  functions on Cloud Run), reusing existing secrets.
- Identity plumbing is per-user-ready: the session JWT carries `email` + `profile_id`, so
  future row-level security is additive.

## Non-goals (for this iteration)

- Per-user data isolation / roles / RLS policies (deferred; the plumbing is prepared but no
  policies are written now — every signed-in user still sees and edits everything).
- Local-dev auth parity. Local dev uses the Supabase stack (no Caddy/cookie); the login wall
  is intentionally bypassed there.
- Google API access on behalf of the user (we need identity only, not access/refresh tokens).

## Context — how identity works today

- A `profile` table exists (`id`, `name`, `email`, `color`) but there is **no auth**. The
  `ProfileSwitcher` is an honor-system "Acting as" dropdown stored in `localStorage`.
- Prod backend: PostgREST over Cloud SQL, fronted by Caddy, which injects a **single static
  anon JWT** (`POSTGREST_ANON_JWT`, `role: anon`) on every `/rest/*` request. PostgREST selects
  the Postgres role from the JWT's `role` claim; JWTs are verified with `POSTGREST_JWT_SECRET`.
  `PGRST_DB_ANON_ROLE=anon`.
- Node edge functions run at `/functions/v1/*` (Caddy strips the prefix). They talk to PostgREST
  internally on `:9000` with a service JWT.
- Local dev uses the **Supabase** stack directly (`VITE_SUPABASE_URL`/`ANON_KEY` set); prod
  leaves those unset and talks same-origin through Caddy (`proxiedBackend === true`).

## Chosen approach — Google Identity Services (GIS)

GIS renders the native "Sign in with Google" button; Google returns a signed **ID token** to the
browser. The backend verifies that token and mints its own session — no OAuth redirect/code
exchange, no per-user refresh tokens. This is the least code and fits the raw-PostgREST prod
stack. (Rejected: full OAuth redirect flow — overkill; Supabase Auth — not running in prod;
Google IAP — infra-heavy.)

## Flow (prod)

1. App loads → `AuthProvider` calls `GET /functions/v1/auth/me` (cookie sent automatically).
2. `401` → render `LoginScreen` with the GIS button (client_id from `GET /auth/config`, domain
   hint `hd: instalily.ai`).
3. User signs in → browser receives an ID token → SPA `POST /functions/v1/auth/google { credential }`.
4. `auth` function verifies the token (signature, `aud` = client_id, `iss`, `exp`) via
   `google-auth-library`; enforces `email_verified === true` **and** `hd === 'instalily.ai'`
   (reject otherwise, `403`).
5. Link or auto-create the `profile` by email (name/color from Google when creating).
6. Mint session JWT (HS256, signed with `POSTGREST_JWT_SECRET`), claims
   `{ role: 'authenticated', email, profile_id, exp: now + 7 days }`. Set cookie
   `eh_session=<jwt>; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=604800`.
7. Return `{ profileId, email, name }`; SPA re-checks `/auth/me` and renders the app.

## Components

### 1. `cloud-functions/src/functions/auth.ts` (new) + route registration in `index.ts`

Routes (all under Caddy's `/functions/v1` prefix):
- `GET /auth/config` → `{ clientId }` from `GOOGLE_OAUTH_CLIENT_ID` (public value; safe to expose).
- `POST /auth/google` `{ credential }` → verify ID token, enforce domain + `email_verified`,
  link/create profile, mint session JWT, `Set-Cookie eh_session`, return `{ profileId, email, name }`.
- `GET /auth/me` → read + verify `eh_session`; return `{ profileId, email, name }` or `401`.
- `POST /auth/logout` → clear the cookie (`Max-Age=0`), `204`.

Profile linking uses the internal service client (as other functions do). ID-token verification
and the domain/email checks live in a **pure helper** (`verifyGoogleCredential`) so they're unit
testable without network.

### 2. Caddy (`Caddyfile`)

`/rest/*` stops injecting the static anon JWT and instead forwards the session cookie:

```
handle /rest/* {
    uri strip_prefix /rest/v1
    reverse_proxy localhost:3000 {
        header_up Authorization "Bearer {http.request.cookie.eh_session}"
        header_up apikey ""
    }
}
```

No cookie → empty/invalid Bearer → PostgREST falls back to the (locked-down) `anon` role → denied.
The internal `:9000` server (functions → PostgREST, service JWT) is unchanged.

### 3. DB migration (`supabase/migrations/<ts>_auth_grants.sql`)

Make the gate real, not UI-only: grant the privileges `anon` currently holds to the
`authenticated` role and revoke them from `anon`.

- Ensure the `authenticated` role exists (it does in Supabase-derived DBs; create if missing).
- `GRANT USAGE ON SCHEMA public TO authenticated;`
- `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;`
- `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;`
- `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ... TO authenticated;` (tables + sequences)
- `REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;` (+ sequences; keep `USAGE ON SCHEMA`
  only if needed for error clarity — otherwise revoke). Net effect: no-cookie requests can't
  read/write data.

Applied manually to Cloud SQL, like other migrations.

### 4. Frontend

- **`src/lib/auth.tsx` — `AuthProvider`** (wraps the app above `ProfileProvider`): on mount,
  `GET /auth/me`. State: `loading | authed(user) | unauthed`. Exposes `user`, `signOut()`.
  - In dev (`proxiedBackend === false`): skip the gate entirely, report `authed` with the
    existing profile selection so local dev is unblocked.
- **`src/components/LoginScreen.tsx`** (new): full-screen centered card, loads the GIS script,
  fetches `clientId` from `/auth/config`, renders the button with `hd: instalily.ai`. On
  `credential`, `POST /auth/google`; on success refresh `/auth/me`. On `403` show
  "Use your @instalily.ai Google account."
- **`ProfileSwitcher`**: in prod, the "Acting as" switching is removed — it shows the
  authenticated user (from `/auth/me`) as a read-only chip plus **Sign out**. The current
  profile (`useProfile().current`) is the authenticated profile, not a `localStorage` pick.
  In dev, the existing switcher behavior is kept.
- **`App.tsx`**: render `LoginScreen` when `AuthProvider` reports `unauthed`; otherwise the app.

## Session & security

- ID token verified server-side: signature, `aud === GOOGLE_OAUTH_CLIENT_ID`, issuer, expiry.
- Access requires `email_verified === true` **and** `hd === 'instalily.ai'` (also assert the
  email ends with `@instalily.ai`).
- Session cookie is `HttpOnly` (JS can't read it), `Secure`, `SameSite=Lax`, `Path=/`,
  7-day `Max-Age`. Signed with `POSTGREST_JWT_SECRET`.
- `anon` is locked down so `/rest` is not publicly reachable.

## Error handling

- Non-instalily / unverified account → `403`; LoginScreen shows a clear message and stays.
- Expired/invalid/missing cookie → `/auth/me` returns `401` → LoginScreen.
- GIS script fails to load → LoginScreen shows a retry/fallback message.
- `auth/google` DB error while linking → `500`; login not granted.

## Testing

- **Unit** (`cloud-functions`): `verifyGoogleCredential` — accepts a valid instalily token
  (mocked verifier), rejects wrong domain, rejects `email_verified === false`, rejects bad
  audience. Session JWT minting produces the expected claims (`role`, `email`, `profile_id`, `exp`).
- **Unit** (frontend): `AuthProvider` state machine — `me` 200 → authed; 401 → unauthed; dev
  bypass path.
- **Manual (deployed):** full sign-in with an instalily account; rejection of a non-instalily
  account; sign-out; direct `/rest` call without a cookie is denied.

## Manual / deploy-parity steps (do NOT happen on `git push`)

1. **Google Cloud Console:** confirm/create a **Web application** OAuth client; add the app's
   URL(s) as *Authorized JavaScript origins*; copy its **client_id**.
2. **Cloud Run:** set `GOOGLE_OAUTH_CLIENT_ID` (public client_id) as an env var. Signing reuses
   the existing `POSTGREST_JWT_SECRET` secret.
3. **Cloud SQL:** apply the auth grants/revoke migration.
4. Deploy — the `auth` function and Caddy change ship in the container image build.

## Open items (defaults chosen; adjustable)

- Session length: **7 days**.
- `anon` fully locked down: **yes**.
