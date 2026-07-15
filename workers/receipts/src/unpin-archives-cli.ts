// One-time (idempotent) cleanup of archive links that were never receipts.
//
// Before the 90s-timeout fix, a capture that SPN2 hadn't confirmed in time was recorded as
// `https://web.archive.org/web/<url>` — no timestamp. That renders identically to a real
// archive but resolves to whatever the Internet Archive captured MOST RECENTLY, so it shows
// the page's current state rather than the state we snapshotted. On a removal ledger that is
// exactly backwards: the "proof" a tracker was there would show the page without it.
//
// These rows are cleared rather than repaired. A pinned capture taken now is not evidence of
// what a page looked like weeks ago, and we have no proof the content is unchanged for those
// old rows. Clearing them lets the normal retry path re-archive the page on the next sweep,
// which only attaches a fresh capture to an existing row when the content hash proves the page
// hasn't changed since. Honest gap now, real receipt shortly. Safe to re-run.
//
//   pnpm receipts:unpin-archives
//   # in prod:  fly ssh console -a daylight-watchdog -C "pnpm receipts:unpin-archives"

import { createDb, resolveDbPath } from "@daylight/db";
import { isTimestampedArchiveUrl } from "./wayback.js";

function main(): void {
  const dryRun = process.argv.includes("--dry-run");
  const db = createDb(resolveDbPath());
  try {
    const bad = db.archivedSnapshotRefs().filter((r) => !isTimestampedArchiveUrl(r.wayback_url));
    if (dryRun) {
      for (const r of bad) console.log(`  would clear #${r.id}: ${r.wayback_url}`);
    } else {
      for (const r of bad) db.updateSnapshotWayback(r.id, null);
    }
    console.log(
      `[receipts:unpin-archives] ${bad.length} un-pinned archive link(s) ` +
        `${dryRun ? "found (dry run — nothing written)" : "cleared; the next sweep will re-archive"}.`,
    );
  } finally {
    db.close();
  }
}

main();
