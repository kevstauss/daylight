// @daylight/sitescanning — public API (library only; the CLI lives in cli.ts).
//
// A BREADTH net over GSA's daily federal-web scan that feeds Floodlight (depth). It is deliberately
// NOT a module: it writes no changes and has no tile/feed. Two jobs — promote unwatched .gov apexes
// into the Floodlight sweep when a new third party appears, and store the scan for corroboration.

export { REQUIRED_COLUMNS, indexColumns, missingColumns, parseCsv } from "./csv.js";
export type { ColumnIndex, RequiredColumn } from "./csv.js";
export { parseRow, scanContentHash, isBenignThirdParty } from "./parse.js";
export type { SiteScanRecord } from "./parse.js";
export { DEFAULT_SOURCE_URL, API_KEY_ENV, apiKeyFromEnv, fetchSiteScanCsv, userAgent } from "./fetch.js";
export { runSiteScan, type RunSiteScanOptions, type RunSiteScanResult } from "./run.js";
