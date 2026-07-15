// Server-only read helpers over @daylight/db. Every function here runs on the server
// (App Router server components + route handlers). Never import from a client component.

import {
  getDb,
  type ChangeRow,
  type CorrectionRow,
  type CoverageRow,
  type DomainRow,
  type ScanRow,
  type GapRow,
  type ScorecardRow,
  type SearchFilter,
  type SnapshotRow,
  type SubdomainRow,
} from "@daylight/db";
import { changeToEntry, describeFinding, type FeedEntry } from "@daylight/feeds";
import { runFoundry, type FoundryReport } from "@daylight/foundry";
import type { FlagKind } from "@daylight/core";

export type { ChangeRow, CorrectionRow, CoverageRow, DomainRow, GapRow, ScanRow, ScorecardRow, SnapshotRow, SubdomainRow } from "@daylight/db";
export type { FlagKind } from "@daylight/core";

export function statusRows(): ScanRow[] {
  return getDb().getStatus();
}

export function globalChanges(limit = 50): ChangeRow[] {
  return getDb().listChanges({ limit });
}

/** The homepage "what we're seeing" cards: `n` findings, each a distinct DOMAIN and a distinct
 *  FINDING-TYPE, picked at random so the homepage rotates each load. DaylightDb.featuredChanges
 *  supplies the full recent-significant pool already deduped by domain (best finding per domain);
 *  here we bucket that pool by finding-type (keyed on describeFinding's "why", 1:1 with type), pick
 *  distinct types at random, and take a random domain within each. Bucketing by type BEFORE the
 *  draw is deliberate: it gives a rare-but-striking type (a look-alike subdomain) the same odds as a
 *  type with thousands of rows (unlaunched-vendor projects), instead of letting sheer volume win.
 *  No recency cap — any significant finding is eligible. Cards render most-significant-first. */
export function featuredFindings(n = 3): ChangeRow[] {
  const pool = getDb().featuredChanges(POOL_ALL);
  const byType = new Map<string, ChangeRow[]>();
  for (const c of pool) {
    const key = `${c.module}|${describeFinding(c).why}`;
    (byType.get(key) ?? byType.set(key, []).get(key)!).push(c);
  }
  const picked: ChangeRow[] = [];
  const usedDomains = new Set<string>();
  // One random finding per random distinct type…
  for (const type of shuffled([...byType.keys()])) {
    if (picked.length >= n) break;
    const options = byType.get(type)!.filter((c) => !usedDomains.has(c.domain));
    const choice = options[Math.floor(Math.random() * options.length)];
    if (!choice) continue;
    usedDomains.add(choice.domain);
    picked.push(choice);
  }
  // …then backfill from any remaining domains if the pool held fewer than `n` distinct types.
  if (picked.length < n) {
    for (const c of shuffled(pool)) {
      if (picked.length >= n) break;
      if (usedDomains.has(c.domain)) continue;
      usedDomains.add(c.domain);
      picked.push(c);
    }
  }
  return picked.sort(
    (a, b) => severityRank(b.severity) - severityRank(a.severity) || (a.detected_at < b.detected_at ? 1 : -1),
  );
}

/** Effectively "all" — DaylightDb.featuredChanges is bounded by the DB's own 1000-row read cap. */
const POOL_ALL = 1000;
const severityRank = (s: string): number => (s === "high" ? 3 : s === "notable" ? 2 : 1);

/** A shuffled copy (Fisher–Yates). Uses Math.random — fine in a server component, evaluated once
 *  per request; the page is force-dynamic so a fresh order every load is the intent. */
function shuffled<T>(items: T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/** Generic filtered change list — backs the public /api/v1/changes endpoint. */
export function listChangesFiltered(f: {
  module?: string;
  severity?: string;
  flag?: FlagKind;
  since?: string;
  limit?: number;
}): ChangeRow[] {
  return getDb().listChanges(f);
}

export function ledgerChanges(
  opts: { severity?: string; flag?: FlagKind; limit?: number } = {},
): ChangeRow[] {
  return getDb().listChanges({
    module: "ledger",
    severity: opts.severity,
    flag: opts.flag,
    limit: opts.limit ?? 100,
  });
}

export function ledgerChangeCount(opts: { severity?: string; flag?: FlagKind } = {}): number {
  return getDb().countChanges({ module: "ledger", severity: opts.severity, flag: opts.flag });
}

export function ledgerFlagCounts(opts: { severity?: string } = {}): Record<FlagKind, number> {
  return getDb().countChangesByFlag({ module: "ledger", severity: opts.severity });
}

export function toFeedEntries(rows: ChangeRow[]): FeedEntry[] {
  return rows.map((r) => changeToEntry(r));
}

export function domainRow(name: string): DomainRow | null {
  return getDb().getDomain(name);
}

export function domainFirstSeen(name: string): {
  kind: "registered" | "longstanding" | "seeded";
  date: string;
} {
  return getDb().firstSeenProvenance(name);
}

export function domainHistoryRows(name: string): ChangeRow[] {
  return getDb().domainHistory(name);
}

/** A single change by id — the /change/{id} permalink. */
export function changeById(id: number): ChangeRow | null {
  return getDb().getChange(id);
}

/** The public corrections/retractions ledger. */
export function correctionsRows(limit = 100): CorrectionRow[] {
  return getDb().listCorrections(limit);
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

// ---- Sitemap listing helpers (id/slug + lastmod only; go through the DB seam) ----

/** Every apex domain row — for the sitemap's /domain/{name} entries. */
export function allDomainRows(): DomainRow[] {
  return getDb().allDomains();
}

/** Every known subdomain (Lookout) — for the sitemap's /domain/{fqdn} entries. */
export function allSubdomainRows(): SubdomainRow[] {
  return getDb().allSubdomains();
}

/** Minimal (id, detected_at) for every change permalink — for the sitemap. */
export function allChangeStamps(): { id: number; detected_at: string }[] {
  return getDb().changeStamps();
}

// ---- Lookout (Phase 2) ----------------------------------------------------

export function lookoutChanges(opts: { severity?: string; limit?: number } = {}): ChangeRow[] {
  return getDb().listChanges({ module: "lookout", severity: opts.severity, limit: opts.limit ?? 50 });
}

export function subdomainsForApex(apex: string): SubdomainRow[] {
  return getDb().subdomainsByApex(apex);
}

/** A single subdomain by fqdn (for /domain/{fqdn} when the name isn't an apex). */
export function subdomainRow(fqdn: string): SubdomainRow | null {
  return getDb().getSubdomain(fqdn);
}

/** Scorecards captured for a specific host (subdomain view). Matches on the URL's host. */
export function scorecardsForHost(host: string): ScorecardRow[] {
  const h = host.trim().toLowerCase();
  return getDb()
    .listScorecards({ limit: 1000 })
    .filter((s) => {
      try {
        return new URL(s.url).host.toLowerCase() === h;
      } catch {
        return s.url.toLowerCase().includes(h);
      }
    });
}

export function searchSubdomains(f: { q?: string; severity?: string; limit?: number }): SubdomainRow[] {
  return getDb().searchSubdomains(f);
}

export function subdomainCount(): number {
  const row = getDb().sql.prepare(`SELECT COUNT(*) AS n FROM subdomains`).get() as { n: number };
  return row.n;
}

// ---- Foundry (Phase 6) — derived CT×registry build-graph, computed on read ---

export function foundryReport(): FoundryReport {
  return runFoundry(getDb(), new Date().toISOString());
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

export function floodlightScorecard(url: string): ScorecardRow | null {
  return getDb().getScorecard(url);
}

/** Tracker add/remove change events that mention a given (redacted) URL. */
export function floodlightUrlChanges(url: string, limit = 50): ChangeRow[] {
  return getDb()
    .listChanges({ module: "floodlight", limit: 500 })
    .filter((c) => (c.reason ?? "").includes(url))
    .slice(0, limit);
}

// ---- Receipts (Phase 4) ---------------------------------------------------

export function removalLedgerRows(limit = 100): ChangeRow[] {
  return getDb().removalLedger(limit);
}

export function receiptsSnapshots(url: string): SnapshotRow[] {
  return getDb().listSnapshots(url);
}

/** Latest snapshot per watched page — the "what we're watching" coverage view. */
export function coverageSnapshotRows(limit = 500): CoverageRow[] {
  return getDb().coverageSnapshots(limit);
}

export function receiptsUrlChanges(url: string, limit = 50): ChangeRow[] {
  return getDb()
    .listChanges({ module: "receipts", limit: 500 })
    .filter((c) => (c.reason ?? "").includes(url))
    .slice(0, limit);
}

export function receiptsChanges(opts: { severity?: string; limit?: number } = {}): ChangeRow[] {
  return getDb().listChanges({ module: "receipts", severity: opts.severity, limit: opts.limit ?? 50 });
}

export function snapshotCount(): number {
  const row = getDb().sql.prepare(`SELECT COUNT(*) AS n FROM snapshots`).get() as { n: number };
  return row.n;
}

// ---- Redtape (Phase 5) — public read-path goes through the human gate ------

/** ONLY human-reviewed + published gaps (the gate lives in @daylight/db.publicGaps). */
export function publicGaps(limit = 100): GapRow[] {
  return getDb().publicGaps(limit);
}

/** Internal only — unreviewed gaps awaiting a human decision. Never a public path. */
export function reviewQueue(limit = 200): GapRow[] {
  return getDb().reviewQueueGaps(limit);
}

export function reviewGap(
  id: number,
  opts: {
    published: boolean;
    reviewerNote?: string | null;
    disposition?: string | null;
    assessment?: string | null;
    confidence?: number | null;
  },
): void {
  getDb().reviewGap(id, opts);
}

export function saveGapNote(
  id: number,
  opts: { reviewerNote?: string | null; assessment?: string | null; confidence?: number | null },
): void {
  getDb().saveGapNote(id, opts);
}

/** Internal only — reviewed gaps except held (published/rejected), for the /review "Reviewed" panel. */
export function reviewedGaps(limit = 50): GapRow[] {
  return getDb().reviewedGaps(limit);
}

/** Internal only — gaps held to revisit later, for the /review "Held" section. */
export function heldGaps(limit = 50): GapRow[] {
  return getDb().heldGaps(limit);
}

/** Internal only — return a reviewed gap to the queue to revise the decision. */
export function reopenGapForRevision(id: number): void {
  getDb().reopenGapForRevision(id);
}

// ---- Analytics (first-party, aggregate-only) — powers /privacy ------------

export interface AnalyticsSummary {
  firstDay: string | null;
  /** Human page views, all-time (excludes the /feed + /api consumption buckets). */
  totalVisits: number;
  govVisits: number;
  /** Programmatic consumption, all-time — aggregate counts only, no idea who is pulling. */
  feedPulls: number;
  apiPulls: number;
  /** Most-visited pages, page views only (consumption filtered out). */
  topPaths: { path: string; count: number }[];
  refKinds: { kind: string; count: number }[];
  govReferrers: { host: string; count: number }[];
}

// All-time sentinel: every YYYY-MM-DD is >= this, so `day >= sinceDay` matches every row.
const ALL_TIME = "0000-00-00";
// Paths that are programmatic consumption, not human page views (see normalizePath in core).
const CONSUMPTION_PATHS = new Set(["/feed", "/api"]);

/** Assemble the /privacy dashboard over all recorded history. Every field is an aggregate; the
 *  underlying analytics_hits table holds no per-visitor data (no IP/UA/cookie column exists). */
export function analyticsSummary(): AnalyticsSummary {
  const db = getDb();
  const paths = db.analyticsPathTotals(ALL_TIME);
  const byPath = new Map(paths.map((p) => [p.path, p.count]));
  const pageViews = paths.filter((p) => !CONSUMPTION_PATHS.has(p.path));
  const refKinds = db.analyticsRefKindTotals(ALL_TIME).map((r) => ({ kind: r.ref_kind, count: r.count }));

  return {
    firstDay: db.analyticsFirstDay(),
    totalVisits: pageViews.reduce((n, p) => n + p.count, 0),
    govVisits: refKinds.find((r) => r.kind === "gov")?.count ?? 0,
    feedPulls: byPath.get("/feed") ?? 0,
    apiPulls: byPath.get("/api") ?? 0,
    topPaths: [...pageViews].sort((a, b) => b.count - a.count).slice(0, 12),
    refKinds,
    govReferrers: db.analyticsGovReferrers(ALL_TIME, 50).map((r) => ({ host: r.ref_host, count: r.count })),
  };
}

export function gapToFeedEntry(g: GapRow): FeedEntry {
  const severity = g.gap_assessment === "no_filing" ? "high" : g.gap_assessment === "incomplete_filing" ? "notable" : "info";
  const date = g.created_at.slice(0, 10);
  const label =
    g.gap_assessment === "no_filing"
      ? `No published PIA or SORN found for ${g.domain} as of ${date}`
      : g.gap_assessment === "incomplete_filing"
        ? `Filing appears incomplete for ${g.domain} as of ${date}`
        : `Filing status recorded for ${g.domain} as of ${date}`;
  return {
    id: g.id,
    domain: g.domain,
    detectedAt: g.created_at,
    severity,
    title: label,
    summary: g.fact_vs_inference_notes ?? undefined,
  };
}
