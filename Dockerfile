# EventHub — Cloud Run image
#
# Processes inside the container (managed by start.sh):
#   1. PostgREST     — REST API over Cloud SQL (port 3000)
#   2. Node.js funcs — Express edge-function server (port 3001)
#   3. Caddy         — public ingress + internal routing (port 8080 / 9000)
#
# Build args:
#   GITHUB_PACKAGES_TOKEN  - read:packages token for @instalily/ui

# ── Stage 1: build the SPA ────────────────────────────────────────────────────
FROM node:22-alpine AS spa-build
WORKDIR /app

ARG GITHUB_PACKAGES_TOKEN
COPY package*.json .npmrc ./
RUN npm config set //npm.pkg.github.com/:_authToken="${GITHUB_PACKAGES_TOKEN}" \
 && npm ci

COPY . .
# No VITE_SUPABASE_* → same-origin proxy mode via Caddy
RUN npm run build

# ── Stage 2: build the Node.js functions ─────────────────────────────────────
FROM node:22-alpine AS functions-build
WORKDIR /functions

COPY cloud-functions/package*.json ./
RUN npm ci

COPY cloud-functions/ ./
RUN npm run build

# ── Stage 3: final runtime image ─────────────────────────────────────────────
FROM node:22-alpine

# Install Caddy
RUN apk add --no-cache caddy

# Install Cloud SQL Auth Proxy
RUN wget -q https://storage.googleapis.com/cloud-sql-connectors/cloud-sql-proxy/v2.11.0/cloud-sql-proxy.linux.amd64 \
    -O /usr/local/bin/cloud-sql-proxy \
 && chmod +x /usr/local/bin/cloud-sql-proxy

# Download PostgREST binary
RUN wget -q https://github.com/PostgREST/postgrest/releases/download/v12.2.3/postgrest-v12.2.3-linux-static-x64.tar.xz \
    -O /tmp/postgrest.tar.xz \
 && tar -xf /tmp/postgrest.tar.xz -C /usr/local/bin \
 && chmod +x /usr/local/bin/postgrest \
 && rm /tmp/postgrest.tar.xz

# Copy SPA
COPY --from=spa-build /app/dist /srv

# Copy built functions
WORKDIR /functions
COPY --from=functions-build /functions/dist ./dist
COPY --from=functions-build /functions/node_modules ./node_modules
COPY --from=functions-build /functions/package.json ./

# Copy Caddy config
COPY Caddyfile /etc/caddy/Caddyfile

# Copy startup script
COPY start.sh /start.sh
RUN chmod +x /start.sh

EXPOSE 8080

CMD ["/start.sh"]
