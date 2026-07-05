import { SENSITIVE_PII_KINDS, sha256, type Watchlist } from "@daylight/core";
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

/**
 * Heavy tracking — well above the ~1-2 the official Digital Analytics Program (DAP) puts on most
 * federal sites, and above the handful that are routine. Nearly every federal site loads a few
 * third-party trackers, so a low bar just floods the queue with near-identical "uses trackers, no
 * PIA" findings; the notable ones cluster higher.
 */
const HIGH_TRACKER_MIN = 6;

/**
 * Build Redtape candidates from Floodlight scorecards that show a HIGH-SIGNAL collection concern —
 * one worth a human's time. A domain qualifies if it:
 *   - runs session replay (records user interaction — the most invasive signal), OR
 *   - first-party-proxies its analytics (hides third-party trackers behind its own domain), OR
 *   - loads >= HIGH_TRACKER_MIN third-party trackers (heavy tracking), OR
 *   - is on the watchlist (a specifically-watched / newly-registered domain is newsworthy even
 *     with light tracking — e.g. a brand-new White House Office site collecting email).
 *
 * A lower bar was tried and rejected: nearly all federal sites load a few trackers and (since
 * website tracking is essentially never SORN-covered) come back `no_filing`, so the queue filled
 * with ~40 near-identical non-actionable findings. "No linked privacy notice" is recorded as
 * supporting evidence but never triggers candidacy on its own.
 */
export function buildCandidates(db: DaylightDb, watchlist?: Watchlist): ResearcherInput[] {
  const watched = new Set(
    [...(watchlist?.apexDomains ?? []), ...(watchlist?.subdomainApexes ?? [])].map((d) => d.toLowerCase()),
  );
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
      if (c.tracker_count >= HIGH_TRACKER_MIN) e.strong = true;
    }
    // Persisted PII form fields (task 10). A form collecting SENSITIVE PII (SSN/DOB/passport/photo)
    // is the canonical §208 gap and worth a human's time on its own; ordinary PII collected with NO
    // linked privacy notice is likewise a strong trigger ("a form collecting PII, no PIA").
    const formFields = parseArr(c.form_fields_json);
    if (formFields.length > 0) {
      const sensitive = formFields.filter((k) => SENSITIVE_PII_KINDS.has(k));
      if (sensitive.length > 0) {
        e.evidence.add(`collects sensitive PII: ${sensitive.sort().join(", ")}`);
        e.strong = true;
      } else if (!c.privacy_notice_url) {
        e.evidence.add(`collects PII (${formFields.sort().join(", ")}) with no linked privacy notice`);
        e.strong = true;
      } else {
        e.evidence.add(`collects PII via form: ${formFields.sort().join(", ")}`);
      }
    }
    if (!c.privacy_notice_url) e.evidence.add("no linked privacy notice"); // supporting only, not a trigger
    if (watched.has(c.domain)) e.strong = true; // a specifically-watched domain is newsworthy regardless
    byDomain.set(c.domain, e);
  }
  const candidates: ResearcherInput[] = [];
  for (const [domain, e] of byDomain) {
    // Need some collection evidence to assess — a watched domain that collects nothing is skipped.
    if (e.strong && e.evidence.size > 0) candidates.push({ domain, url: e.url, collectsPiiEvidence: [...e.evidence] });
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
  watchlist?: Watchlist; // scopes candidacy: watched domains qualify regardless of tracker weight
  now?: string;
  /** Delay between assessments (ms) — spreads the API burst so a run doesn't hit rate limits. */
  paceMs?: number;
  log?: (msg: string) => void;
}): Promise<RedtapeSweepResult> {
  const { db, researcher } = opts;
  const paceMs = opts.paceMs ?? 2500;
  const out: RedtapeSweepResult = { candidates: 0, assessed: 0, skipped: 0, requeued: 0 };

  const candidates = buildCandidates(db, opts.watchlist);
  out.candidates = candidates.length;

  for (const candidate of candidates) {
    const key = evidenceKey(candidate.collectsPiiEvidence);
    const priorGaps = db.gapsByDomain(candidate.domain);
    if (priorGaps.some((g) => evidenceKey(parseArr(g.collects_pii_evidence_json)) === key)) {
      out.skipped++;
      opts.log?.(`[redtape] ${candidate.domain}: unchanged evidence — skip`);
      continue;
    }
    // Feed the most recent prior notes (human reviewer_note + agent_recommendation) back in for
    // continuity when the evidence changed and we re-assess.
    const latest = priorGaps[0];
    const withNotes: ResearcherInput = latest
      ? { ...candidate, priorNotes: { reviewerNote: latest.reviewer_note, agentRecommendation: latest.agent_recommendation } }
      : candidate;
    const r = await runRedtapeAssessment({ db, candidate: withNotes, researcher, now: opts.now });
    out.assessed++;
    opts.log?.(`[redtape] ${candidate.domain}: ${r.assessment} → gap #${r.gapId} queued`);
    if (paceMs > 0) await new Promise((res) => setTimeout(res, paceMs));
  }

  // Re-check published gaps — a newly-filed SORN should retract a stale "no filing" claim.
  for (const g of db.publicGaps(1000)) {
    if (g.gap_assessment === "covered") continue;
    const input: ResearcherInput = {
      domain: g.domain,
      url: g.url ?? null,
      collectsPiiEvidence: parseArr(g.collects_pii_evidence_json),
      priorNotes: { reviewerNote: g.reviewer_note, agentRecommendation: g.agent_recommendation },
    };
    let parsed;
    try {
      parsed = parseAgentJson(await researcher(input));
    } catch {
      parsed = null;
    }
    // Refresh the internal recommendation from the re-check (internal-only; never public).
    if (parsed?.recommendation) db.setGapAgentRecommendation(g.id, parsed.recommendation);
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
