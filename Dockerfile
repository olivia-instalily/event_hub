# EventHub — Cloud Run image: build the SPA, serve it (+ reverse-proxy Supabase) with Caddy.
#
# Build args:
#   GITHUB_PACKAGES_TOKEN - read:packages token for the private @instalily/ui package
# The frontend is built with NO VITE_SUPABASE_* vars → at runtime the app uses its own origin
# and the Caddy proxy (see Caddyfile) forwards to Supabase, injecting the anon key server-side.

# --- build ---
FROM node:20-slim AS build
WORKDIR /app

# Auth for the private GitHub Packages registry, then install deps (cached on package files).
ARG GITHUB_PACKAGES_TOKEN
COPY package*.json .npmrc ./
RUN npm config set //npm.pkg.github.com/:_authToken="${GITHUB_PACKAGES_TOKEN}" \
 && npm ci

COPY . .
# Intentionally no VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY → same-origin proxy mode.
RUN npm run build

# --- serve ---
FROM caddy:2-alpine
COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist /srv
# Cloud Run sets $PORT; Caddy listens on it (see Caddyfile).
