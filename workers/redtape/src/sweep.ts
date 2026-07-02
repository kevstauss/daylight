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

/** A "real" tracker count — above the ~1-2 that the official Digital Analytics Program (DAP)
 *  alone puts on most federal sites, so a bare DAP setup doesn't look like heavy tracking. */
const STRONG_TRACKER_MIN = 3;

/**
 * Build Redtape candidates from Floodlight scorecards that show a STRONG collection signal —
 * session replay, first-party-proxied analytics, or a tracker count above the DAP baseline. Every
 * scanned federal .gov qualifies (not just the watched apexes); the scanner is already .gov-only.
 *
 * "No linked privacy notice" is recorded as supporting evidence when a domain already qualifies,
 * but it is NOT a trigger on its own. It comes from a homepage link heuristic that misses notices
 * linked in non-obvious ways, so a null there is far too weak to justify queuing a public gap —
 * triggering on it flooded the review queue with low-confidence "no filing" gaps.
 */
export function buildCandidates(db: DaylightDb): ResearcherInput[] {
  const byDomain = new Map<string, { url: string | null; evidence: Set<string>; strong: boolean }>();
  for (const c of db.listScorecards({ limit: 2000 })) {
    const e = byDomain.get(c.domain) ?? { url: null, evidence: new Set<string>(), strong: false };
    e.url = e.url ?? c.url;
    if (c.session_replay) {
      e.evidence.add("session replay detected");
      e.strong = true;
    }
    if (c.first_party_proxied) {
      e.evidence.add("first-party reverse-proxied analytics");
      e.strong = true;
    }
    if (c.tracker_count) {
      e.evidence.add(`${c.tracker_count} third-party trackers`);
      if (c.tracker_count >= STRONG_TRACKER_MIN) e.strong = true;
    }
    if (!c.privacy_notice_url) e.evidence.add("no linked privacy notice"); // supporting only, not a trigger
    byDomain.set(c.domain, e);
  }
  const candidates: ResearcherInput[] = [];
  for (const [domain, e] of byDomain) {
    if (e.strong) candidates.push({ domain, url: e.url, collectsPiiEvidence: [...e.evidence] });
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
  researcher: Researcher;
  watchlist?: Watchlist; // no longer used for scoping — every scanned .gov is a candidate
  now?: string;
  log?: (msg: string) => void;
}): Promise<RedtapeSweepResult> {
  const { db, researcher } = opts;
  const out: RedtapeSweepResult = { candidates: 0, assessed: 0, skipped: 0, requeued: 0 };

  const candidates = buildCandidates(db);
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
