// @daylight/receipts — public API. The diff engine is pure over Snapshots; the live
// Playwright snapshot + Wayback push are separate I/O adapters (Wayback is injected).

export type { Snapshot } from "./types.js";
export { snapshotFromHtml, snapshotContentHash } from "./html.js";
export { snapshotFromLiveCapture } from "./snapshot-map.js";
export { diffSnapshots } from "./diff.js";
export { saveToWayback, type WaybackSaver, type WaybackOptions } from "./wayback.js";
export {
  runReceiptsSnapshot,
  type RunReceiptsOptions,
  type RunReceiptsResult,
} from "./run.js";
