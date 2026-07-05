export type GapAssessment = "no_filing" | "incomplete_filing" | "covered" | "manual";

/** What the AI research agent is asked about (a candidate site with detected collection). */
export interface ResearcherInput {
  domain: string;
  url: string | null;
  collectsPiiEvidence: string[]; // from Floodlight/Receipts (forms, trackers)
  /** Prior notes on this domain, fed back on a re-assessment for continuity. `reviewerNote` is the
   *  human's curated (public) note; `agentRecommendation` is the agent's own prior internal call. */
  priorNotes?: { reviewerNote?: string | null; agentRecommendation?: string | null };
}

/** The agent's required structured output (JSON only — spec §4.2). */
export interface ResearcherOutput {
  pia_found: boolean;
  pia_refs: string[];
  sorn_found: boolean;
  sorn_refs: string[];
  gap_assessment: "no_filing" | "incomplete_filing" | "covered";
  confidence: number;
  queries_run: string[]; // exact searches — makes the NEGATIVE checkable
  sources_checked: string[];
  fact_vs_inference_notes: string;
  /** INTERNAL recommendation for the human reviewer (Publish / Reject / reclassify + one line why).
   *  Shown on /review, never on public /redtape. Optional — old outputs won't have it. */
  recommendation: string;
}

/** Model-agnostic agent interface: returns the raw model output (a JSON string). Swap the
 *  implementation (Opus/Sonnet now, Fable later) without touching the pipeline or the gate. */
export type Researcher = (input: ResearcherInput) => Promise<string>;
