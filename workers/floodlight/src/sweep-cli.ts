// Floodlight sweep CLI: scan a curated set of federal .gov homepages (+ the watched apexes)
// once through the live capture path, persisting a tracker scorecard for each. Public,
// load-only, .gov-restricted (same guardrails as the /floodlight/scan box).
//
//   pnpm --filter @daylight/floodlight sweep

import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { loadWatchlist } from "@daylight/core";
import { createDb, resolveDbPath } from "@daylight/db";
import { CURATED_GOV, runFloodlightSweep } from "./sweep.js";

function findWatchlist(): string | null {
  const env = process.env.DAYLIGHT_WATCHLIST?.trim();
  if (env && existsSync(env)) return env;
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    const p = resolve(dir, "config", "watchlist.yaml");
    if (existsSync(p)) return p;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

async function main(): Promise<void> {
  const wlPath = findWatchlist();
  const wl = wlPath ? loadWatchlist(wlPath) : null;
  const hosts = [...CURATED_GOV, ...(wl?.apexDomains ?? []), ...(wl?.subdomainApexes ?? [])];
  const db = createDb(resolveDbPath());
  try {
    // eslint-disable-next-line no-console
    const r = await runFloodlightSweep(db, hosts, { channel: process.env.DAYLIGHT_BROWSER_CHANNEL, log: (m) => console.log(m) });
    // eslint-disable-next-line no-console
    console.log(
      `[floodlight] sweep complete — ${r.scanned} scanned, ${r.gated} gated, ${r.flagged} flagged, ${r.retried} recovered on retry` +
        (r.stillFailed.length ? `; still failing: ${r.stillFailed.join(", ")}` : ""),
    );
  } finally {
    db.close();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[floodlight] sweep fatal", err);
  process.exit(1);
});
