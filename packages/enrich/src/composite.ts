import type {
  ChangeRow,
  DaylightDb,
  DomainRow,
  GapRow,
  ScorecardRow,
  SnapshotRow,
  SubdomainRow,
} from "@daylight/db";

/** Everything Daylight knows about one apex domain, composed across all modules (Phase 6). */
export interface DomainComposite {
  domain: string;
  ledger: DomainRow | null; // Ledger — ownership
  subdomains: SubdomainRow[]; // Lookout — CT subdomains
  scorecards: ScorecardRow[]; // Floodlight — tracker scorecards
  snapshots: SnapshotRow[]; // Receipts — page snapshots
  removals: ChangeRow[]; // Receipts — removal ledger for this domain
  gaps: GapRow[]; // Redtape — HUMAN-GATED published gaps only
  history: ChangeRow[]; // all change events for this domain
  lastChecked: {
    ledger: string | null;
    lookout: string | null;
    floodlight: string | null;
    receipts: string | null;
    redtape: string | null;
  };
  hasAnyData: boolean;
}

/**
 * Compose the per-domain dashboard view. Every section degrades gracefully to empty when a
 * module has no data. The Redtape section reads ONLY the human-gated publicGaps() — an
 * unreviewed gap can never surface here (scope gate, spec §3/§6.3).
 */
export function domainComposite(db: DaylightDb, domain: string): DomainComposite {
  const d = domain.trim().toLowerCase();
  const ledger = db.getDomain(d);
  const subdomains = db.subdomainsByApex(d);
  const scorecards = db.scorecardsByDomain(d);
  const snapshots = db.snapshotsByDomain(d);
  const history = db.domainHistory(d);
  const removals = history.filter((c) => c.module === "receipts" && c.kind === "removed");
  const gaps = db.publicGaps(1000).filter((g) => g.domain === d); // human-gated

  return {
    domain: d,
    ledger,
    subdomains,
    scorecards,
    snapshots,
    removals,
    gaps,
    history,
    lastChecked: {
      ledger: ledger?.last_seen ?? null,
      lookout: subdomains[0]?.last_seen ?? subdomains[0]?.first_seen ?? null,
      floodlight: scorecards[0]?.scanned_at ?? null,
      receipts: snapshots[0]?.captured_at ?? null,
      redtape: gaps[0]?.created_at ?? null,
    },
    hasAnyData:
      !!ledger ||
      subdomains.length > 0 ||
      scorecards.length > 0 ||
      snapshots.length > 0 ||
      gaps.length > 0,
  };
}
