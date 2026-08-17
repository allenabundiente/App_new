# syntax=docker/dockerfile:1
#
# HulogTrack API — one build, three deployable microservices + a one-shot
# migrator. The source is shared (single package); the Docker targets only
# differ in which entry point they run, so they never drift apart.
#
#   docker build --target auth       -t hulog-api-auth .
#   docker build --target core       -t hulog-api-core .
#   docker build --target engagement -t hulog-api-engagement .
#   docker build --target migrate    -t hulog-api-migrate .
#
# Or just `docker compose up --build` — compose builds all targets and wires
# them together with Postgres and the Caddy gateway (see docker-compose.yml).

# ── Build stage: install deps + compile TypeScript ────────────────────────
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ── Runtime base: production deps + compiled output + schema ──────────────
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
# db.ts resolves schema.sql relative to the compiled output (../schema.sql).
COPY schema.sql ./schema.sql

# ── migrate: apply schema.sql + seed, then exit (one-shot) ─────────────────
FROM runtime AS migrate
CMD ["node", "dist/entries/migrate.js"]

# ── auth: identity & directory (users, sessions) ───────────────────────────
FROM runtime AS auth
ENV PORT=4001
EXPOSE 4001
CMD ["node", "dist/entries/auth.js"]

# ── core: customers, products, plans, payments, adjustments, settings ──────
FROM runtime AS core
ENV PORT=4002
EXPOSE 4002
CMD ["node", "dist/entries/core.js"]

# ── engagement: chat, notifications, audit + reminder scheduler ────────────
FROM runtime AS engagement
ENV PORT=4003
EXPOSE 4003
CMD ["node", "dist/entries/engagement.js"]
