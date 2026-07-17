// GitHub org-monitoring CLI. `pnpm github` runs one poll (new repos + first commits under the
// watched federal orgs → Lookout events). `pnpm github:seed` populates state WITHOUT emitting, so a
// first run over the existing repo set doesn't flood the feed. A GITHUB_TOKEN is optional but
// recommended (raises the API rate limit 60→5000/hr); it needs no scopes for public reads.

import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { loadWatchlist } from "@daylight/core";
import { createDb, resolveDbPath } from "@daylight/db";
import { runGithubWatch } from "./run.js";

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
  const wl = loadWatchlist(findWatchlist());
  if (wl.githubOrgs.length === 0) {
    // eslint-disable-next-line no-console
    console.warn("[github] no github_orgs in the watchlist — nothing to poll.");
    return;
  }
  const db = createDb(resolveDbPath());
  try {
    const res = await runGithubWatch({ db, orgs: wl.githubOrgs, emitChanges: !seed });
    // eslint-disable-next-line no-console
    console.log(`[github]${seed ? " seed" : ""} ${JSON.stringify(res)}`);
    if (!res.ok) process.exitCode = 1;
  } finally {
    db.close();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[github] fatal", err);
  process.exit(1);
});
