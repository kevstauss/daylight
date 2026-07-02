// Payload-shape heuristics for the reverse-proxy disguise (Phase 3 §4.5). The robust signal is
// the request's *shape* (path + POST body + method), NOT a hardcoded host or path — a first-party
// endpoint emitting one of these shapes is proxying analytics/session-replay to dodge blockers.
//
// Every heuristic here is BEACON-GATED (an actual POST/xhr/fetch/ping) unless it carries an
// unmistakable vendor asset or body, so ordinary informational GET pages never trip a HIGH
// accusation. The library deliberately covers more than PostHog: the next EOP build won't reuse
// the 2025 vendor, and the tell is the shape, not the brand.

// Distinctive PostHog ingest path segments — matched as whole path segments, not substrings,
// and ONLY when the request is an actual beacon. Content navigations like GET /decide/how-to-vote
// or GET /s/2024-report must never trip the reverse-proxy flag.
const POSTHOG_INGEST_SEGMENTS = ["capture", "batch", "decide"];
// The PostHog loader script — a specific, low-false-positive path signal (any method).
const POSTHOG_ASSET_PATH = "/static/array.js";
// AutoMonitor-style beacon path segments (grounded in analytics.infra.ndstudio.gov/metrics, but
// the operator's obvious post-Guardian move is to rename the host — so we match the PATH, not it).
const AUTOMONITOR_SEGMENTS = ["collect", "ingest", "metrics", "events", "track"];

function parseJson(body: string | undefined): Record<string, unknown> | null {
  if (!body) return null;
  try {
    const v = JSON.parse(body) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Parse a body that may be a bare JSON array (raw rrweb event batches ship as top-level arrays). */
function parseJsonArray(body: string | undefined): unknown[] | null {
  if (!body) return null;
  try {
    const v = JSON.parse(body) as unknown;
    return Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

/** Whole path segments, lowercased. `/g/collect` → ["g","collect"]. */
function segments(path: string): string[] {
  return path.toLowerCase().split("/").filter(Boolean);
}

/** The canonical PostHog capture body: {event, distinct_id, properties|api_key}. */
function hasPostHogBody(body: string | undefined): boolean {
  const j = parseJson(body);
  if (!j) return false;
  const hasEvent = "event" in j;
  const hasDistinct = "distinct_id" in j || "$distinct_id" in j;
  const hasProps = "properties" in j;
  const hasKey = "api_key" in j || "token" in j;
  return hasEvent && hasDistinct && (hasProps || hasKey);
}

/** A request that carries data to a server — where an analytics beacon lives. */
function isBeacon(method: string | undefined, resourceType: string | undefined): boolean {
  const m = (method ?? "").toUpperCase();
  const rt = (resourceType ?? "").toLowerCase();
  return m === "POST" || rt === "xhr" || rt === "fetch" || rt === "ping" || rt === "beacon";
}

/**
 * PostHog capture shape. A genuine reverse-proxied capture is one of:
 *  - the loader script (`/static/array.js`), or
 *  - a body shaped like a PostHog event (works under any custom proxy prefix), or
 *  - a beacon (POST/xhr/fetch) to a known ingest endpoint, matched on whole path segments.
 * A single-character endpoint (`/e/`, `/i/v0/e/`) is too generic to trust on the path alone,
 * so it additionally requires a JSON body — this is what stops false HIGH accusations on
 * ordinary informational `.gov` paths that merely contain a segment like `decide` or `e`.
 */
export function isPostHogShape(
  path: string,
  body: string | undefined,
  method?: string,
  resourceType?: string,
): boolean {
  const p = path.toLowerCase();
  if (p.includes(POSTHOG_ASSET_PATH)) return true;
  if (hasPostHogBody(body)) return true;
  if (!isBeacon(method, resourceType)) return false;
  const segs = segments(p);
  if (segs.some((s) => POSTHOG_INGEST_SEGMENTS.includes(s))) return true;
  // /e/ and /i/v0/e/ — generic single-char endpoints; require a JSON body to corroborate.
  const singleCharEndpoint = segs.includes("e") || p.includes("/i/v0/e");
  return singleCharEndpoint && parseJson(body) !== null;
}

/**
 * AutoMonitor shape (grounded in real data): a beacon carrying {session_id, events:[…]} to a
 * `collect`/`ingest`/`metrics`/`events`/`track` path segment. The 2025 build POSTed to
 * `analytics.infra.ndstudio.gov/metrics`; the resilient tell is the beacon PATH + body shape, so
 * this fires even after the operator renames the host to something innocuous (api.example.gov).
 */
export function isAutoMonitorShape(
  path: string,
  body: string | undefined,
  method?: string,
  resourceType?: string,
): boolean {
  if (!isBeacon(method, resourceType)) return false;
  const j = parseJson(body);
  const shaped = !!j && "session_id" in j && Array.isArray((j as { events?: unknown }).events);
  if (!shaped) return false;
  return segments(path).some((s) => AUTOMONITOR_SEGMENTS.includes(s));
}

/** Amplitude HTTP v2: {api_key, events:[…]} beacon (serverUrl override = reverse proxy). */
function isAmplitudeShape(body: string | undefined, method?: string, resourceType?: string): boolean {
  if (!isBeacon(method, resourceType)) return false;
  const j = parseJson(body);
  return !!j && ("api_key" in j || "$api_key" in j) && Array.isArray((j as { events?: unknown }).events);
}

/** Segment ingest: a beacon whose body carries a writeKey or a (type,messageId) envelope. */
function isSegmentShape(body: string | undefined, method?: string, resourceType?: string): boolean {
  if (!isBeacon(method, resourceType)) return false;
  const j = parseJson(body);
  if (!j) return false;
  if ("writeKey" in j || "write_key" in j) return true;
  if (Array.isArray((j as { batch?: unknown }).batch)) return true;
  return "messageId" in j && "type" in j;
}

/** Plausible: a beacon to `/api/event` whose body identifies a page + domain. */
function isPlausibleShape(path: string, body: string | undefined, method?: string, resourceType?: string): boolean {
  if (!isBeacon(method, resourceType)) return false;
  if (!path.toLowerCase().includes("/api/event")) return false;
  const j = parseJson(body);
  return !!j && "domain" in j && ("name" in j || "url" in j);
}

/** GA4 / server-side GTM Measurement Protocol — the very specific `/g/collect` (or `/mp/collect`)
 *  endpoint, distinctive enough that its presence first-party = a proxied GA4 tag. */
function isGa4Shape(path: string, method?: string, resourceType?: string): boolean {
  if (!isBeacon(method, resourceType)) return false;
  const p = path.toLowerCase();
  return p.includes("/g/collect") || p.includes("/mp/collect");
}

/** Matomo/Piwik ingest — the `matomo.php` / `piwik.php` endpoint proxied first-party. */
function isMatomoShape(path: string, method?: string, resourceType?: string): boolean {
  if (!isBeacon(method, resourceType)) return false;
  const p = path.toLowerCase();
  return p.includes("matomo.php") || p.includes("piwik.php");
}

/** Generic rrweb session-replay batch — the shape PostHog/others use under the hood. A beacon
 *  whose body is (or wraps) an array of rrweb events, each stamped with a numeric type+timestamp. */
function isRrwebReplayShape(body: string | undefined, method?: string, resourceType?: string): boolean {
  if (!isBeacon(method, resourceType)) return false;
  // Genuine rrweb events carry a NUMERIC type enum (0-6) + an epoch-ms timestamp. Requiring both to
  // be numbers (not just present) stops a benign generic event-log body like
  // [{type:"pageview",timestamp:169…}] from minting a false "records keystrokes" HIGH accusation.
  const looksRrweb = (ev: unknown): boolean => {
    if (!ev || typeof ev !== "object") return false;
    const e = ev as Record<string, unknown>;
    return typeof e.type === "number" && typeof e.timestamp === "number";
  };
  const arr = parseJsonArray(body);
  if (arr) return arr.length > 0 && looksRrweb(arr[0]);
  const j = parseJson(body);
  if (!j) return false;
  if (Array.isArray((j as { $snapshot_data?: unknown }).$snapshot_data)) return true;
  const events = (j as { events?: unknown }).events;
  return Array.isArray(events) && events.length > 0 && looksRrweb(events[0]);
}

export interface ProxyMatch {
  matched: boolean;
  vendor: string;
  /** True when the matched shape is itself a session-replay signal (records interactions). */
  sessionReplay: boolean;
}

const NO_MATCH: ProxyMatch = { matched: false, vendor: "", sessionReplay: false };

/**
 * Classify a first-party request against the reverse-proxy shape library. Returns the matched
 * vendor (for the scorecard) and whether the shape is a session-replay signal. Checked
 * most-specific-body-first so a shared field (e.g. `events`) resolves to the right vendor.
 */
export function looksProxiedAnalytics(
  path: string,
  body: string | undefined,
  method?: string,
  resourceType?: string,
): ProxyMatch {
  // Strong, unambiguous body signals first (a distinctive vendor envelope), so a shared path
  // token like `batch` resolves to the right vendor rather than PostHog's generic path fallback.
  if (hasPostHogBody(body)) {
    return { matched: true, vendor: "PostHog (reverse-proxied)", sessionReplay: false };
  }
  if (isAutoMonitorShape(path, body, method, resourceType)) {
    return { matched: true, vendor: "AutoMonitor-style (reverse-proxied)", sessionReplay: false };
  }
  if (isAmplitudeShape(body, method, resourceType)) {
    return { matched: true, vendor: "Amplitude (reverse-proxied)", sessionReplay: false };
  }
  if (isSegmentShape(body, method, resourceType)) {
    return { matched: true, vendor: "Segment (reverse-proxied)", sessionReplay: false };
  }
  if (isPlausibleShape(path, body, method, resourceType)) {
    return { matched: true, vendor: "Plausible (reverse-proxied)", sessionReplay: false };
  }
  // PostHog's weaker path/asset signals (loader script, ingest segment, single-char endpoint).
  if (isPostHogShape(path, body, method, resourceType)) {
    return { matched: true, vendor: "PostHog (reverse-proxied)", sessionReplay: false };
  }
  if (isGa4Shape(path, method, resourceType)) {
    return { matched: true, vendor: "GA4 / server-side GTM (reverse-proxied)", sessionReplay: false };
  }
  if (isMatomoShape(path, method, resourceType)) {
    return { matched: true, vendor: "Matomo (reverse-proxied)", sessionReplay: false };
  }
  if (isRrwebReplayShape(body, method, resourceType)) {
    return { matched: true, vendor: "Session replay (rrweb, reverse-proxied)", sessionReplay: true };
  }
  return NO_MATCH;
}
