import type { Change, DomainRecord, Severity, Watchlist, WatchSubscription } from "@daylight/core";
import { classifyChange, type OrgResolver } from "./heuristics.js";
import { evaluateWatches } from "./watches.js";

const SEV_ORDER: Record<Severity, number> = { info: 0, notable: 1, high: 2 };

/**
 * Turn a raw diff change into the final change (severity + reason via H1–H4) plus the watch
 * subscriptions it fires. A person-watch match routes the change to `high` (§5.7). Shared by
 * the daily run and the git-history backfill so both behave identically.
 */
export function resolveChange(
  raw: Change,
  rec: DomainRecord,
  wl: Watchlist,
  orgOf: OrgResolver,
  subs: WatchSubscription[],
): { change: Change; hits: WatchSubscription[] } {
  const { severity, reason } = classifyChange(raw, rec, wl, orgOf);
  const hits = evaluateWatches({ ...raw, severity, reason }, rec, subs);
  let finalSeverity = severity;
  let finalReason = reason;
  if (hits.some((h) => h.kind === "person") && SEV_ORDER[severity] < SEV_ORDER.high) {
    finalSeverity = "high";
    finalReason = finalReason ?? `a watched identity appears as the security contact for ${raw.domain}`;
  }
  return { change: { ...raw, severity: finalSeverity, reason: finalReason ?? raw.reason }, hits };
}
