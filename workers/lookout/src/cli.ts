// Lookout backfill CLI (increment 2a): pull public CT history for each watched apex from
// crt.sh and record new subdomains. Existence-only — never connects to a discovered host.
//
// Usage: pnpm --filter @daylight/lookout backfill

import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { loadWatchlist } from "@daylight/core";
import { createDb, resolveDbPath } from "@daylight/db";
import { fetchCrtShCerts } from "./crtsh.js";
import { runLookoutBackfill } from "./run.js";

function findWatchlist(): string {
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
  throw new Error("config/watchlist.yaml not found (set DAYLIGHT_WATCHLIST)");
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const watchlist = loadWatchlist(findWatchlist());
  const db = createDb(resolveDbPath());
  const apexes = [...watchlist.apexDomains, ...watchlist.subdomainApexes];
  let totalAdded = 0;
  let totalCerts = 0;
  // One scan row for the whole sweep, so /status reflects the full run (not the last apex,
  // which may have returned nothing when crt.sh 502'd on it).
  const scanId = db.recordScanStart("lookout");
  try {
    for (const apex of apexes) {
      const certs = await fetchCrtShCerts(apex);
      const res = runLookoutBackfill({ db, watchlist, certs, recordScan: false });
      totalAdded += res.subdomainsAdded;
      totalCerts += certs.length;
      // eslint-disable-next-line no-console
      console.log(`[lookout] ${apex}: ${certs.length} certs, ${res.subdomainsAdded} new subdomains`);
      await sleep(2000); // be gentle with crt.sh
    }
    db.recordScanFinish(scanId, { ok: true, itemsSeen: totalCerts, changesEmitted: totalAdded });
    // eslint-disable-next-line no-console
    console.log(`[lookout] backfill complete — ${totalAdded} new subdomains across ${apexes.length} apexes`);
  } catch (err) {
    db.recordScanFinish(scanId, {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      itemsSeen: totalCerts,
      changesEmitted: totalAdded,
    });
    throw err;
  } finally {
    db.close();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[lookout] fatal", err);
  process.exit(1);
});
