// Redtape assessment CLI: for each watched apex where Floodlight/Receipts detected PII
// collection or tracking, run the AI researcher and queue a gap for HUMAN review. Nothing is
// published — every gap lands unreviewed. Needs ANTHROPIC_API_KEY (+ DAYLIGHT_REDTAPE_MODEL).
//
//   pnpm --filter @daylight/redtape assess

import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { loadWatchlist } from "@daylight/core";
import { createDb, resolveDbPath } from "@daylight/db";
import { claudeResearcher, runRedtapeSweep } from "./index.js";

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
  const watchlist = loadWatchlist(findWatchlist());
  const db = createDb(resolveDbPath());
  const researcher = claudeResearcher();
  // Record a scan for /status — same as the cron path (instrumentation.ts) and every other
  // worker CLI. Without this a manual `assess` run left /status showing the last CRON run.
  const scanId = db.recordScanStart("redtape");
  try {
    // Idempotent: only NEW/changed candidates get assessed; published gaps get re-checked.
    const r = await runRedtapeSweep({ db, watchlist, researcher, log: (m) => console.log(m) });
    db.recordScanFinish(scanId, {
      ok: true,
      itemsSeen: r.candidates,
      changesEmitted: r.assessed + r.requeued,
    });
    // eslint-disable-next-line no-console
    console.log(
      `[redtape] sweep complete — ${r.candidates} candidates, ${r.assessed} assessed, ${r.skipped} unchanged, ${r.requeued} re-queued`,
    );
  } catch (err) {
    db.recordScanFinish(scanId, { ok: false, error: String(err), itemsSeen: 0, changesEmitted: 0 });
    throw err;
  } finally {
    db.close();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[redtape] fatal", err);
  process.exit(1);
});
