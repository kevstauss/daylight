// Receipts snapshot CLI — snapshot the watched apex homepages live (DOM + screenshot),
// diff vs the last snapshot, and emit removals. Public pages, load-only (same guardrails as
// Floodlight). Wayback archiving is opt-in via DAYLIGHT_WAYBACK=1.
//
// Usage: pnpm --filter @daylight/receipts snapshot

import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { loadWatchlist } from "@daylight/core";
import { createDb, resolveDbPath } from "@daylight/db";
import { captureAndSnapshot } from "./live.js";
import { saveToWayback } from "./wayback.js";

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
  const wl = loadWatchlist(findWatchlist());
  const db = createDb(resolveDbPath());
  const wayback = process.env.DAYLIGHT_WAYBACK === "1" ? (u: string) => saveToWayback(u) : undefined;
  const channel = process.env.DAYLIGHT_BROWSER_CHANNEL;
  const targets = wl.apexDomains.map((d) => `https://${d}/`);
  try {
    for (const url of targets) {
      const r = await captureAndSnapshot(db, url, { channel, waybackSave: wayback });
      const status = r.gated
        ? "gated (not entered)"
        : r.ok
          ? `ok — ${r.removed?.length ?? 0} removals`
          : `error: ${r.error}`;
      // eslint-disable-next-line no-console
      console.log(`[receipts] ${url}: ${status}`);
      await sleep(3000); // be gentle
    }
  } finally {
    db.close();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[receipts] fatal", err);
  process.exit(1);
});
