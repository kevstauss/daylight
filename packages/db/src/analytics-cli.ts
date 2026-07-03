// Analytics maintenance CLI. `pnpm analytics:reset` clears the first-party analytics_hits table —
// the one-time wipe for a low-traffic launch whose counts got inflated by the operator's own
// testing. Destructive, so it no-ops (prints the current total + how to confirm) unless run with
// --yes. Targets DAYLIGHT_DB_PATH, so in prod: `fly ssh console -C "pnpm analytics:reset --yes"`.

import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createDb, resolveDbPath } from "./index.js";

// Where's the DB? Prefer DAYLIGHT_DB_PATH (always set in prod → /data/daylight.db). Without it,
// walk up from cwd for an existing data/daylight.db — so `pnpm analytics:reset` from anywhere in
// the workspace hits the real repo-root DB, not a fresh empty one under packages/db (pnpm runs
// filtered scripts in the package dir, which would otherwise mislead resolveDbPath's cwd default).
function findDbPath(): string {
  if (process.env.DAYLIGHT_DB_PATH?.trim()) return resolveDbPath();
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    const p = resolve(dir, "data", "daylight.db");
    if (existsSync(p)) return p;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return resolveDbPath();
}

function main(): void {
  const confirmed = process.argv.includes("--yes") || process.argv.includes("-y");
  const path = findDbPath();
  const db = createDb(path);
  try {
    const total = db.analyticsTotalVisits("0000-00-00"); // all-time
    if (!confirmed) {
      // eslint-disable-next-line no-console
      console.log(
        `[analytics] ${total} recorded hit(s) in ${path}\n` +
          `[analytics] dry run — nothing deleted. Re-run with --yes to wipe them all.`,
      );
      return;
    }
    const removed = db.resetAnalytics();
    // eslint-disable-next-line no-console
    console.log(`[analytics] reset — deleted ${removed} row(s) (${total} hit(s)) from ${path}`);
  } finally {
    db.close();
  }
}

try {
  main();
} catch (err) {
  // eslint-disable-next-line no-console
  console.error("[analytics] fatal", err);
  process.exit(1);
}
