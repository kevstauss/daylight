// @daylight/receipts — public API. The diff engine is pure over Snapshots; the live
// Playwright snapshot + Wayback push are separate I/O adapters (Wayback is injected).

export type { Snapshot } from "./types.js";
export { snapshotFromHtml, snapshotContentHash } from "./html.js";
export { snapshotFromLiveCapture } from "./snapshot-map.js";
export { diffSnapshots } from "./diff.js";
export {
  saveToWayback,
  isTimestampedArchiveUrl,
  type WaybackSaver,
  type WaybackOptions,
} from "./wayback.js";
export {
  captureStatus,
  isPageCapture,
  isDefinitelyNotPageCapture,
  type CaptureStatus,
  type CdxOptions,
} from "./cdx.js";
export {
  runReceiptsSnapshot,
  type RunReceiptsOptions,
  type RunReceiptsResult,
} from "./run.js";
// NOTE: runReceiptsSweep / captureAndSnapshot live in the "./sweep" subpath (they pull the
// Playwright capture chain) so importing the package index stays browser-free for tests.
