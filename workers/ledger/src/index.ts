// @daylight/ledger — public API (library only; the CLI lives in cli.ts).

export { EXPECTED_HEADER, parseCsv, verifyHeader } from "./csv.js";
export {
  canonicalHash,
  normalizeCsv,
  normalizeRow,
  recordsToMap,
  type NormalizedCsv,
} from "./normalize.js";
export { diff } from "./diff.js";
export {
  classifyChange,
  contactDomainMismatch,
  registrableApex,
  type ContactMismatch,
  type OrgResolver,
} from "./heuristics.js";
export { evaluateWatches, matchPerson } from "./watches.js";
export { emailDomain, matchesAny, nullify } from "./text.js";
export { DEFAULT_SOURCE_URL, fetchCsv, userAgent } from "./fetch.js";
export {
  runLedger,
  FILE_SENTINEL,
  type RunLedgerOptions,
  type RunLedgerResult,
} from "./run.js";
export { resolveChange } from "./emit.js";
export {
  backfillHistory,
  listCsvCommits,
  fetchCsvAtCommit,
  type HistoryCommit,
  type BackfillHistoryOptions,
  type BackfillHistoryResult,
} from "./history.js";
