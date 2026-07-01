# Daylight — single-image deploy: the Next.js web read-path + the in-process daily
# Ledger scheduler (apps/web/instrumentation.ts) share one SQLite file on a Fly volume.
FROM node:22-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
# Build toolchain is a fallback for better-sqlite3 if no prebuilt binary is available.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable

FROM base AS build
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
# Floodlight/Receipts live capture (FLAG_FLOODLIGHT_SCAN / live snapshots) needs a browser.
# It's off by default; uncomment to enable — adds ~300MB and wants a ~1GB-RAM machine.
# RUN pnpm --filter @daylight/floodlight exec playwright install --with-deps chromium
RUN pnpm --filter @daylight/web build

# Runtime reuses the build layer (source + deps present so the tsx-run Ledger worker
# and better-sqlite3 native addon are available). Image size is a non-goal here.
FROM build AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV DAYLIGHT_DB_PATH=/data/daylight.db
ENV PORT=3000
# Daily Ledger pass, run in-process by the web server (00:17 UTC by default).
ENV DAYLIGHT_LEDGER_CRON="17 0 * * *"
EXPOSE 3000
CMD ["pnpm", "--filter", "@daylight/web", "start"]
