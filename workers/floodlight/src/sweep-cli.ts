// Floodlight sweep CLI: scan a curated set of federal .gov homepages (+ the watched apexes)
// once through the live capture path, persisting a tracker scorecard for each. Public,
// load-only, .gov-restricted (same guardrails as the /floodlight/scan box).
//
//   pnpm --filter @daylight/floodlight sweep

import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { loadWatchlist } from "@daylight/core";
import { createDb, resolveDbPath } from "@daylight/db";
import { captureAndScore } from "./capture.js";

// Prominent federal .gov sites — a starting "hall of shame" set for the tracker scorecard.
const CURATED = [
  "whitehouse.gov", "usa.gov", "irs.gov", "ssa.gov", "medicare.gov", "medicaid.gov",
  "studentaid.gov", "va.gov", "cdc.gov", "weather.gov", "nih.gov", "ftc.gov",
  "consumerfinance.gov", "benefits.gov", "healthcare.gov", "congress.gov", "ready.gov",
  "vote.gov", "recreation.gov", "usajobs.gov", "sam.gov", "grants.gov",
];

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
  const watched = wlPath ? [...loadWatchlist(wlPath).apexDomains, ...loadWatchlist(wlPath).subdomainApexes] : [];
  const hosts = [...new Set([...CURATED, ...watched])].filter((h) => h.endsWith(".gov"));
  const db = createDb(resolveDbPath());
  const channel = process.env.DAYLIGHT_BROWSER_CHANNEL;
  let ok = 0;
  let flagged = 0;
  try {
    for (const host of hosts) {
      const url = `https://${host}/`;
      const r = await captureAndScore(db, url, { channel, govOnly: true });
      if (r.ok) ok++;
      if (r.severity === "high" || r.severity === "notable") flagged++;
      // eslint-disable-next-line no-console
      console.log(
        `[floodlight] ${host}: ${r.ok ? (r.gated ? "gated (noted, not scraped)" : r.severity) : `error: ${r.error}`}`,
      );
    }
    // eslint-disable-next-line no-console
    console.log(`[floodlight] sweep complete — ${ok}/${hosts.length} scanned, ${flagged} flagged`);
  } finally {
    db.close();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[floodlight] sweep fatal", err);
  process.exit(1);
});
