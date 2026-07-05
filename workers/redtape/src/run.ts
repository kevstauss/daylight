import { nowIso } from "@daylight/core";
import type { DaylightDb } from "@daylight/db";
import { parseAgentJson } from "./agent.js";
import type { GapAssessment, Researcher, ResearcherInput } from "./types.js";

export interface RunRedtapeOptions {
  db: DaylightDb;
  candidate: ResearcherInput;
  researcher: Researcher;
  now?: string;
  /** Retries on malformed JSON before routing to manual handling (default 1). */
  retries?: number;
}

export interface RunRedtapeResult {
  ok: boolean;
  manual: boolean;
  gapId: number;
  assessment: GapAssessment;
}

/**
 * Assess one candidate. The agent's JSON is parsed with one retry; malformed output routes
 * to a `manual` gap for human handling. EVERY gap is inserted unreviewed + unpublished —
 * nothing agent-generated is ever auto-published (the human gate lives in the DB layer).
 */
export async function runRedtapeAssessment(opts: RunRedtapeOptions): Promise<RunRedtapeResult> {
  const now = opts.now ?? nowIso();
  const retries = opts.retries ?? 1;
  const { db, candidate } = opts;

  let parsed = null as ReturnType<typeof parseAgentJson>;
  for (let attempt = 0; attempt <= retries; attempt++) {
    let raw: string;
    try {
      raw = await opts.researcher(candidate);
    } catch {
      raw = "";
    }
    parsed = parseAgentJson(raw);
    if (parsed) break;
  }

  if (!parsed) {
    const gapId = db.insertGap({
      domain: candidate.domain,
      url: candidate.url,
      collectsPiiEvidence: candidate.collectsPiiEvidence,
      gapAssessment: "manual",
      queriesRun: [],
      sourcesChecked: [],
      factVsInferenceNotes: "Agent output was unparseable after retry — queued for manual handling.",
      createdAt: now,
    });
    return { ok: false, manual: true, gapId, assessment: "manual" };
  }

  const gapId = db.insertGap({
    domain: candidate.domain,
    url: candidate.url,
    collectsPiiEvidence: candidate.collectsPiiEvidence,
    piaFound: parsed.pia_found,
    piaRefs: parsed.pia_refs,
    sornFound: parsed.sorn_found,
    sornRefs: parsed.sorn_refs,
    queriesRun: parsed.queries_run,
    sourcesChecked: parsed.sources_checked,
    gapAssessment: parsed.gap_assessment,
    confidence: parsed.confidence,
    factVsInferenceNotes: parsed.fact_vs_inference_notes,
    agentRecommendation: parsed.recommendation || null,
    createdAt: now,
  });
  return { ok: true, manual: false, gapId, assessment: parsed.gap_assessment };
}
