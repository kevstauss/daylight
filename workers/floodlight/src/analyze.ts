import type { Severity } from "@daylight/core";
import { classifyUrl, registrableDomain } from "@daylight/fingerprints";
import { looksProxiedAnalytics } from "./shapes.js";
import type { PageCapture, Scorecard, Tracker } from "./types.js";

export const ENGINE_VERSION = "floodlight/0.4";

const safeHost = (url: string): string => {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return "";
  }
};
const safePath = (url: string): string => {
  try {
    return new URL(url).pathname;
  } catch {
    return "";
  }
};

const SESSION_REPLAY_PATH = /\/(s|rec|record|replay|rrweb)\b/i;
const isSessionReplayPath = (path: string): boolean => SESSION_REPLAY_PATH.test(path);

/**
 * Analyze a passive page capture into a scorecard (Phase 3 §4). Pure + deterministic —
 * the live Playwright capture is a separate I/O adapter, so this is fully fixture-tested.
 *  H1 reverse-proxy disguise (flagship) · H2 session replay · H4 privacy-notice gap.
 */
export function analyzeCapture(capture: PageCapture): Scorecard {
  const pageDomain = registrableDomain(safeHost(capture.url));
  const trackers: Tracker[] = [];
  const seen = new Set<string>();
  let sessionReplay = false;
  let firstPartyProxied = false;
  const reasons: string[] = [];

  for (const req of capture.requests) {
    const host = safeHost(req.url);
    if (!host) continue;
    const path = safePath(req.url);
    const firstParty = registrableDomain(host) === pageDomain;

    if (firstParty) {
      // H1 — a first-party endpoint shaped like analytics = reverse-proxy disguise.
      const proxied = looksProxiedAnalytics(host, path, req.postBody, req.method, req.resourceType);
      if (proxied.matched) {
        firstPartyProxied = true;
        if (/posthog/i.test(proxied.vendor) && isSessionReplayPath(path)) sessionReplay = true;
        // Dedup on vendor+host (the granularity trackerKey diffs on). An analytics endpoint
        // fires many beacons per load; without this, one finding becomes N duplicate
        // high-severity "tracker added" changes flooding the Receipts review feed.
        const key = `fp|${proxied.vendor}|${host}`;
        if (!seen.has(key)) {
          seen.add(key);
          trackers.push({ vendor: proxied.vendor, category: "analytics", host, path, firstPartyProxied: true });
          reasons.push(`first-party endpoint ${host}${path} carries an analytics payload shape (reverse-proxy disguise)`);
        }
      }
      continue;
    }

    // Third-party tracker classification.
    const fp = classifyUrl(req.url);
    if (fp) {
      const key = `${fp.vendor}|${host}`;
      if (!seen.has(key)) {
        seen.add(key);
        trackers.push({ vendor: fp.vendor, category: fp.category, host, path, firstPartyProxied: false });
      }
      if (fp.sessionReplay || fp.category === "session-replay" || isSessionReplayPath(path)) {
        sessionReplay = true;
      }
    }
  }

  const thirdPartyCount = trackers.filter((t) => !t.firstPartyProxied).length;
  const privacyNoticeUrl = capture.dom.privacyNoticeUrl;
  const collectsPii = capture.dom.formFields.length > 0;
  const trackingPresent = trackers.length > 0 || firstPartyProxied;
  const privacyGap = (collectsPii || trackingPresent) && !privacyNoticeUrl;

  if (privacyGap) {
    reasons.push(
      `page ${collectsPii ? "collects PII" : "loads trackers"} but has no linked privacy notice`,
    );
  }
  if (sessionReplay) reasons.push("session replay detected (records clicks/scrolls/keystrokes)");

  let severity: Severity = "info";
  if (firstPartyProxied || sessionReplay || (privacyGap && collectsPii)) severity = "high";
  else if (thirdPartyCount > 0 || privacyGap) severity = "notable";

  return {
    url: capture.url,
    domain: pageDomain,
    trackers,
    trackerCount: thirdPartyCount,
    sessionReplay,
    firstPartyProxied,
    privacyNoticeUrl,
    requestCount: capture.requests.length,
    engineVersion: ENGINE_VERSION,
    severity,
    reasons,
  };
}

/** Tracker identity for diffing scorecards across scans. */
export function trackerKey(t: Tracker): string {
  return `${t.vendor}@${t.host}${t.firstPartyProxied ? " (first-party-proxied)" : ""}`;
}
