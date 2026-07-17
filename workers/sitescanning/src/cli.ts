// Site Scanning CLI. `pnpm sitescanning` runs one pass (fetch GSA's daily dump, diff, promote
// unwatched .gov apexes into the Floodlight sweep). `pnpm sitescanning:seed` populates state
// WITHOUT queuing any promotion — a silent baseline, so the first run doesn't flag the whole
// federal web at once. Needs GSA_SITE_SCANNING_API_KEY (free at https://api.data.gov/signup/).

import { createDb, resolveDbPath } from "@daylight/db";
import { apiKeyFromEnv } from "./fetch.js";
import { runSiteScan } from "./run.js";

async function main(): Promise<void> {
  const seed = process.argv.includes("--seed");
  if (!apiKeyFromEnv()) {
    // eslint-disable-next-line no-console
    console.error(
      "[sitescanning] GSA_SITE_SCANNING_API_KEY not set — get a free key at https://api.data.gov/signup/ (DEMO_KEY works for a throttled test).",
    );
    process.exit(1);
  }
  const db = createDb(resolveDbPath());
  try {
    const res = await runSiteScan({ db, emitChanges: !seed });
    // eslint-disable-next-line no-console
    console.log(`[sitescanning]${seed ? " seed" : ""} ${JSON.stringify(res)}`);
    if (!res.ok) process.exitCode = 1;
  } finally {
    db.close();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[sitescanning] fatal", err);
  process.exit(1);
});
