// The seam between packages. These contracts are lifted verbatim from the
// Phase 0-1 build spec §3.2 — changing them ripples across every module.

export type Module = "ledger" | "lookout" | "floodlight" | "receipts" | "redtape";
export type ChangeKind = "added" | "removed" | "modified";
export type Severity = "info" | "notable" | "high";

/** A normalized federal `.gov` registry row (see ledger/normalize.ts). */
export interface DomainRecord {
  domain: string; // lowercased, apex, e.g. "usadf.gov"
  domainType: string; // e.g. "Federal - Executive"
  org: string; // Organization name
  suborg: string | null; // Suborganization name ('' -> null)
  city: string | null;
  state: string | null;
  securityContactEmail: string | null; // '(blank)' / '' -> null
}

export interface Observation {
  module: Module;
  domain: string;
  observedAt: string; // ISO UTC
  sourceUrl: string;
  contentHash: string; // sha256 of canonicalized payload (idempotency key)
  payload: unknown; // module-specific (DomainRecord for ledger)
}

export interface Change {
  module: Module;
  domain: string;
  detectedAt: string; // ISO UTC
  kind: ChangeKind;
  field?: string; // for 'modified'
  oldValue?: string | null;
  newValue?: string | null;
  severity: Severity;
  reason?: string; // human-readable ("security contact changed to @ndstudio.gov")
  /** The exact public artifact this change was observed in — a commit-pinned CSV blob (Ledger
   *  backfill), the daily source CSV (Ledger live), a crt.sh query (Lookout), or a Wayback URL
   *  (Receipts). Renders as "source →" so any change is one-click re-verifiable. */
  sourceUrl?: string | null;
}

export type WatchKind = "person" | "org" | "suborg" | "domain" | "subdomain_flag";

export interface WatchSubscription {
  kind: WatchKind;
  pattern: string; // e.g. "@ndstudio.gov", "Department of Government Efficiency"
  channel?: "feed" | "email" | "webhook";
  target?: string;
}

/** Parsed `config/watchlist.yaml` (camelCased, normalized). */
export interface Watchlist {
  apexDomains: string[];
  subdomainApexes: string[];
  comparators: Record<string, string>;
  personWatch: string[];
  orgWatch: string[];
  suborgWatch: string[];
  centralSecurityAllowlist: string[];
  subdomainFlags: { high: string[]; notable: string[] };
  knownSubdomainsSeen: string[];
}
