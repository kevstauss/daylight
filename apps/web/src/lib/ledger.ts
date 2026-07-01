import { getDb, rowToDomainRecord, type DomainRow } from "@daylight/db";
import { contactDomainMismatch, type ContactMismatch, type OrgResolver } from "@daylight/ledger";
import { watchlist } from "./watchlist";

/** Build an org resolver from the full registry (for H1 same-org clearing). */
export function orgResolver(): OrgResolver {
  const map = new Map<string, string>();
  for (const r of getDb().allDomains()) map.set(r.domain, r.org ?? "");
  return (d) => map.get(d) ?? null;
}

/** Standing H1 flag for a domain row (null if none / no watchlist). */
export function domainFlag(row: DomainRow, orgOf?: OrgResolver): ContactMismatch | null {
  const wl = watchlist();
  if (!wl) return null;
  try {
    return contactDomainMismatch(rowToDomainRecord(row), wl, orgOf ?? orgResolver());
  } catch {
    return null;
  }
}

export type { ContactMismatch } from "@daylight/ledger";
