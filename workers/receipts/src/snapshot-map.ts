import { sha256 } from "@daylight/core";
import { analyzeCapture, trackerKey } from "@daylight/floodlight";
import type { LiveCapture } from "@daylight/floodlight/capture";
import type { Snapshot } from "./types.js";

/**
 * Build a Snapshot from a live page capture. Tracker inventory comes from Floodlight's
 * network analysis (richer than scraping <script src>); privacy notice / seal / PII fields
 * come from the captured DOM facts. Pure — importing this pulls no browser.
 */
export function snapshotFromLiveCapture(
  url: string,
  live: LiveCapture,
  capturedAt: string,
  screenshotRef: string | null,
): Snapshot {
  const scorecard = analyzeCapture(live.capture);
  const privacyUrl = live.capture.dom.privacyNoticeUrl;
  return {
    url,
    domain: scorecard.domain,
    capturedAt,
    domHash: sha256(live.html.replace(/\s+/g, " ").trim()),
    trackers: scorecard.trackers.map(trackerKey).sort(),
    privacyTextHash: privacyUrl ? sha256(privacyUrl.toLowerCase()) : null,
    privacyText: privacyUrl,
    formFields: [...live.capture.dom.formFields].sort(),
    sealPresent: live.capture.dom.hasSeal,
    screenshotRef,
    waybackUrl: null,
  };
}
