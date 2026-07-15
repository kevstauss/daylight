// Audit + repair the archive links Receipts has on file. Idempotent; safe to re-run.
//
// An archive link is the load-bearing part of a removal ledger: it is the independent copy that
// makes "this was here on that date" checkable by someone else. Two ways a stored link fails to
// be that, both found in prod:
//
//   1. NOT PINNED — `web.archive.org/web/<url>` with no timestamp. Renders like a real archive
//      but resolves to whatever IA captured MOST RECENTLY, so it shows the page's current state
//      instead of the state we snapshotted. Backwards on a removal ledger: the proof a tracker
//      was present would show the page without it. Detected offline; always cleared.
//
//   2. NOT A CAPTURE OF THE PAGE — pinned, but the capture is a 403/404 block page. Several
//      watched hosts sit behind bot protection that refuses IA's crawler, and SPN2 deduplicates
//      against recent captures, so a "successful" save can hand back another crawler's capture
//      of a refusal. Detected only by checking the public CDX index (--verify).
//
// Cleared links are not repaired in place: a capture taken now is not evidence of what a page
// looked like weeks ago. Clearing lets the normal sweep re-archive, which only attaches a fresh
// capture to an existing snapshot when the content hash proves the page has not changed since.
// An honest gap now, a real receipt shortly.
//
//   pnpm receipts:audit-archives --dry-run           # report only
//   pnpm receipts:audit-archives                     # clear un-pinned links (offline, instant)
//   pnpm receipts:audit-archives --verify            # also CDX-check every pinned link (slow)
//   # in prod:  fly ssh console -a daylight-watchdog -C "pnpm receipts:audit-archives --verify"

import { createDb, resolveDbPath } from "@daylight/db";
import { captureStatus, isDefinitelyNotPageCapture } from "./cdx.js";
import { isTimestampedArchiveUrl } from "./wayback.js";

const nap = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const verify = process.argv.includes("--verify");
  const db = createDb(resolveDbPath());
  const clear = (id: number, why: string, url: string): void => {
    console.log(`  ${dryRun ? "would clear" : "cleared"} #${id} — ${why}: ${url}`);
    if (!dryRun) db.updateSnapshotWayback(id, null);
  };

  try {
    const all = db.archivedSnapshotRefs();
    console.log(`[receipts:audit-archives] ${all.length} archive link(s) on file\n`);

    // ---- Pass 1: un-pinned links (offline) ----
    const unpinned = all.filter((r) => !isTimestampedArchiveUrl(r.wayback_url));
    console.log(`not timestamp-pinned: ${unpinned.length}`);
    for (const r of unpinned) clear(r.id, "not pinned to a capture", r.wayback_url);

    if (!verify) {
      console.log(`\nSkipped CDX verification (pass --verify to check every pinned link).`);
      return;
    }

    // ---- Pass 2: does each pinned link point at a capture of the PAGE? (network) ----
    const pinned = all.filter((r) => isTimestampedArchiveUrl(r.wayback_url));
    // CDX is slow for high-volume hosts, so this runs for tens of minutes. Report each link as
    // it lands — a silent hour is indistinguishable from a hung process.
    console.log(`\nverifying ${pinned.length} pinned link(s) against the CDX index — slow by design\n`);
    let ok = 0;
    const unknown: string[] = [];
    const bad: { id: number; url: string; status: string }[] = [];

    for (const [i, r] of pinned.entries()) {
      const m = /\/web\/(\d{14})\/(.+)$/.exec(r.wayback_url);
      if (!m) continue;
      const [, ts, pageUrl] = m as unknown as [string, string, string];
      const status = await captureStatus(pageUrl, ts);
      const n = `${String(i + 1).padStart(3)}/${pinned.length}`;
      if (isDefinitelyNotPageCapture(status)) {
        const code = status.known ? status.statusCode : "?";
        bad.push({ id: r.id, url: r.wayback_url, status: code });
        console.log(`  ${n}  BLOCK PAGE (${code})  ${pageUrl} @${ts}`);
      } else if (status.known) {
        ok++;
        console.log(`  ${n}  ok (${status.statusCode})       ${pageUrl} @${ts}`);
      } else {
        // Not evidence of anything — a redirecting host (cdc.gov → www.cdc.gov) indexes under
        // the redirect target, and the network can simply fail. Leave these alone.
        unknown.push(`#${r.id} ${pageUrl} @${ts} (${status.reason})`);
        console.log(`  ${n}  unknown           ${pageUrl} @${ts} — ${status.reason}`);
      }
      await nap(3000); // never hammer the index
    }

    console.log(`\n  capture of the page (200) : ${ok}`);
    console.log(`  capture of a block page   : ${bad.length}`);
    console.log(`  could not tell (left as-is): ${unknown.length}`);
    for (const u of unknown) console.log(`      ? ${u}`);
    if (bad.length) {
      console.log(`\nclearing links that point at a block page rather than the page:`);
      for (const b of bad) clear(b.id, `capture is HTTP ${b.status}, not the page`, b.url);
    }
    console.log(
      `\n[receipts:audit-archives] ${dryRun ? "dry run — nothing written" : `${unpinned.length + bad.length} link(s) cleared; the next sweep will re-archive`}.`,
    );
  } finally {
    db.close();
  }
}

await main();
