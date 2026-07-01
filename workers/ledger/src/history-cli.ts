// Ledger git-history backfill CLI (one-time): replays the CISA registry's commit history so
// the site launches with years of dated ownership/contact changes we "missed" by not
// watching live. Reads only the public git repo. Idempotent — a re-run is a no-op.
//
//   pnpm --filter @daylight/ledger ledger:history            # full backfill (~489 commits)
//   pnpm --filter @daylight/ledger ledger:history -- --max=10  # last 10 commits (quick check)
//   pnpm --filter @daylight/ledger ledger:history -- --force   # re-run even if complete
//   pnpm --filter @daylight/ledger ledger:history -- --reset   # clean rebuild (clear + replay)

import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { loadWatchlist } from "@daylight/core";
import { createDb, resolveDbPath } from "@daylight/db";
import { backfillHistory, fetchCsvAtCommit, listCsvCommits } from "./history.js";

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
  const reset = process.argv.includes("--reset");
  const force = process.argv.includes("--force") || reset;
  const maxArg = process.argv.find((a) => a.startsWith("--max="));
  const max = maxArg ? Number.parseInt(maxArg.split("=")[1] ?? "", 10) : undefined;

  const watchlist = loadWatchlist(findWatchlist());
  const db = createDb(resolveDbPath());
  try {
    // eslint-disable-next-line no-console
    console.log("[ledger:history] listing commits touching current-federal.csv…");
    let commits = await listCsvCommits();
    // eslint-disable-next-line no-console
    console.log(
      `[ledger:history] ${commits.length} commits (${commits[0]?.date?.slice(0, 10)} → ${commits.at(-1)?.date?.slice(0, 10)})`,
    );
    if (max && Number.isFinite(max)) commits = commits.slice(-max);

    let fetched = 0;
    const getCsv = async (sha: string): Promise<string> => {
      const csv = await fetchCsvAtCommit(sha);
      fetched++;
      if (fetched % 25 === 0) {
        // eslint-disable-next-line no-console
        console.log(`[ledger:history]   fetched ${fetched}/${commits.length}…`);
      }
      return csv;
    };

    const res = await backfillHistory({ db, watchlist, commits, getCsv, force, reset });
    // eslint-disable-next-line no-console
    console.log(`[ledger:history] ${JSON.stringify(res)}`);
    if (!res.ok) process.exitCode = 1;
  } finally {
    db.close();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[ledger:history] fatal", err);
  process.exit(1);
});
