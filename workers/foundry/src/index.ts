// @daylight/foundry — public API (library only; CLI in cli.ts).
//
// Foundry is the CT×registry JOIN neither Lookout (per-host label score) nor Ledger (per-row
// registry fact) performs. It clusters `.gov` properties by the shared vendor build tree they pass
// through and emits two signals unique to it: a build-concentration index (distinct owning agencies
// per vendor) and an unlaunched-project watch (staging host exists, target apex not yet registered).
// Existence-only, from already-public data.

export {
  ENV_TIERS,
  PLUMBING,
  registrableApex,
  labelsUnder,
  candidateApexes,
  attributeHost,
  attributeProjects,
  buildConcentrationIndex,
  unlaunchedProjectWatch,
  type HostAttribution,
  type RegistryView,
  type FoundryProject,
  type ConcentrationEntry,
  type UnlaunchedProject,
} from "./attribute.js";

export {
  runFoundry,
  runFoundryScan,
  registryViewFromDb,
  type VendorReport,
  type FoundryReport,
  type FoundryScanResult,
} from "./run.js";
