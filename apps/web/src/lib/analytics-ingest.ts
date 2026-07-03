// First-party, aggregate-only analytics ingestion. Imported *dynamically* from middleware so the
// native better-sqlite3 addon is required at runtime rather than pulled into the middleware
// bundle graph. Records nothing that identifies a visitor — classification is bounded in
// @daylight/core (classifyHit) and the storage shape holds no IP/UA/cookie (see analytics_hits).

import { getDb } from "@daylight/db";
import { classifyHit } from "@daylight/core";

/**
 * Record one page view. `pathname`/`referer`/`selfHost` come straight off the request; classifyHit
 * maps them to a bounded, non-identifying bucket (or null to skip — health/internal paths). The
 * caller wraps this in try/catch: analytics is best-effort and must never affect a response.
 */
export function recordRequestHit(pathname: string, referer: string | null, selfHost: string): void {
  const hit = classifyHit(pathname, referer, selfHost);
  if (!hit) return; // excluded path (e.g. /status health check, /review) — nothing recorded
  const day = new Date().toISOString().slice(0, 10); // UTC date bucket
  getDb().recordHit({ day, path: hit.path, refKind: hit.refKind, refHost: hit.refHost });
}
