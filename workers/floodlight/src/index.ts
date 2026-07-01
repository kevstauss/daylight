// @daylight/floodlight — public API. The analysis engine is pure over a PageCapture; the
// live Playwright capture is a separate I/O adapter (deferred with the scheduler/host).

export { analyzeCapture, trackerKey, ENGINE_VERSION } from "./analyze.js";
export { isPostHogShape, isAutoMonitorShape, looksProxiedAnalytics } from "./shapes.js";
export { runFloodlightScan, type RunFloodlightResult } from "./scan.js";
export { CURATED_GOV, runFloodlightSweep, type FloodlightSweepResult } from "./sweep.js";
export type {
  PageCapture,
  CapturedRequest,
  DomFacts,
  Scorecard,
  Tracker,
} from "./types.js";
