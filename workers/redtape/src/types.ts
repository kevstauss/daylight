export type GapAssessment = "no_filing" | "incomplete_filing" | "covered" | "manual";

/** What the AI research agent is asked about (a candidate site with detected collection). */
export interface ResearcherInput {
  domain: string;
  url: string | null;
  collectsPiiEvidence: string[]; // from Floodlight/Receipts (forms, trackers)
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
}

/** Model-agnostic agent interface: returns the raw model output (a JSON string). Swap the
 *  implementation (Opus/Sonnet now, Fable later) without touching the pipeline or the gate. */
export type Researcher = (input: ResearcherInput) => Promise<string>;
