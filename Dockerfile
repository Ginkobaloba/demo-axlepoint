# AxlePoint demo container. Three stages: install, build (compiles the
# standalone Next.js server), and a slim runtime.
#
# NO DATABASE SHIPS IN THE IMAGE ANY MORE. The demo data lives in Postgres
# (D-024) and the image is stateless. `npm run db:generate` was removed from
# the build step because it now writes to Postgres over DATABASE_URL, which
# does not and must not exist during a docker build -- a build that could
# reach a database would be a build that could seed the wrong one.
#
# Seeding is therefore a DEPLOY step, not a build step, and the container
# REQUIRES DATABASE_URL at runtime: src/lib/pg.ts throws without it rather
# than falling back to anything.
#
# Consequence worth stating: the 6-hourly visitor-data reset that used to be
# a file copy (old src/lib/db.ts, D-012) is NOT yet reimplemented against
# Postgres. Until it is, a deployed instance keeps visitor-created rows until
# the next reseed. See D-024.
#
# Node 22 (node 20 is EOL, team standard is node 22; see
# docs/demos/axlepoint/decisions.md).

FROM node:22-bookworm-slim AS deps
WORKDIR /app
# The compile toolchain is no longer needed for better-sqlite3, which is
# gone (D-026). It is KEPT, not removed, because esbuild and unrs-resolver
# still install from prebuilt binaries and a prebuild download that times
# out falls back to compiling -- which is what failed outright on the
# lumen-analytics sibling on 2026-09-19 with no toolchain to fall back to.
# Removing it would be a change whose failure mode cannot be observed here,
# because docker build is blocked earlier on read:packages. Drop it once a
# build can actually be run and proven.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN --mount=type=secret,id=npmrc,target=/root/.npmrc npm ci

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS run
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
# No /app/data: there is no database in the image. The chmod 444 that used to
# protect the seed snapshot went with it -- that control existed to keep a
# FILE pristine, and there is no file to keep pristine now.
USER node
EXPOSE 3000
CMD ["node", "server.js"]
