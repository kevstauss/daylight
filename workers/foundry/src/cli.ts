// Foundry report CLI: prints the vendor build-graph (build-concentration index +
// unlaunched-project watch) over the CT subdomains + registry already in the DB. Run the Lookout
// backfill and a Ledger pass first so both tables are populated. Existence-only — reads stored
// public data, never connects to any host.
//
// Usage: pnpm --filter @daylight/foundry report

import { nowIso } from "@daylight/core";
import { createDb, resolveDbPath } from "@daylight/db";
import { runFoundry } from "./run.js";

function main(): void {
  const db = createDb(resolveDbPath());
  try {
    const report = runFoundry(db, nowIso());
    if (!report.vendors.length) {
      // eslint-disable-next-line no-console
      console.log("[foundry] no build vendors detected — run the Lookout backfill + a Ledger pass first.");
      return;
    }
    for (const v of report.vendors) {
      // eslint-disable-next-line no-console
      console.log(`\n=== vendor ${v.vendorApex}${v.ownerLabel ? ` (${v.ownerLabel})` : ""} — ${v.projectCount} projects, ${v.agencyCount} agencies ===`);
      // eslint-disable-next-line no-console
      console.log("  BUILD-CONCENTRATION INDEX (distinct owning agencies through this vendor):");
      for (const e of v.index) {
        // eslint-disable-next-line no-console
        console.log(`    * ${e.org} (${e.projects.length}): ${e.projects.map((p) => `${p.project}->${p.apex}`).join(", ")}`);
      }
      // eslint-disable-next-line no-console
      console.log("  UNLAUNCHED-PROJECT WATCH (CT host exists, target apex NOT in registry):");
      for (const u of v.unlaunched) {
        const conf = u.confidence === "low" ? " [low-confidence]" : "";
        // eslint-disable-next-line no-console
        console.log(`    * ${u.project} (cand ${u.candidateApexes[0] ?? "?"})${conf} — ${u.hosts.join(", ")}`);
      }
    }
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
