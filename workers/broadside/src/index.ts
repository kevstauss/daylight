// @daylight/broadside — module 7. Watches what the federal government pays to advertise to Americans,
// via public ad libraries (Meta Ad Library / Google political-ads). Read-only, public-archive-only.
//
// STATUS: storage + config + the closed-loop join (DaylightDb.pixelAdLoop) are live behind
// FLAG_BROADSIDE; the live fetchers (Meta Graph API tied to an ID-verified token, Google BigQuery)
// are DEFERRED behind the AdFetcher interface pending credentials — CI injects a mock. The public
// surfaces stay dark until FLAG_BROADSIDE is turned on.
//
// Firewall (hard): read-only, API-only; a dedicated personal identity for Meta, never an agency/
// client account; no employer reference anywhere; secrets in env only.

export type { ObservedAd, AdFetcher } from "./types.js";
export { runBroadside, type RunBroadsideOptions, type RunBroadsideResult } from "./run.js";
