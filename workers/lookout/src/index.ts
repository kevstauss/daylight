// @daylight/lookout — public API (library only; CLI in cli.ts).

export { registrableApex, splitLabels, normalizeFqdn } from "./labels.js";
export { scoreSubdomain, buildMimicTokens, type ScoreResult } from "./scoring.js";
export {
  fetchCrtShCerts,
  certsFromFqdns,
  parseCrtShJson,
  parseCrtShHtml,
  type CertRecord,
  type CrtShOptions,
} from "./crtsh.js";
export {
  runLookoutBackfill,
  type RunLookoutOptions,
  type RunLookoutResult,
} from "./run.js";
