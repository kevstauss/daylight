// One-time (idempotent) backfill of the domains.first_seen COLUMN. The read path already shows an
// honest label (registered / longstanding / on-record), but the raw column still holds the uniform
// baseline-seed date; this rewrites it to each domain's true earliest `added` date, and — once the
// git-history backfill has run — sets longstanding domains to the 2019 record start. Safe to re-run.
//
//   pnpm ledger:backfill-first-seen
//   # in prod:  fly ssh console -a daylight-watchdog -C "pnpm ledger:backfill-first-seen"

import { createDb, resolveDbPath } from "@daylight/db";

function main(): void {
  const db = createDb(resolveDbPath());
  try {
    const res = db.backfillFirstSeen();
    // eslint-disable-next-line no-console
    console.log(
      `[ledger:backfill-first-seen] ${res.registered} domain(s) set to their earliest 'added' date; ` +
        `${res.longstanding} longstanding domain(s) set to the 2019 record start` +
        (res.longstanding === 0 ? " (history backfill not yet run — left as-is)." : "."),
    );
  } finally {
    db.close();
  }
}

main();
