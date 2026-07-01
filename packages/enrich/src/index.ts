// Cross-module joins. Phase 2 uses this to attach a subdomain's apex owner (from the
// Ledger `domains` table) to a Lookout cert observation.

import type { DaylightDb } from "@daylight/db";

export interface ApexOwner {
  org: string | null;
  suborg: string | null;
}

/** Owner of a registrable apex, read from Ledger's `domains`. Null if not in the registry. */
export function ownerForApex(db: DaylightDb, apex: string): ApexOwner | null {
  const row = db.getDomain(apex);
  if (!row) return null;
  return { org: row.org ?? null, suborg: row.suborg ?? null };
}

/** Human owner string for display, e.g. "Executive Office of the President / White House Office". */
export function ownerLabel(owner: ApexOwner | null): string | null {
  if (!owner) return null;
  const parts = [owner.org, owner.suborg].filter((s): s is string => !!s && s.trim().length > 0);
  return parts.length ? parts.join(" / ") : null;
}
