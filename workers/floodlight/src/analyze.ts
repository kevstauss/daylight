import type { Severity } from "@daylight/core";
import { classifyUrl, registrableDomain } from "@daylight/fingerprints";
import { looksProxiedAnalytics } from "./shapes.js";
import type { PageCapture, Scorecard, Tracker } from "./types.js";

export const ENGINE_VERSION = "floodlight/0.5";

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

// Genuine session-replay path markers only. A bare `/s/` or `/rec/` segment is intentionally
// EXCLUDED: it turns up on ordinary third parties (qualtrics.com/s/…, cdn /rec/…) and would mint a
// false HIGH. Known replay vendors are caught by their fingerprint category regardless of path;
// this regex is the backstop for unknown replay hosts and must not over-fire.
const SESSION_REPLAY_PATH = /\/(rrweb|replay|session[-_]?replay|record(?:ing)?s?)\b/i;
const isSessionReplayPath = (path: string): boolean => SESSION_REPLAY_PATH.test(path);

// A Meta pixel id is a bare numeric account id (historically 15–16 digits). Bounded 8–20 to accept
// real ids without capturing junk. Only ever read from the `id` param of a facebook.com/tr beacon.
const META_PIXEL_ID = /^\d{8,20}$/;

/**
 * Vendor account/property identifiers carried in a beacon's query string. Today: the Meta pixel id
 * (`facebook.com/tr?id=<pixel id>`) — a PUBLIC advertiser identifier, the join key that links a
 * tracker on a .gov page to an ad buy by the same account (Broadside). Extensible per vendor. We
 * read ONLY the account id, never the rest of the beacon (which can carry hashed PII in ud[*] params).
 */
function extractVendorIds(vendor: string, url: string): string[] {
  if (vendor !== "Meta / Facebook") return [];
  try {
    const id = new URL(url).searchParams.get("id");
    return id && META_PIXEL_ID.test(id) ? [id] : [];
  } catch {
    return [];
  }
}

/**
 * Analyze a passive page capture into a scorecard (Phase 3 §4). Pure + deterministic —
 * the live Playwright capture is a separate I/O adapter, so this is fully fixture-tested.
 *  H1 reverse-proxy disguise (flagship) · H2 session replay · H4 privacy-notice gap.
 */
export function analyzeCapture(capture: PageCapture): Scorecard {
  const pageDomain = registrableDomain(safeHost(capture.url));
  const trackers: Tracker[] = [];
  const seen = new Set<string>();
  // Vendor account ids (e.g. Meta pixel ids), collected across ALL of a vendor's requests keyed by
  // VENDOR (not host): the id is a vendor-level fact — which account fires on this page — and a
  // vendor shows up under several hosts (Meta's beacon is www.facebook.com, its script is
  // connect.facebook.net), so the beacon's id must attach to the vendor, not one host's tracker.
  const idsByVendor = new Map<string, Set<string>>();
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
      const proxied = looksProxiedAnalytics(path, req.postBody, req.method, req.resourceType);
      if (proxied.matched) {
        firstPartyProxied = true;
        if (proxied.sessionReplay || isSessionReplayPath(path)) sessionReplay = true;
        // Dedup on vendor+host: an analytics endpoint fires many beacons per load, and the
        // scorecard deliberately keeps the per-host detail ("Clarity, on 4 hosts"). NOTE this is
        // COARSER at the key level — trackerKey() is per vendor — so several Trackers can share
        // one key and callers that build a key list must dedupe (see snapshot-map).
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
      for (const id of extractVendorIds(fp.vendor, req.url)) {
        const set = idsByVendor.get(fp.vendor) ?? new Set<string>();
        set.add(id);
        idsByVendor.set(fp.vendor, set);
      }
      if (fp.sessionReplay || fp.category === "session-replay" || isSessionReplayPath(path)) {
        sessionReplay = true;
      }
    }
  }

  // Attach the collected account ids to the vendor's third-party trackers (sorted for a stable
  // payload). A vendor seen under multiple hosts gets the id on each — the join dedupes on read.
  for (const t of trackers) {
    if (t.firstPartyProxied) continue;
    const ids = idsByVendor.get(t.vendor);
    if (ids && ids.size > 0) t.ids = [...ids].sort();
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
    formFields: capture.dom.formFields,
    requestCount: capture.requests.length,
    engineVersion: ENGINE_VERSION,
    severity,
    reasons,
  };
}

/**
 * Tracker identity for diffing across scans — the VENDOR, not the endpoint it happened to use.
 *
 * Keying on the host looked more precise and was in fact unusable. A tracker's hostname varies
 * per page load in ways that mean nothing:
 *   - Microsoft Clarity shards across a-z.clarity.ms, so consecutive captures see d., then h.,
 *     then j. — each one "removing" the last.
 *   - Google Ads uses per-account hosts (8966771.fls.doubleclick.net).
 *   - Qualtrics uses a random per-site subdomain (znbabnroqffo1d7xq-cemgsa.gov1...).
 *   - Google Analytics reaches analytics.google.com or stats.g.doubleclick.net only on some
 *     loads, depending on consent and ad features.
 * Every one of those produced dated "tracker removed" findings against federal agencies for
 * changes that never happened. 55 of Receipts' 109 tracker changes came from this alone.
 *
 * The defensible claim is "this page sends data to Microsoft Clarity" — which shard answered is
 * an implementation detail. The full host is still on the Tracker itself and on the scorecard;
 * only the DIFF key is coarsened, and coarsening it is what makes a change mean something.
 *
 * first-party-proxied stays in the key on purpose: a vendor moving behind a first-party endpoint
 * is the flagship finding, and it must still read as a change.
 */
export function trackerKey(t: Tracker): string {
  return `${t.vendor}${t.firstPartyProxied ? " (first-party-proxied)" : ""}`;
}
