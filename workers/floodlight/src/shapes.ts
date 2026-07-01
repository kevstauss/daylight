// Payload-shape heuristics for the reverse-proxy disguise (Phase 3 §4.5). The robust
// signal is the request's *shape* (path + POST body), not a single hardcoded path — a
// first-party host emitting these shapes is proxying analytics to dodge blockers.

const POSTHOG_PATHS = ["/e/", "/i/v0/e/", "/capture/", "/batch/", "/decide/", "/s/", "/static/array.js"];

function parseJson(body: string | undefined): Record<string, unknown> | null {
  if (!body) return null;
  try {
    const v = JSON.parse(body) as unknown;
    return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** PostHog capture shape: a known path, or a body like {event, properties, distinct_id, api_key|token}. */
export function isPostHogShape(path: string, body: string | undefined): boolean {
  const p = path.toLowerCase();
  if (POSTHOG_PATHS.some((needle) => p.includes(needle))) return true;
  const j = parseJson(body);
  if (!j) return false;
  const hasEvent = "event" in j;
  const hasDistinct = "distinct_id" in j || "$distinct_id" in j;
  const hasProps = "properties" in j;
  const hasKey = "api_key" in j || "token" in j;
  return hasEvent && hasDistinct && (hasProps || hasKey);
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
export function looksProxiedAnalytics(host: string, path: string, body: string | undefined): {
  matched: boolean;
  vendor: string;
} {
  if (isPostHogShape(path, body)) return { matched: true, vendor: "PostHog (reverse-proxied)" };
  if (isAutoMonitorShape(host, body)) return { matched: true, vendor: "AutoMonitor-style (reverse-proxied)" };
  return { matched: false, vendor: "" };
}
