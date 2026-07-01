// @daylight/redtape — public API. The AI agent is behind a model-agnostic Researcher
// interface (mocked in CI); the human gate is enforced in @daylight/db (publicGaps).

export type {
  GapAssessment,
  ResearcherInput,
  ResearcherOutput,
  Researcher,
} from "./types.js";
export { parseAgentJson, buildPrompt, claudeResearcher, PROMPT_VERSION } from "./agent.js";
export { searchSorns, type SornRef, type FederalRegisterOptions } from "./federalregister.js";
export {
  runRedtapeAssessment,
  type RunRedtapeOptions,
  type RunRedtapeResult,
} from "./run.js";
