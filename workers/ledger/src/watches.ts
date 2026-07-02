import type { Change, DomainRecord, WatchSubscription } from "@daylight/core";
import { emailDomain, matchesAny } from "./text.js";

/** `@domain.gov` → email-domain suffix match; plain string → case-insensitive substring. */
export function matchPerson(pattern: string, email: string | null): boolean {
  if (!email) return false;
  const e = email.toLowerCase();
  if (pattern.startsWith("@")) {
    const dom = pattern.slice(1).trim().toLowerCase();
    const ed = emailDomain(e);
    if (!ed) return false;
    return ed === dom || ed.endsWith(`.${dom}`);
  }
  return e.includes(pattern.trim().toLowerCase());
}

/**
 * Evaluate watches against a CHANGE (not steady state), so a watch fires exactly once
 * when its value first appears via an added/modified event, and does not re-fire on
 * subsequent unchanged runs (spec §5.6).
 */
export function evaluateWatches(
  change: Change,
  rec: DomainRecord,
  subs: WatchSubscription[],
): WatchSubscription[] {
  const hits: WatchSubscription[] = [];
  const isAdd = change.kind === "added";
  // A removal is watch-worthy too: a watched identity/org disappearing from the registry is the
  // "quietly vanished" event Receipts exists for (§5.6, H5). `rec` here is the PREVIOUS record, so
  // its contact/org/suborg still carry the values that are being removed.
  const isRemove = change.kind === "removed";
  const isContactChange = change.kind === "modified" && change.field === "securityContactEmail";
  const isOrgChange = change.kind === "modified" && change.field === "org";
  const isSuborgChange = change.kind === "modified" && change.field === "suborg";

  for (const s of subs) {
    if (s.kind === "person") {
      if ((isAdd || isRemove || isContactChange) && matchPerson(s.pattern, rec.securityContactEmail)) {
        hits.push(s);
      }
    } else if (s.kind === "org") {
      if ((isAdd || isRemove || isOrgChange) && matchesAny(rec.org, [s.pattern])) hits.push(s);
    } else if (s.kind === "suborg") {
      if ((isAdd || isRemove || isSuborgChange) && matchesAny(rec.suborg, [s.pattern])) hits.push(s);
    }
  }
  return hits;
}
