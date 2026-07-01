import type { Change, DomainRecord } from "@daylight/core";

// Fields whose change emits a `modified` event. city/state churn is stored (via the
// row observation) but never emitted as a change (spec §5.4).
const WATCHED_FIELDS: { key: keyof DomainRecord; field: string }[] = [
  { key: "domainType", field: "domainType" },
  { key: "org", field: "org" },
  { key: "suborg", field: "suborg" },
  { key: "securityContactEmail", field: "securityContactEmail" },
];

/**
 * Precise diff semantics (spec §5.4):
 *  - domain in current \ previous  → added
 *  - domain in previous \ current  → removed
 *  - domain in both, watched field differs → modified (per field)
 * Severity is `info` here; heuristics/watches upgrade it downstream.
 */
export function diff(
  previous: Map<string, DomainRecord>,
  current: Map<string, DomainRecord>,
  now: string,
): Change[] {
  const changes: Change[] = [];

  for (const [domain, rec] of current) {
    const prev = previous.get(domain);
    if (!prev) {
      changes.push({ module: "ledger", domain, detectedAt: now, kind: "added", severity: "info" });
      continue;
    }
    for (const { key, field } of WATCHED_FIELDS) {
      const oldValue = (prev[key] as string | null) ?? null;
      const newValue = (rec[key] as string | null) ?? null;
      if ((oldValue ?? "") !== (newValue ?? "")) {
        changes.push({
          module: "ledger",
          domain,
          detectedAt: now,
          kind: "modified",
          field,
          oldValue,
          newValue,
          severity: "info",
        });
      }
    }
  }

  for (const domain of previous.keys()) {
    if (!current.has(domain)) {
      changes.push({ module: "ledger", domain, detectedAt: now, kind: "removed", severity: "info" });
    }
  }

  return changes;
}
