// Foundry scan CLI — the WRITE path (contrast src/cli.ts `report`, which only prints). Runs a full
// Foundry pass: records a `/status` scan and emits an `added` change the first time each unlaunched
// project is seen (idempotent via a per-(vendor,project) observation, so a re-run never re-floods
// the feed). This is exactly what the DAYLIGHT_FOUNDRY_CRON scheduler runs — use it to seed prod
// once or to force a pass between crons. Existence-only: reads stored CT×registry data, never
// connects to any discovered host.
//
// Usage: pnpm --filter @daylight/foundry scan   (or `pnpm foundry` from the repo root)

import { nowIso } from "@daylight/core";
import { createDb, resolveDbPath } from "@daylight/db";
import { runFoundryScan } from "./run.js";

function main(): void {
  const db = createDb(resolveDbPath());
  try {
    const { report, changesEmitted } = runFoundryScan(db, nowIso());
    const projects = report.vendors.reduce((n, v) => n + v.projectCount, 0);
    // eslint-disable-next-line no-console
    console.log(
      `[foundry] scan complete — ${report.vendors.length} vendor(s), ${projects} project(s), ` +
        `${changesEmitted} new change(s) emitted.`,
    );
  } finally {
    db.close();
  }
}

try {
  main();
} catch (err) {
  // eslint-disable-next-line no-console
  console.error("[foundry] fatal", err);
  process.exit(1);
}
