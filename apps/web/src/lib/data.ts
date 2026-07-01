// Server-only read helpers over @daylight/db. Every function here runs on the server
// (App Router server components + route handlers). Never import from a client component.

import {
  getDb,
  type ChangeRow,
  type DomainRow,
  type ScanRow,
  type ScorecardRow,
  type SearchFilter,
  type SubdomainRow,
} from "@daylight/db";
import { changeToEntry, type FeedEntry } from "@daylight/feeds";

export type { ChangeRow, DomainRow, ScanRow, ScorecardRow, SubdomainRow } from "@daylight/db";

export function statusRows(): ScanRow[] {
  return getDb().getStatus();
}

export function globalChanges(limit = 50): ChangeRow[] {
  return getDb().listChanges({ limit });
}

export function ledgerChanges(opts: { severity?: string; limit?: number } = {}): ChangeRow[] {
  return getDb().listChanges({ module: "ledger", severity: opts.severity, limit: opts.limit ?? 50 });
}

export function toFeedEntries(rows: ChangeRow[]): FeedEntry[] {
  return rows.map((r) => changeToEntry(r));
}

export function domainRow(name: string): DomainRow | null {
  return getDb().getDomain(name);
}

export function domainHistoryRows(name: string): ChangeRow[] {
  return getDb().domainHistory(name);
}

export function searchRegistry(filter: SearchFilter): DomainRow[] {
  return getDb().searchDomains(filter);
}

export function domainCount(): number {
  const row = getDb().sql.prepare(`SELECT COUNT(*) AS n FROM domains`).get() as { n: number };
  return row.n;
}

export function changeCount(): number {
  const row = getDb().sql.prepare(`SELECT COUNT(*) AS n FROM changes`).get() as { n: number };
  return row.n;
}

// ---- Lookout (Phase 2) ----------------------------------------------------

export function lookoutChanges(opts: { severity?: string; limit?: number } = {}): ChangeRow[] {
  return getDb().listChanges({ module: "lookout", severity: opts.severity, limit: opts.limit ?? 50 });
}

export function subdomainsForApex(apex: string): SubdomainRow[] {
  return getDb().subdomainsByApex(apex);
}

export function searchSubdomains(f: { q?: string; severity?: string; limit?: number }): SubdomainRow[] {
  return getDb().searchSubdomains(f);
}

export function subdomainCount(): number {
  const row = getDb().sql.prepare(`SELECT COUNT(*) AS n FROM subdomains`).get() as { n: number };
  return row.n;
}

// ---- Floodlight (Phase 3) -------------------------------------------------

export function floodlightScorecards(opts: { severity?: string; limit?: number } = {}): ScorecardRow[] {
  return getDb().listScorecards({ severity: opts.severity, limit: opts.limit ?? 100 });
}

export function floodlightChanges(opts: { severity?: string; limit?: number } = {}): ChangeRow[] {
  return getDb().listChanges({ module: "floodlight", severity: opts.severity, limit: opts.limit ?? 50 });
}

export function scorecardCount(): number {
  const row = getDb().sql.prepare(`SELECT COUNT(*) AS n FROM scorecards`).get() as { n: number };
  return row.n;
}

// ---- Receipts (Phase 4) ---------------------------------------------------

export function removalLedgerRows(limit = 100): ChangeRow[] {
  return getDb().removalLedger(limit);
}

export function receiptsChanges(opts: { severity?: string; limit?: number } = {}): ChangeRow[] {
  return getDb().listChanges({ module: "receipts", severity: opts.severity, limit: opts.limit ?? 50 });
}

export function snapshotCount(): number {
  const row = getDb().sql.prepare(`SELECT COUNT(*) AS n FROM snapshots`).get() as { n: number };
  return row.n;
}
