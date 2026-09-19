# AxlePoint demo container. Three stages: install, build (generates the
# synthetic SQLite database plus a seed snapshot, then compiles the
# standalone Next.js server), and a slim runtime. Both the live database
# and its seed snapshot ship inside the image (data/axlepoint.db,
# data/axlepoint.seed.db). Runtime writes (demo work-order drafts) land in
# the container layer; the app itself resets them back to the seed
# snapshot on a schedule (src/lib/db.ts, decisions D-012), and a redeploy
# resets them too by replacing the whole image.
#
# Node 22 (node 20 is EOL, team standard is node 22; see
# docs/demos/axlepoint/decisions.md).

FROM node:22-bookworm-slim AS deps
WORKDIR /app
# better-sqlite3@12.10.0 ships a prebuilt binary for node 22 linux-x64
# (ABI 127), so this normally installs from the prebuild, not a compile.
# The toolchain stays anyway as a fallback: a docker build with it removed
# hit a prebuild-install network timeout once (2026-09-19, observed on the
# lumen-analytics sibling repo during this same change) with nothing to
# fall back to, and failed outright. Kept here, in the build stage only,
# so a flaky prebuild download degrades to a slower compile instead of a
# hard build failure.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN --mount=type=secret,id=npmrc,target=/root/.npmrc npm ci

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run db:generate && npm run build

FROM node:22-bookworm-slim AS run
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
COPY --from=build /app/data ./data
# The seed snapshot is read-only at runtime: nothing in the app writes to
# it (src/lib/db.ts only ever copies FROM it), and making that structural
# rather than just documented hardens the "seed is pristine" assumption
# the reset relies on (deep-verify PR #24, minor finding).
RUN chown -R node:node /app/data \
    && chmod 444 /app/data/axlepoint.seed.db
USER node
EXPOSE 3000
CMD ["node", "server.js"]
