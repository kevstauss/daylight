// Redtape assessment CLI: for each watched apex where Floodlight/Receipts detected PII
// collection or tracking, run the AI researcher and queue a gap for HUMAN review. Nothing is
// published — every gap lands unreviewed. Needs ANTHROPIC_API_KEY (+ DAYLIGHT_REDTAPE_MODEL).
//
//   pnpm --filter @daylight/redtape assess

import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { loadWatchlist } from "@daylight/core";
import { createDb, resolveDbPath } from "@daylight/db";
import { claudeResearcher, runRedtapeAssessment, type ResearcherInput } from "./index.js";

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

  // Candidates = watched apexes where a Floodlight scorecard shows collection/tracking.
  const candidates: ResearcherInput[] = [];
  for (const domain of watchlist.apexDomains) {
    const evidence = new Set<string>();
    let url: string | null = null;
    for (const c of db.scorecardsByDomain(domain)) {
      url = url ?? c.url;
      if (c.session_replay) evidence.add("session replay detected");
      if (c.first_party_proxied) evidence.add("first-party reverse-proxied analytics");
      if (c.tracker_count) evidence.add(`${c.tracker_count} third-party trackers`);
      if (!c.privacy_notice_url) evidence.add("no linked privacy notice");
    }
    if (evidence.size > 0) candidates.push({ domain, url, collectsPiiEvidence: [...evidence] });
  }

  if (candidates.length === 0) {
    // eslint-disable-next-line no-console
    console.log("[redtape] no candidates with collection evidence yet — run Floodlight scans first");
    db.close();
    return;
  }

  try {
    for (const candidate of candidates) {
      const r = await runRedtapeAssessment({ db, candidate, researcher });
      // eslint-disable-next-line no-console
      console.log(
        `[redtape] ${candidate.domain}: ${r.assessment}${r.manual ? " (manual)" : ""} → gap #${r.gapId} queued for review`,
      );
    }
  } finally {
    db.close();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[redtape] fatal", err);
  process.exit(1);
});
