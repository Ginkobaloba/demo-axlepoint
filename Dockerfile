# AxlePoint demo container. Three stages: install, build (generates the
# synthetic SQLite database, then compiles the standalone Next.js server),
# and a slim runtime. The database ships inside the image; runtime writes
# (demo work-order drafts) land in the container layer and reset on
# redeploy, which is the intended behavior for a demo environment.

FROM node:20-bookworm-slim AS deps
WORKDIR /app
# better-sqlite3 compiles from source via node-gyp on this base image.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN --mount=type=secret,id=npmrc,target=/root/.npmrc npm ci

FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run db:generate && npm run build

FROM node:20-bookworm-slim AS run
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
COPY --from=build /app/data ./data
RUN chown -R node:node /app/data
USER node
EXPOSE 3000
CMD ["node", "server.js"]
