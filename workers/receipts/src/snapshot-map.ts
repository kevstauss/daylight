import { sha256 } from "@daylight/core";
import { analyzeCapture, trackerKey } from "@daylight/floodlight";
import type { LiveCapture } from "@daylight/floodlight/capture";
import { registrableDomain } from "@daylight/fingerprints";
import type { Snapshot } from "./types.js";

const hostOf = (u: string): string => {
  try {
    return new URL(u).hostname;
  } catch {
    return "";
  }
};

/** A real web page, as opposed to a browser-internal error page (chrome-error://chromewebdata/)
 *  or any other scheme a dead navigation can leave behind. */
export const isWebUrl = (u: string): boolean => {
  try {
    const p = new URL(u).protocol;
    return p === "http:" || p === "https:";
  } catch {
    return false;
  }
};

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
  // Redirect detection: if navigation ended on a DIFFERENT registrable domain than we requested,
  // the page redirected off-domain (e.g. passports.gov -> travel.state.gov, or -> an auth wall).
  // Record the final URL and file the snapshot under the WATCHED domain, so the emitted change lands
  // on the right /domain page. Same-domain (incl. www / http->https) navigation is not a redirect.
  const requestedDomain = registrableDomain(hostOf(url));
  const finalDomain = registrableDomain(hostOf(live.finalUrl));
  // A navigation that died in the browser ends on chrome-error://chromewebdata/, whose "host"
  // parses as chromewebdata — which differs from the requested domain and so read as an
  // off-domain redirect. Daylight published four HIGH-severity claims that way: "studentaid.gov
  // now redirects off-domain to chrome-error://chromewebdata/". A failed load is not a redirect,
  // and only a real web URL can be one.
  const redirected = Boolean(
    isWebUrl(live.finalUrl) && requestedDomain && finalDomain && requestedDomain !== finalDomain,
  );
  return {
    url,
    domain: redirected ? requestedDomain : scorecard.domain,
    capturedAt,
    domHash: sha256(live.html.replace(/\s+/g, " ").trim()),
    trackers: scorecard.trackers.map(trackerKey).sort(),
    privacyTextHash: privacyUrl ? sha256(privacyUrl.toLowerCase()) : null,
    privacyText: privacyUrl,
    formFields: [...live.capture.dom.formFields].sort(),
    sealPresent: live.capture.dom.hasSeal,
    redirectTarget: redirected ? live.finalUrl : null,
    screenshotRef,
    waybackUrl: null,
  };
}
