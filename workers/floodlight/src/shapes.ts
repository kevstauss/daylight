// Payload-shape heuristics for the reverse-proxy disguise (Phase 3 §4.5). The robust
// signal is the request's *shape* (path + POST body), not a single hardcoded path — a
// first-party host emitting these shapes is proxying analytics to dodge blockers.

// Distinctive PostHog ingest path segments — matched as whole path segments, not substrings,
// and ONLY when the request is an actual beacon (POST / xhr / fetch). Content navigations
// like GET /decide/how-to-vote or GET /s/2024-report must never trip the reverse-proxy flag.
const POSTHOG_INGEST_SEGMENTS = ["capture", "batch", "decide"];
// The PostHog loader script — a specific, low-false-positive path signal (any method).
const POSTHOG_ASSET_PATH = "/static/array.js";

function parseJson(body: string | undefined): Record<string, unknown> | null {
  if (!body) return null;
  try {
    const v = JSON.parse(body) as unknown;
    return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
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
  const segs = p.split("/").filter(Boolean);
  if (segs.some((s) => POSTHOG_INGEST_SEGMENTS.includes(s))) return true;
  // /e/ and /i/v0/e/ — generic single-char endpoints; require a JSON body to corroborate.
  const singleCharEndpoint = segs.includes("e") || p.includes("/i/v0/e");
  return singleCharEndpoint && parseJson(body) !== null;
}

/** AutoMonitor shape (grounded in real data): POST {session_id, events:[...]} to an
 *  analytics/metrics/infra first-party host. */
export function isAutoMonitorShape(host: string, body: string | undefined): boolean {
  const h = host.toLowerCase();
  const infraHost = /(^|\.)(analytics|metrics|infra)\./.test(h) || /\/(metrics|collect|ingest)\b/.test(h);
  const j = parseJson(body);
  const shaped = !!j && "session_id" in j && Array.isArray((j as { events?: unknown }).events);
  return shaped && (infraHost || /(analytics|metrics|infra)/.test(h));
}

/** True if a first-party request looks like proxied analytics (either known shape). */
export function looksProxiedAnalytics(
  host: string,
  path: string,
  body: string | undefined,
  method?: string,
  resourceType?: string,
): {
  matched: boolean;
  vendor: string;
} {
  if (isPostHogShape(path, body, method, resourceType)) {
    return { matched: true, vendor: "PostHog (reverse-proxied)" };
  }
  if (isAutoMonitorShape(host, body)) return { matched: true, vendor: "AutoMonitor-style (reverse-proxied)" };
  return { matched: false, vendor: "" };
}
