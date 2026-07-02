import { sha256, type Watchlist } from "@daylight/core";
import type { DaylightDb } from "@daylight/db";
import { parseAgentJson } from "./agent.js";
import { runRedtapeAssessment } from "./run.js";
import type { Researcher, ResearcherInput } from "./types.js";

export interface RedtapeSweepResult {
  candidates: number;
  assessed: number;
  skipped: number;
  requeued: number;
}

const evidenceKey = (evidence: string[]): string =>
  sha256([...evidence].map((e) => e.trim().toLowerCase()).sort().join("|"));

const parseArr = (json: string | null): string[] => {
  try {
    const v = JSON.parse(json ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
};

/** Build Redtape candidates from Floodlight collection evidence on the watched apexes. */
export function buildCandidates(db: DaylightDb, watchlist: Watchlist): ResearcherInput[] {
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
  return candidates;
}

/**
 * Idempotent Redtape sweep for scheduled runs:
 *  - assess only NEW candidates (or ones whose collection evidence changed) — dedup by hash, so
 *    re-running the same week is nearly free and doesn't flood the review queue with duplicates;
 *  - re-check already-PUBLISHED gaps: if a covering filing now appears to exist, pull the gap
 *    from public and re-queue it for human review (fail-safe — removing a possibly-stale claim
 *    needs no gate; a human confirms via /review before it would ever change again).
 * Everything new still lands unreviewed; nothing auto-publishes.
 */
export async function runRedtapeSweep(opts: {
  db: DaylightDb;
  watchlist: Watchlist;
  researcher: Researcher;
  now?: string;
  log?: (msg: string) => void;
}): Promise<RedtapeSweepResult> {
  const { db, watchlist, researcher } = opts;
  const out: RedtapeSweepResult = { candidates: 0, assessed: 0, skipped: 0, requeued: 0 };

  const candidates = buildCandidates(db, watchlist);
  out.candidates = candidates.length;

  for (const candidate of candidates) {
    const key = evidenceKey(candidate.collectsPiiEvidence);
    const alreadyAssessed = db
      .gapsByDomain(candidate.domain)
      .some((g) => evidenceKey(parseArr(g.collects_pii_evidence_json)) === key);
    if (alreadyAssessed) {
      out.skipped++;
      opts.log?.(`[redtape] ${candidate.domain}: unchanged evidence — skip`);
      continue;
    }
    const r = await runRedtapeAssessment({ db, candidate, researcher, now: opts.now });
    out.assessed++;
    opts.log?.(`[redtape] ${candidate.domain}: ${r.assessment} → gap #${r.gapId} queued`);
  }

  // Re-check published gaps — a newly-filed SORN should retract a stale "no filing" claim.
  for (const g of db.publicGaps(1000)) {
    if (g.gap_assessment === "covered") continue;
    const input: ResearcherInput = {
      domain: g.domain,
      url: g.url ?? null,
      collectsPiiEvidence: parseArr(g.collects_pii_evidence_json),
    };
    let parsed;
    try {
      parsed = parseAgentJson(await researcher(input));
    } catch {
      parsed = null;
    }
    if (parsed && parsed.gap_assessment === "covered") {
      db.requeueGap(
        g.id,
        `Auto re-check ${opts.now ?? ""}: a covering filing now appears to exist (was ${g.gap_assessment}). Pulled from public pending re-review.`,
      );
      out.requeued++;
      opts.log?.(`[redtape] ${g.domain}: filing now found — re-queued for review`);
    }
  }
  return out;
}
