// Ledger CLI. `pnpm ledger` runs one daily pass; `pnpm ledger:seed` establishes a
// silent baseline (populate state without emitting a change per existing domain).

import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { loadWatchlist } from "@daylight/core";
import { createDb, resolveDbPath } from "@daylight/db";
import { DEFAULT_SOURCE_URL } from "./fetch.js";
import { runLedger } from "./run.js";

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

async function main(): Promise<void> {
  const seed = process.argv.includes("--seed");
  const watchlist = loadWatchlist(findWatchlist());
  const db = createDb(resolveDbPath());
  try {
    const res = await runLedger({
      db,
      watchlist,
      sourceUrl: process.env.DAYLIGHT_LEDGER_SOURCE?.trim() || DEFAULT_SOURCE_URL,
      emitChanges: !seed,
    });
    // eslint-disable-next-line no-console
    console.log(`[ledger]${seed ? " seed" : ""} ${JSON.stringify(res)}`);
    if (!res.ok) process.exitCode = 1;
  } finally {
    db.close();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[ledger] fatal", err);
  process.exit(1);
});
