// Classify a Ledger change into a flag TYPE for filtering (registry/activity views).
// Derived from the change's own fields — the `reason` strings are produced by our own
// heuristics (workers/ledger), so matching them is reliable, not free-text parsing.

export type FlagKind =
  | "contact-mismatch"
  | "watchlist"
  | "new-domain"
  | "removed"
  | "contact-change"
  | "owner-change"
  | "other";

export interface FlagClassifiable {
  kind: string;
  field: string | null;
  severity: string;
  reason: string | null;
}

export interface FlagMeta {
  kind: FlagKind;
  label: string;
  blurb: string;
}

/** Ordered for the filter UI. `all` is handled by the caller. */
export const FLAG_TYPES: readonly FlagMeta[] = [
  { kind: "contact-mismatch", label: "Contact mismatch", blurb: "Security contact at another org's .gov" },
  { kind: "watchlist", label: "Watchlist hit", blurb: "A watched identity, org, or suborg appeared" },
  { kind: "new-domain", label: "New domain", blurb: "A .gov added to the registry" },
  { kind: "removed", label: "Removed", blurb: "A .gov taken out of the registry" },
  { kind: "contact-change", label: "Contact change", blurb: "Published security contact changed" },
  { kind: "owner-change", label: "Owner change", blurb: "Organization / type reassigned" },
  { kind: "other", label: "Other", blurb: "Other recorded change" },
];

const OWNER_FIELDS = new Set(["org", "suborg", "domainType", "domain_type"]);

/**
 * Classify a change. Precedence: the flagged heuristics (contact-mismatch, then any watchlist
 * hit) win over the plain kind/field shape, because a watched-org hit can ride on an `added`
 * change and a contact-mismatch on a `modified` one.
 */
export function classifyChangeFlag(c: FlagClassifiable): FlagKind {
  const r = (c.reason ?? "").toLowerCase();
  if (r.includes("foreign to")) return "contact-mismatch";
  if (r.includes("watched")) return "watchlist";
  if (c.kind === "added") return "new-domain";
  if (c.kind === "removed") return "removed";
  if (c.kind === "modified") {
    if (c.field === "securityContactEmail" || c.field === "security_contact_email") return "contact-change";
    if (c.field && OWNER_FIELDS.has(c.field)) return "owner-change";
  }
  return "other";
}

/**
 * SQL predicate matching classifyChangeFlag for a given flag — lets the DB filter across ALL
 * history (not just a recent window). Static strings only (the flag is validated against the
 * enum), so nothing user-controlled reaches the SQL text. Kept in lockstep with the classifier
 * above and cross-checked in tests.
 */
export function flagSqlPredicate(flag: FlagKind): string {
  const notFlagged = `(reason IS NULL OR (lower(reason) NOT LIKE '%foreign to%' AND lower(reason) NOT LIKE '%watched%'))`;
  switch (flag) {
    case "contact-mismatch":
      return `lower(reason) LIKE '%foreign to%'`;
    case "watchlist":
      return `lower(reason) LIKE '%watched%' AND lower(reason) NOT LIKE '%foreign to%'`;
    case "new-domain":
      return `kind = 'added' AND ${notFlagged}`;
    case "removed":
      return `kind = 'removed' AND ${notFlagged}`;
    case "contact-change":
      return `kind = 'modified' AND field = 'securityContactEmail' AND ${notFlagged}`;
    case "owner-change":
      return `kind = 'modified' AND field IN ('org','suborg','domainType') AND ${notFlagged}`;
    case "other":
      return `kind = 'modified' AND (field IS NULL OR field NOT IN ('securityContactEmail','org','suborg','domainType')) AND ${notFlagged}`;
  }
}
