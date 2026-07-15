import type { Change, DomainRecord, FlagKind, Observation } from "@daylight/core";
import { flagSqlPredicate, nowIso } from "@daylight/core";
import { openConnection, resolveDbPath, type Sqlite } from "./client.js";
import type {
  AlertRow,
  ChangeRow,
  CorrectionRow,
  CoverageRow,
  DomainRow,
  GapRow,
  ObservationRow,
  ScanRow,
  ScorecardRow,
  SnapshotRow,
  SubdomainRow,
} from "./rows.js";

export type { Sqlite } from "./client.js";
export { openConnection, resolveDbPath } from "./client.js";
export * from "./rows.js";

// The public .gov record (cisagov/dotgov-data) begins with the 2019-02-06 commit; domains present
// in that baseline get no `added` event during the git-history replay, so — once the backfill has
// run — absence of an `added` change means "on the record since it began" (longstanding). Mirrors
// workers/ledger/src/history.ts (kept in sync by hand: a DB package must not import a worker).
const LEDGER_RECORD_START_ISO = "2019-02-06T00:00:00.000Z";
const LEDGER_HISTORY_SENTINEL = "__ledger_history__";

export interface SearchFilter {
  q?: string;
  org?: string;
  suborg?: string;
  contact?: string;
  limit?: number;
}

export interface ChangeFilter {
  since?: string;
  severity?: string;
  module?: string;
  flag?: FlagKind;
  limit?: number;
}

export interface ScanFinish {
  ok: boolean;
  error?: string | null;
  itemsSeen?: number;
  changesEmitted?: number;
}

export interface AlertInsert {
  changeId: number;
  subscriptionPattern?: string | null;
  channel?: string | null;
  target?: string | null;
  sentAt?: string | null;
  ok?: boolean | null;
  error?: string | null;
}

const FEATURED_SEVERITY_WEIGHT: Record<string, number> = { high: 3, notable: 2, info: 1 };

/** Ranking score for featuredChanges: severity first, plus a small bonus for Lookout's flagship
 *  function-mimic signature (a name imitating another agency under a foreign apex). Recency is a
 *  separate tiebreak, applied by cmpRecencyDesc — not folded in here. */
function featuredScore(c: ChangeRow): number {
  const sev = FEATURED_SEVERITY_WEIGHT[c.severity] ?? 1;
  const mimic = /\blooks like\b/i.test(c.reason ?? "") ? 1 : 0;
  return sev * 10 + mimic;
}

/** Newer-first: most recent `detected_at` wins; id breaks ties within a scan burst (same second). */
function cmpRecencyDesc(a: ChangeRow, b: ChangeRow): number {
  if (a.detected_at !== b.detected_at) return a.detected_at < b.detected_at ? 1 : -1;
  return b.id - a.id;
}

/** The subject a featured card is really *about* — the dedupe key that keeps the trio diverse.
 *  Usually the change's domain, but a Foundry unlaunched-project change files under the would-be
 *  target domain (e.g. `staging-api.gov`) while the story is the vendor apex it's staging on
 *  ("…building on passports.gov"). Group those by the vendor apex so one vendor can't fill all
 *  three cards. A parse miss falls back to the domain — worse dedupe, never a wrong card. */
function featuredSubject(c: ChangeRow): string {
  if (c.module === "foundry") {
    const m = /building on ([a-z0-9.-]+\.gov)\b/i.exec(c.reason ?? "");
    if (m?.[1]) return `foundry:${m[1].toLowerCase()}`;
  }
  return c.domain;
}

/**
 * The stable query surface (Phase 0-1 spec §3.4). Every caller goes through
 * these methods so the SQLite → Postgres swap at Phase 2 never touches callers.
 */
export class DaylightDb {
  constructor(public readonly sql: Sqlite) {}

  // ---- domains ------------------------------------------------------------

  upsertDomain(rec: DomainRecord, seenAt: string): void {
    this.sql
      .prepare(
        `INSERT INTO domains
           (domain, domain_type, org, suborg, city, state, security_contact_email, first_seen, last_seen)
         VALUES
           (@domain, @domainType, @org, @suborg, @city, @state, @securityContactEmail, @seenAt, @seenAt)
         ON CONFLICT(domain) DO UPDATE SET
           domain_type = excluded.domain_type,
           org = excluded.org,
           suborg = excluded.suborg,
           city = excluded.city,
           state = excluded.state,
           security_contact_email = excluded.security_contact_email,
           last_seen = excluded.last_seen`,
      )
      .run({
        domain: rec.domain,
        domainType: rec.domainType,
        org: rec.org,
        suborg: rec.suborg,
        city: rec.city,
        state: rec.state,
        securityContactEmail: rec.securityContactEmail,
        seenAt,
      });
  }

  getDomain(name: string): DomainRow | null {
    const row = this.sql
      .prepare(`SELECT * FROM domains WHERE domain = ?`)
      .get(name.trim().toLowerCase()) as DomainRow | undefined;
    return row ?? null;
  }

  /** Every domain row (uncapped) — the worker's "previous state" for diffing. */
  allDomains(): DomainRow[] {
    return this.sql.prepare(`SELECT * FROM domains ORDER BY domain ASC`).all() as DomainRow[];
  }

  /**
   * The DYNAMIC watch tier — domains the sweeps target on top of the curated baseline and the
   * hand-picked watchlist, both computed (no extra table):
   *
   *  - {@link recentlyAddedDomains}: a brand-new federal registration is the highest-signal,
   *    lowest-volume event in the system (~1/week), so a domain Ledger recorded as `added` within
   *    the probation window is watched from day one. Keyed on the `added` CHANGE — the baseline
   *    seed runs with emit=false so it records none — NOT on first_seen, which a one-shot seed
   *    makes identical across the whole registry.
   *  - {@link keptWatchDomains}: auto-keep — a probation domain that turned up a real finding
   *    (a notable/high scorecard) stays watched after its window closes, so interesting new
   *    domains don't silently age out.
   */
  recentlyAddedDomains(sinceIso: string): string[] {
    return (
      this.sql
        .prepare(
          `SELECT DISTINCT domain FROM changes
             WHERE module = 'ledger' AND kind = 'added' AND detected_at >= @since
           ORDER BY domain ASC`,
        )
        .all({ since: sinceIso }) as { domain: string }[]
    ).map((r) => r.domain);
  }

  keptWatchDomains(): string[] {
    return (
      this.sql
        .prepare(
          `SELECT DISTINCT domain FROM scorecards
             WHERE severity IN ('notable', 'high')
           ORDER BY domain ASC`,
        )
        .all() as { domain: string }[]
    ).map((r) => r.domain);
  }

  /**
   * Honest provenance for a domain's "first seen", so the UI never shows a seed date as if it were
   * a registration date. Three cases:
   *  - `registered`: Ledger recorded an `added` change → the date is when it first appeared in the
   *    public registry (its earliest `added`).
   *  - `longstanding`: no `added` event AND the git-history backfill has run → the domain was
   *    present in the 2019 baseline commit; true registration predates the public record.
   *  - `seeded`: no `added` event and no backfill yet → we only know when we first observed it.
   */
  firstSeenProvenance(domain: string): { kind: "registered" | "longstanding" | "seeded"; date: string } {
    const d = domain.trim().toLowerCase();
    const added = this.sql
      .prepare(
        `SELECT MIN(detected_at) AS at FROM changes
           WHERE module = 'ledger' AND kind = 'added' AND domain = @d`,
      )
      .get({ d }) as { at: string | null };
    if (added?.at) return { kind: "registered", date: added.at };
    const backfilled = this.latestObservation("ledger", LEDGER_HISTORY_SENTINEL) !== null;
    if (backfilled) return { kind: "longstanding", date: LEDGER_RECORD_START_ISO };
    return { kind: "seeded", date: this.getDomain(d)?.first_seen ?? "" };
  }

  /**
   * One-time, idempotent correction of the `first_seen` COLUMN. The read path already derives an
   * honest label via {@link firstSeenProvenance}, but the raw column still holds the uniform seed
   * date from the initial baseline. This rewrites it to the earliest Ledger `added` date per domain
   * (its true first appearance in the public registry); once the git-history backfill has run,
   * domains with no `added` event were present at the 2019 baseline, so their column is set to the
   * record-start date (a lower bound). Safe to re-run — the sources are stable. Returns row counts.
   */
  backfillFirstSeen(): { registered: number; longstanding: number } {
    const hasAdd = `EXISTS (SELECT 1 FROM changes c
        WHERE c.module = 'ledger' AND c.kind = 'added' AND c.domain = domains.domain)`;
    return this.sql.transaction((): { registered: number; longstanding: number } => {
      const registered = this.sql
        .prepare(
          `UPDATE domains SET first_seen = (
             SELECT MIN(c.detected_at) FROM changes c
             WHERE c.module = 'ledger' AND c.kind = 'added' AND c.domain = domains.domain
           ) WHERE ${hasAdd}`,
        )
        .run().changes;
      // Only claim "present since the 2019 baseline" once the history replay has actually run —
      // otherwise a domain with no `added` event might simply predate our watching, not the record.
      let longstanding = 0;
      if (this.latestObservation("ledger", LEDGER_HISTORY_SENTINEL) !== null) {
        longstanding = this.sql
          .prepare(`UPDATE domains SET first_seen = @start WHERE NOT ${hasAdd}`)
          .run({ start: LEDGER_RECORD_START_ISO }).changes;
      }
      return { registered, longstanding };
    })();
  }

  /** Remove a domain from the current-snapshot table (its history stays in `changes`). */
  deleteDomain(name: string): void {
    this.sql.prepare(`DELETE FROM domains WHERE domain = ?`).run(name.trim().toLowerCase());
  }

  searchDomains(f: SearchFilter = {}): DomainRow[] {
    const clauses: string[] = [];
    const params: Record<string, string> = {};
    if (f.q && f.q.trim()) {
      params.q = `%${f.q.trim().toLowerCase()}%`;
      clauses.push(
        `(lower(domain) LIKE @q OR lower(coalesce(org,'')) LIKE @q
          OR lower(coalesce(suborg,'')) LIKE @q OR lower(coalesce(security_contact_email,'')) LIKE @q)`,
      );
    }
    if (f.org && f.org.trim()) {
      params.org = `%${f.org.trim().toLowerCase()}%`;
      clauses.push(`lower(coalesce(org,'')) LIKE @org`);
    }
    if (f.suborg && f.suborg.trim()) {
      params.suborg = `%${f.suborg.trim().toLowerCase()}%`;
      clauses.push(`lower(coalesce(suborg,'')) LIKE @suborg`);
    }
    if (f.contact && f.contact.trim()) {
      params.contact = `%${f.contact.trim().toLowerCase()}%`;
      clauses.push(`lower(coalesce(security_contact_email,'')) LIKE @contact`);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const limit = Math.max(1, Math.min(f.limit ?? 200, 1000));
    return this.sql
      .prepare(`SELECT * FROM domains ${where} ORDER BY domain ASC LIMIT ${limit}`)
      .all(params) as DomainRow[];
  }

  // ---- observations -------------------------------------------------------

  /** Insert; skips (returns inserted=false) when (module,domain,content_hash) already exists. */
  insertObservation(obs: Observation): { inserted: boolean; id: number | null } {
    const info = this.sql
      .prepare(
        `INSERT OR IGNORE INTO observations
           (module, domain, observed_at, source_url, content_hash, payload_json)
         VALUES (@module, @domain, @observedAt, @sourceUrl, @contentHash, @payloadJson)`,
      )
      .run({
        module: obs.module,
        domain: obs.domain,
        observedAt: obs.observedAt,
        sourceUrl: obs.sourceUrl,
        contentHash: obs.contentHash,
        payloadJson: JSON.stringify(obs.payload),
      });
    return {
      inserted: info.changes > 0,
      id: info.changes > 0 ? Number(info.lastInsertRowid) : null,
    };
  }

  latestObservation(module: string, domain: string): ObservationRow | null {
    const row = this.sql
      .prepare(
        `SELECT * FROM observations
         WHERE module = ? AND domain = ?
         ORDER BY observed_at DESC, id DESC LIMIT 1`,
      )
      .get(module, domain) as ObservationRow | undefined;
    return row ?? null;
  }

  /** Latest observation per domain for a module — the "previous state" for diffing. */
  latestObservationsByDomain(module: string): Map<string, ObservationRow> {
    const rows = this.sql
      .prepare(
        `SELECT o.* FROM observations o
         JOIN (SELECT domain, MAX(id) AS mid FROM observations WHERE module = ? GROUP BY domain) m
           ON o.domain = m.domain AND o.id = m.mid
         WHERE o.module = ?`,
      )
      .all(module, module) as ObservationRow[];
    const map = new Map<string, ObservationRow>();
    for (const r of rows) map.set(r.domain, r);
    return map;
  }

  // ---- changes ------------------------------------------------------------

  insertChange(change: Change): number {
    const info = this.sql
      .prepare(
        `INSERT INTO changes
           (module, domain, detected_at, kind, field, old_value, new_value, severity, reason, source_url)
         VALUES (@module, @domain, @detectedAt, @kind, @field, @oldValue, @newValue, @severity, @reason, @sourceUrl)`,
      )
      .run({
        module: change.module,
        domain: change.domain,
        detectedAt: change.detectedAt,
        kind: change.kind,
        field: change.field ?? null,
        oldValue: change.oldValue ?? null,
        newValue: change.newValue ?? null,
        severity: change.severity,
        reason: change.reason ?? null,
        sourceUrl: change.sourceUrl ?? null,
      });
    return Number(info.lastInsertRowid);
  }

  listChanges(f: ChangeFilter = {}): ChangeRow[] {
    const clauses: string[] = [];
    const params: Record<string, string> = {};
    if (f.since) {
      params.since = f.since;
      clauses.push(`detected_at >= @since`);
    }
    if (f.severity) {
      params.severity = f.severity;
      clauses.push(`severity = @severity`);
    }
    if (f.module) {
      params.module = f.module;
      clauses.push(`module = @module`);
    }
    if (f.flag) {
      // Static predicate keyed by the validated flag enum — no user text reaches the SQL.
      clauses.push(`(${flagSqlPredicate(f.flag)})`);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const limit = Math.max(1, Math.min(f.limit ?? 100, 1000));
    return this.sql
      .prepare(
        `SELECT * FROM changes ${where} ORDER BY detected_at DESC, id DESC LIMIT ${limit}`,
      )
      .all(params) as ChangeRow[];
  }

  /**
   * The pool of recent significant findings behind the homepage "what we're seeing" cards. Returns
   * high/notable changes deduped to ONE per subject (see featuredSubject) — a single scan can log a
   * dozen subdomains on one apex in the same second (the ndstudio burst), or a dozen unlaunched
   * projects on one vendor (the Foundry batch), and only the best per subject should compete.
   * Within a subject and across them the ranking is severity → function-mimic (Lookout's flagship
   * signature) → recency, so the representative kept for each domain is its strongest finding.
   * `limit` caps the returned pool; the caller (featuredFindings) buckets it by type and samples.
   *
   * Severity tiers are queried SEPARATELY, not sliced from one flat recency window: a burst of fresh
   * `notable`s must never push `high` findings out of the pool — highs are always included.
   *
   * Reads only the `changes` table — which Redtape never writes to. Its PIA/SORN gaps live in a
   * separate table behind publicGaps()'s human gate and can never surface through this path.
   */
  featuredChanges(limit = 3): ChangeRow[] {
    const pool = [
      ...(this.listChanges({ severity: "high", limit: 1000 }) as ChangeRow[]),
      ...(this.listChanges({ severity: "notable", limit: 1000 }) as ChangeRow[]),
    ].sort((a, b) => featuredScore(b) - featuredScore(a) || cmpRecencyDesc(a, b));
    const seen = new Set<string>();
    const out: ChangeRow[] = [];
    for (const c of pool) {
      const subject = featuredSubject(c);
      if (seen.has(subject)) continue;
      seen.add(subject);
      out.push(c);
      if (out.length >= Math.max(1, limit)) break;
    }
    return out;
  }

  /**
   * Count changes bucketed by flag type in ONE pass — the /ledger chips need all seven counts,
   * and 7 separate COUNT+LIKE scans per page load are the visible latency there. The CASE
   * mirrors classifyChangeFlag / flagSqlPredicate precedence (verified equal in tests).
   */
  countChangesByFlag(f: { module?: string; severity?: string; since?: string } = {}): Record<FlagKind, number> {
    const clauses: string[] = [];
    const params: Record<string, string> = {};
    if (f.since) {
      params.since = f.since;
      clauses.push(`detected_at >= @since`);
    }
    if (f.severity) {
      params.severity = f.severity;
      clauses.push(`severity = @severity`);
    }
    if (f.module) {
      params.module = f.module;
      clauses.push(`module = @module`);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = this.sql
      .prepare(
        `SELECT CASE
           WHEN lower(reason) LIKE '%foreign to%' THEN 'contact-mismatch'
           WHEN lower(reason) LIKE '%watched%' THEN 'watchlist'
           WHEN kind = 'added' THEN 'new-domain'
           WHEN kind = 'removed' THEN 'removed'
           WHEN kind = 'modified' AND field = 'securityContactEmail' THEN 'contact-change'
           WHEN kind = 'modified' AND field IN ('org','suborg','domainType') THEN 'owner-change'
           ELSE 'other'
         END AS bucket, COUNT(*) AS c
         FROM changes ${where} GROUP BY bucket`,
      )
      .all(params) as { bucket: FlagKind; c: number }[];
    const out: Record<FlagKind, number> = {
      "contact-mismatch": 0,
      watchlist: 0,
      "new-domain": 0,
      removed: 0,
      "contact-change": 0,
      "owner-change": 0,
      other: 0,
    };
    for (const r of rows) out[r.bucket] = r.c;
    return out;
  }

  /** Count changes matching a filter (same clauses as listChanges) — for filter-chip totals. */
  countChanges(f: ChangeFilter = {}): number {
    const clauses: string[] = [];
    const params: Record<string, string> = {};
    if (f.since) {
      params.since = f.since;
      clauses.push(`detected_at >= @since`);
    }
    if (f.severity) {
      params.severity = f.severity;
      clauses.push(`severity = @severity`);
    }
    if (f.module) {
      params.module = f.module;
      clauses.push(`module = @module`);
    }
    if (f.flag) clauses.push(`(${flagSqlPredicate(f.flag)})`);
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const row = this.sql.prepare(`SELECT COUNT(*) AS c FROM changes ${where}`).get(params) as {
      c: number;
    };
    return row.c;
  }

  domainHistory(name: string): ChangeRow[] {
    return this.sql
      .prepare(
        `SELECT * FROM changes WHERE domain = ? ORDER BY detected_at ASC, id ASC`,
      )
      .all(name.trim().toLowerCase()) as ChangeRow[];
  }

  /** A single change by id — powers the /change/{id} permalink + cite block. */
  getChange(id: number): ChangeRow | null {
    const row = this.sql.prepare(`SELECT * FROM changes WHERE id = ?`).get(id) as
      | ChangeRow
      | undefined;
    return row ?? null;
  }

  /** Minimal (id, detected_at) for every change, newest first — powers the sitemap without loading
   *  full rows. Goes through the DB seam so the Postgres swap never touches the sitemap route. */
  changeStamps(): { id: number; detected_at: string }[] {
    return this.sql
      .prepare(`SELECT id, detected_at FROM changes ORDER BY id DESC`)
      .all() as { id: number; detected_at: string }[];
  }

  // ---- scans / status -----------------------------------------------------

  recordScanStart(module: string): number {
    const info = this.sql
      .prepare(`INSERT INTO scans (module, started_at) VALUES (?, ?)`)
      .run(module, nowIso());
    return Number(info.lastInsertRowid);
  }

  recordScanFinish(scanId: number, r: ScanFinish): void {
    this.sql
      .prepare(
        `UPDATE scans SET finished_at = @finishedAt, ok = @ok, error = @error,
           items_seen = @itemsSeen, changes_emitted = @changesEmitted WHERE id = @id`,
      )
      .run({
        id: scanId,
        finishedAt: nowIso(),
        ok: r.ok ? 1 : 0,
        error: r.error ?? null,
        itemsSeen: r.itemsSeen ?? null,
        changesEmitted: r.changesEmitted ?? null,
      });
  }

  /** Most recent scan per module — powers /status. */
  getStatus(): ScanRow[] {
    return this.sql
      .prepare(
        `SELECT s.* FROM scans s
         JOIN (SELECT module, MAX(id) AS mid FROM scans GROUP BY module) m
           ON s.module = m.module AND s.id = m.mid
         ORDER BY s.module ASC`,
      )
      .all() as ScanRow[];
  }

  // ---- alerts -------------------------------------------------------------

  insertAlert(a: AlertInsert): number {
    const info = this.sql
      .prepare(
        `INSERT INTO alerts (change_id, subscription_pattern, channel, target, sent_at, ok, error)
         VALUES (@changeId, @subscriptionPattern, @channel, @target, @sentAt, @ok, @error)`,
      )
      .run({
        changeId: a.changeId,
        subscriptionPattern: a.subscriptionPattern ?? null,
        channel: a.channel ?? null,
        target: a.target ?? null,
        sentAt: a.sentAt ?? null,
        ok: a.ok === undefined || a.ok === null ? null : a.ok ? 1 : 0,
        error: a.error ?? null,
      });
    return Number(info.lastInsertRowid);
  }

  listAlerts(changeId?: number): AlertRow[] {
    if (changeId !== undefined) {
      return this.sql
        .prepare(`SELECT * FROM alerts WHERE change_id = ? ORDER BY id ASC`)
        .all(changeId) as AlertRow[];
    }
    return this.sql.prepare(`SELECT * FROM alerts ORDER BY id ASC`).all() as AlertRow[];
  }

  countAlerts(): number {
    const row = this.sql.prepare(`SELECT COUNT(*) AS n FROM alerts`).get() as { n: number };
    return row.n;
  }

  // ---- subdomains (Lookout / Phase 2) -------------------------------------

  /** Insert a subdomain; on repeat, advance last_seen + refresh flags/enrichment.
   *  Returns inserted=false when the fqdn was already known (idempotency). */
  upsertSubdomain(sub: SubdomainInput, seenAt: string): { inserted: boolean } {
    const existed = this.sql
      .prepare(`SELECT 1 FROM subdomains WHERE fqdn = ?`)
      .get(sub.fqdn) as unknown;
    this.sql
      .prepare(
        `INSERT INTO subdomains
           (fqdn, apex, first_seen, last_seen, labels, flag_severity, flag_reason, apex_owner_org, apex_owner_suborg)
         VALUES (@fqdn, @apex, @seenAt, @seenAt, @labels, @flagSeverity, @flagReason, @apexOwnerOrg, @apexOwnerSuborg)
         ON CONFLICT(fqdn) DO UPDATE SET
           last_seen = excluded.last_seen,
           labels = excluded.labels,
           flag_severity = excluded.flag_severity,
           flag_reason = excluded.flag_reason,
           apex_owner_org = excluded.apex_owner_org,
           apex_owner_suborg = excluded.apex_owner_suborg`,
      )
      .run({
        fqdn: sub.fqdn,
        apex: sub.apex,
        seenAt,
        labels: JSON.stringify(sub.labels ?? []),
        flagSeverity: sub.flagSeverity ?? null,
        flagReason: sub.flagReason ?? null,
        apexOwnerOrg: sub.apexOwnerOrg ?? null,
        apexOwnerSuborg: sub.apexOwnerSuborg ?? null,
      });
    return { inserted: !existed };
  }

  getSubdomain(fqdn: string): SubdomainRow | null {
    const row = this.sql
      .prepare(`SELECT * FROM subdomains WHERE fqdn = ?`)
      .get(fqdn.trim().toLowerCase()) as SubdomainRow | undefined;
    return row ?? null;
  }

  subdomainsByApex(apex: string): SubdomainRow[] {
    return this.sql
      .prepare(`SELECT * FROM subdomains WHERE apex = ? ORDER BY first_seen DESC, fqdn ASC`)
      .all(apex.trim().toLowerCase()) as SubdomainRow[];
  }

  /** Every subdomain row (uncapped) — Foundry's corpus for the vendor build-graph join. */
  allSubdomains(): SubdomainRow[] {
    return this.sql
      .prepare(`SELECT * FROM subdomains ORDER BY first_seen ASC, fqdn ASC`)
      .all() as SubdomainRow[];
  }

  searchSubdomains(f: { q?: string; severity?: string; limit?: number } = {}): SubdomainRow[] {
    const clauses: string[] = [];
    const params: Record<string, string> = {};
    if (f.q && f.q.trim()) {
      params.q = `%${f.q.trim().toLowerCase()}%`;
      clauses.push(`(lower(fqdn) LIKE @q OR lower(apex) LIKE @q OR lower(coalesce(apex_owner_org,'')) LIKE @q)`);
    }
    if (f.severity) {
      params.severity = f.severity;
      clauses.push(`flag_severity = @severity`);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const limit = Math.max(1, Math.min(f.limit ?? 200, 1000));
    return this.sql
      .prepare(`SELECT * FROM subdomains ${where} ORDER BY first_seen DESC, fqdn ASC LIMIT ${limit}`)
      .all(params) as SubdomainRow[];
  }

  // ---- scorecards (Floodlight / Phase 3) ----------------------------------

  upsertScorecard(sc: ScorecardInput, scannedAt: string): void {
    this.sql
      .prepare(
        `INSERT INTO scorecards
           (url, domain, scanned_at, tracker_count, session_replay, first_party_proxied,
            privacy_notice_url, request_count, engine_version, severity, trackers_json, reasons_json,
            form_fields_json)
         VALUES
           (@url, @domain, @scannedAt, @trackerCount, @sessionReplay, @firstPartyProxied,
            @privacyNoticeUrl, @requestCount, @engineVersion, @severity, @trackersJson, @reasonsJson,
            @formFieldsJson)
         ON CONFLICT(url) DO UPDATE SET
           domain = excluded.domain, scanned_at = excluded.scanned_at,
           tracker_count = excluded.tracker_count, session_replay = excluded.session_replay,
           first_party_proxied = excluded.first_party_proxied,
           privacy_notice_url = excluded.privacy_notice_url, request_count = excluded.request_count,
           engine_version = excluded.engine_version, severity = excluded.severity,
           trackers_json = excluded.trackers_json, reasons_json = excluded.reasons_json,
           form_fields_json = excluded.form_fields_json`,
      )
      .run({
        url: sc.url,
        domain: sc.domain,
        scannedAt,
        trackerCount: sc.trackerCount,
        sessionReplay: sc.sessionReplay ? 1 : 0,
        firstPartyProxied: sc.firstPartyProxied ? 1 : 0,
        privacyNoticeUrl: sc.privacyNoticeUrl,
        requestCount: sc.requestCount,
        engineVersion: sc.engineVersion,
        severity: sc.severity,
        trackersJson: sc.trackersJson,
        reasonsJson: sc.reasonsJson,
        formFieldsJson: sc.formFieldsJson ?? null,
      });
  }

  getScorecard(url: string): ScorecardRow | null {
    const row = this.sql.prepare(`SELECT * FROM scorecards WHERE url = ?`).get(url) as
      | ScorecardRow
      | undefined;
    return row ?? null;
  }

  scorecardsByDomain(domain: string): ScorecardRow[] {
    return this.sql
      .prepare(`SELECT * FROM scorecards WHERE domain = ? ORDER BY scanned_at DESC`)
      .all(domain.trim().toLowerCase()) as ScorecardRow[];
  }

  listScorecards(f: { severity?: string; limit?: number } = {}): ScorecardRow[] {
    const where = f.severity ? `WHERE severity = @severity` : "";
    const limit = Math.max(1, Math.min(f.limit ?? 100, 1000));
    return this.sql
      .prepare(`SELECT * FROM scorecards ${where} ORDER BY scanned_at DESC LIMIT ${limit}`)
      .all(f.severity ? { severity: f.severity } : {}) as ScorecardRow[];
  }

  // ---- snapshots (Receipts / Phase 4) -------------------------------------

  insertSnapshot(snap: SnapshotInput): number {
    const info = this.sql
      .prepare(
        `INSERT INTO snapshots
           (url, domain, captured_at, dom_hash, screenshot_ref, tracker_snapshot_json,
            privacy_text_hash, form_fields_json, seal_present, redirect_target, wayback_url)
         VALUES
           (@url, @domain, @capturedAt, @domHash, @screenshotRef, @trackerSnapshotJson,
            @privacyTextHash, @formFieldsJson, @sealPresent, @redirectTarget, @waybackUrl)`,
      )
      .run({
        url: snap.url,
        domain: snap.domain,
        capturedAt: snap.capturedAt,
        domHash: snap.domHash ?? null,
        screenshotRef: snap.screenshotRef ?? null,
        trackerSnapshotJson: snap.trackerSnapshotJson ?? null,
        privacyTextHash: snap.privacyTextHash ?? null,
        formFieldsJson: snap.formFieldsJson ?? null,
        sealPresent: snap.sealPresent ? 1 : 0,
        redirectTarget: snap.redirectTarget ?? null,
        waybackUrl: snap.waybackUrl ?? null,
      });
    return Number(info.lastInsertRowid);
  }

  latestSnapshot(url: string): SnapshotRow | null {
    const row = this.sql
      .prepare(`SELECT * FROM snapshots WHERE url = ? ORDER BY captured_at DESC, id DESC LIMIT 1`)
      .get(url) as SnapshotRow | undefined;
    return row ?? null;
  }

  listSnapshots(url: string): SnapshotRow[] {
    return this.sql
      .prepare(`SELECT * FROM snapshots WHERE url = ? ORDER BY captured_at DESC, id DESC`)
      .all(url) as SnapshotRow[];
  }

  snapshotsByDomain(domain: string): SnapshotRow[] {
    return this.sql
      .prepare(`SELECT * FROM snapshots WHERE domain = ? ORDER BY captured_at DESC, id DESC`)
      .all(domain.trim().toLowerCase()) as SnapshotRow[];
  }

  /** Every snapshot that claims an archive, id + URL only — for auditing those URLs against the
   *  "must be timestamp-pinned" rule without pulling whole rows. */
  archivedSnapshotRefs(): { id: number; wayback_url: string }[] {
    return this.sql
      .prepare(`SELECT id, wayback_url FROM snapshots WHERE wayback_url IS NOT NULL`)
      .all() as { id: number; wayback_url: string }[];
  }

  /** Point an existing snapshot at an archive found after the fact (a retried/backfilled save).
   *  Used when a re-capture is content-identical — the snapshot short-circuits, but a missing
   *  archive still deserves another attempt. */
  updateSnapshotWayback(snapshotId: number, waybackUrl: string | null): void {
    this.sql.prepare(`UPDATE snapshots SET wayback_url = ? WHERE id = ?`).run(waybackUrl, snapshotId);
  }

  /** Coverage view: the latest snapshot for each watched page, newest capture first, joined to
   *  the most recent archive on file for that page. Powers the "what we're watching" table so
   *  the page is useful even when nothing has been removed yet.
   *
   *  The archive is looked up across ALL of a page's snapshots, not just the latest: a single
   *  failed SPN2 save used to blank the column for a page we had archived perfectly well. The
   *  archive's own `captured_at` rides along so the UI can date it honestly rather than imply
   *  it covers the newest capture. */
  coverageSnapshots(limit = 500): CoverageRow[] {
    const n = Math.max(1, Math.min(limit, 2000));
    return this.sql
      .prepare(
        `SELECT s.*, a.wayback_url AS archive_url, a.captured_at AS archive_captured_at
         FROM (
           SELECT *, ROW_NUMBER() OVER (PARTITION BY url ORDER BY captured_at DESC, id DESC) AS rn
           FROM snapshots
         ) s
         LEFT JOIN (
           SELECT url, wayback_url, captured_at,
                  ROW_NUMBER() OVER (PARTITION BY url ORDER BY captured_at DESC, id DESC) AS arn
           FROM snapshots WHERE wayback_url IS NOT NULL
         ) a ON a.url = s.url AND a.arn = 1
         WHERE s.rn = 1
         ORDER BY s.captured_at DESC, s.url ASC LIMIT ${n}`,
      )
      .all() as CoverageRow[];
  }

  /** The removal ledger: high-severity `removed` change events from Receipts. */
  removalLedger(limit = 100): ChangeRow[] {
    const n = Math.max(1, Math.min(limit, 1000));
    return this.sql
      .prepare(
        `SELECT * FROM changes WHERE module = 'receipts' AND kind = 'removed'
         ORDER BY detected_at DESC, id DESC LIMIT ${n}`,
      )
      .all() as ChangeRow[];
  }

  // ---- gaps (Redtape / Phase 5) -------------------------------------------

  insertGap(gap: GapInput): number {
    const info = this.sql
      .prepare(
        `INSERT INTO gaps
           (domain, url, collects_pii_evidence_json, pia_found, pia_refs_json, sorn_found,
            sorn_refs_json, queries_run_json, sources_checked_json, gap_assessment, confidence,
            fact_vs_inference_notes, agent_recommendation, human_reviewed, reviewer_note, published, created_at)
         VALUES
           (@domain, @url, @collectsPiiEvidenceJson, @piaFound, @piaRefsJson, @sornFound,
            @sornRefsJson, @queriesRunJson, @sourcesCheckedJson, @gapAssessment, @confidence,
            @factVsInferenceNotes, @agentRecommendation, 0, NULL, 0, @createdAt)`,
      )
      .run({
        domain: gap.domain,
        url: gap.url ?? null,
        collectsPiiEvidenceJson: JSON.stringify(gap.collectsPiiEvidence ?? []),
        piaFound: gap.piaFound === null || gap.piaFound === undefined ? null : gap.piaFound ? 1 : 0,
        piaRefsJson: JSON.stringify(gap.piaRefs ?? []),
        sornFound: gap.sornFound === null || gap.sornFound === undefined ? null : gap.sornFound ? 1 : 0,
        sornRefsJson: JSON.stringify(gap.sornRefs ?? []),
        queriesRunJson: JSON.stringify(gap.queriesRun ?? []),
        sourcesCheckedJson: JSON.stringify(gap.sourcesChecked ?? []),
        gapAssessment: gap.gapAssessment,
        confidence: gap.confidence ?? null,
        factVsInferenceNotes: gap.factVsInferenceNotes ?? null,
        agentRecommendation: gap.agentRecommendation ?? null,
        createdAt: gap.createdAt,
      });
    return Number(info.lastInsertRowid);
  }

  getGap(id: number): GapRow | null {
    const row = this.sql.prepare(`SELECT * FROM gaps WHERE id = ?`).get(id) as GapRow | undefined;
    return row ?? null;
  }

  /**
   * PUBLIC read path for Redtape — the human gate, enforced at the data layer (spec §4.3/§8).
   * ONLY rows a human reviewed AND published are ever returned. Do not add a public path
   * that bypasses this.
   */
  publicGaps(limit = 100): GapRow[] {
    const n = Math.max(1, Math.min(limit, 1000));
    // Enforce the §7.6 "documented negative" invariant structurally on the READ side too: a
    // public gap must carry a non-empty query + source trail so a stranger can re-verify the
    // absence. This blocks a trail-less `manual` gap even if a reviewer publishes it. (Explicit
    // IS NOT NULL / <> '[]' — SQL NULL comparisons via IN/NOT IN would silently never match.)
    const rows = this.sql
      .prepare(
        `SELECT * FROM gaps
         WHERE human_reviewed = 1 AND published = 1
           AND queries_run_json IS NOT NULL AND queries_run_json <> '[]'
           AND sources_checked_json IS NOT NULL AND sources_checked_json <> '[]'
         ORDER BY created_at DESC, id DESC LIMIT ${n}`,
      )
      .all() as GapRow[];
    // agent_recommendation is INTERNAL guidance — strip it from EVERY public read path (this method
    // feeds /redtape, the feeds, and /api/v1/gaps). reviewer_note stays public (the human curates it
    // before publishing); the agent's private recommendation must never leave the review screen.
    for (const r of rows) r.agent_recommendation = null;
    return rows;
  }

  /**
   * Internal review queue — unreviewed rows that are actual gaps (never a public path).
   * Excludes 'covered' assessments: the researcher found a filing that covers the collection, so
   * there's no gap to decide on. They stay in the table (audit + the re-check-published path) but
   * don't clutter the human queue — otherwise a sweep over dozens of established agencies (which
   * nearly all have SORNs) buries the few real gaps under a wall of non-findings.
   */
  reviewQueueGaps(limit = 200): GapRow[] {
    const n = Math.max(1, Math.min(limit, 1000));
    // Hide the sweep's auto-'covered' non-findings so they don't bury the queue — BUT keep any item a
    // human has already annotated (reviewer_note present), so a queue item saved-and-reclassified to
    // 'covered' via saveGapNote doesn't silently vanish from every section.
    return this.sql
      .prepare(
        `SELECT * FROM gaps
         WHERE human_reviewed = 0
           AND (gap_assessment IS NULL OR gap_assessment != 'covered' OR reviewer_note IS NOT NULL)
         ORDER BY created_at ASC LIMIT ${n}`,
      )
      .all() as GapRow[];
  }

  /** Human review action — publish / hold / reject. `disposition` records WHICH decision so the UI
   *  can separate "held — revisit later" from "rejected" (both are published = 0, so the published
   *  bit alone can't tell them apart). Defaults to published → 'published', else 'rejected'.
   *
   *  The reviewer may also RECLASSIFY: pass `assessment` to override the model's gap_assessment
   *  (e.g. after finding a filing the Federal-Register-only agent missed) and/or `confidence`. The
   *  model's ORIGINAL label is preserved once in `model_assessment` so the machine's interpretation
   *  is never silently overwritten (raw + interpretation preserved — provenance). */
  reviewGap(
    id: number,
    r: {
      published: boolean;
      reviewerNote?: string | null;
      disposition?: string | null;
      assessment?: string | null;
      confidence?: number | null;
    },
  ): void {
    const disposition = r.disposition ?? (r.published ? "published" : "rejected");
    // Guard the canonical set. heldGaps()/reviewedGaps() key off exactly these strings, so a caller
    // passing a near-miss (e.g. the button value 'hold' instead of 'held') would silently vanish
    // from the Held section. Fail loud instead.
    if (disposition !== "published" && disposition !== "held" && disposition !== "rejected") {
      throw new Error(`reviewGap: invalid disposition "${disposition}" (expected published|held|rejected)`);
    }
    // A reviewer can reclassify only to one of the three real assessments — never to 'manual'
    // (the parse-failure sentinel, not a human choice).
    const override = r.assessment?.trim() || null;
    if (override && override !== "no_filing" && override !== "incomplete_filing" && override !== "covered") {
      throw new Error(`reviewGap: invalid assessment "${override}" (expected no_filing|incomplete_filing|covered)`);
    }
    const tx = this.sql.transaction(() => {
      const cur = this.getGap(id);
      let gapAssessment = cur?.gap_assessment ?? null;
      let modelAssessment = cur?.model_assessment ?? null;
      let confidence = cur?.confidence ?? null;
      if (override && override !== gapAssessment) {
        // Preserve the model's original interpretation the FIRST time it's overridden. On a later
        // re-edit we keep the earliest model label, not the previous human value.
        if (modelAssessment === null) modelAssessment = gapAssessment;
        gapAssessment = override;
      }
      if (r.confidence !== null && r.confidence !== undefined && Number.isFinite(r.confidence)) {
        confidence = Math.max(0, Math.min(1, r.confidence));
      }
      this.sql
        .prepare(
          `UPDATE gaps SET human_reviewed = 1, published = @published, reviewer_note = @note,
                           review_disposition = @disposition, gap_assessment = @gapAssessment,
                           model_assessment = @modelAssessment, confidence = @confidence
             WHERE id = @id`,
        )
        .run({
          id,
          published: r.published ? 1 : 0,
          note: r.reviewerNote ?? null,
          disposition,
          gapAssessment,
          modelAssessment,
          confidence,
        });
    });
    tx();
  }

  /** Save the reviewer's working note (and optional reclassification) WITHOUT deciding — the item
   *  stays exactly where it is: `human_reviewed` and `review_disposition` are untouched, so a queue
   *  item stays in the queue and a held item stays held. Lets a reviewer draft/curate a note across
   *  sessions before publishing. Same reclassify provenance as reviewGap: the model's original label
   *  is preserved once in `model_assessment`. */
  saveGapNote(
    id: number,
    r: { reviewerNote?: string | null; assessment?: string | null; confidence?: number | null },
  ): void {
    const override = r.assessment?.trim() || null;
    if (override && override !== "no_filing" && override !== "incomplete_filing" && override !== "covered") {
      throw new Error(`saveGapNote: invalid assessment "${override}" (expected no_filing|incomplete_filing|covered)`);
    }
    const tx = this.sql.transaction(() => {
      const cur = this.getGap(id);
      let gapAssessment = cur?.gap_assessment ?? null;
      let modelAssessment = cur?.model_assessment ?? null;
      let confidence = cur?.confidence ?? null;
      if (override && override !== gapAssessment) {
        if (modelAssessment === null) modelAssessment = gapAssessment;
        gapAssessment = override;
      }
      if (r.confidence !== null && r.confidence !== undefined && Number.isFinite(r.confidence)) {
        confidence = Math.max(0, Math.min(1, r.confidence));
      }
      this.sql
        .prepare(
          `UPDATE gaps SET reviewer_note = @note, gap_assessment = @gapAssessment,
                           model_assessment = @modelAssessment, confidence = @confidence
             WHERE id = @id`,
        )
        .run({ id, note: r.reviewerNote ?? null, gapAssessment, modelAssessment, confidence });
    });
    tx();
  }

  /** Set the agent's INTERNAL recommendation on a gap (the re-check flow refreshes it; backfill uses
   *  it too). This field is shown on /review and NEVER on the public /redtape path. */
  setGapAgentRecommendation(id: number, recommendation: string | null): void {
    this.sql
      .prepare(`UPDATE gaps SET agent_recommendation = @rec WHERE id = @id`)
      .run({ id, rec: recommendation });
  }

  /** All gaps for a domain (any state) — used to dedup re-assessment by evidence. */
  gapsByDomain(domain: string): GapRow[] {
    return this.sql
      .prepare(`SELECT * FROM gaps WHERE domain = ? ORDER BY created_at DESC`)
      .all(domain.trim().toLowerCase()) as GapRow[];
  }

  /** Pull a gap back to the review queue (un-publish, mark unreviewed) — e.g. when an
   *  auto-re-check finds a filing now exists. Removing a possibly-stale public claim is the
   *  fail-safe direction; a human still confirms via /review. The un-publish is logged as a
   *  PUBLIC correction (see corrections table) — we never quietly remove our own claims. */
  requeueGap(id: number, note: string): void {
    const gap = this.getGap(id);
    this.sql
      .prepare(
        `UPDATE gaps SET human_reviewed = 0, published = 0, reviewer_note = @note WHERE id = @id`,
      )
      .run({ id, note });
    if (gap) {
      this.insertCorrection({
        domain: gap.domain,
        module: "redtape",
        kind: "retraction",
        reason: note,
        refId: id,
        createdAt: nowIso(),
      });
    }
  }

  /** Reviewed gaps EXCEPT held — published or rejected decisions, for the /review "Reviewed" panel.
   *  Held gaps get their own revisit section (heldGaps). NOT a public path; the public gate stays
   *  publicGaps() (human_reviewed = 1 AND published = 1). */
  reviewedGaps(limit = 50): GapRow[] {
    const n = Math.max(1, Math.min(limit, 1000));
    return this.sql
      .prepare(
        `SELECT * FROM gaps
         WHERE human_reviewed = 1 AND (review_disposition IS NULL OR review_disposition != 'held')
         ORDER BY id DESC LIMIT ${n}`,
      )
      .all() as GapRow[];
  }

  /** Gaps the reviewer HELD to revisit later (reviewed, kept private, flagged 'held'). Its own
   *  /review section so a "come back to this" decision isn't buried among rejects. Never public. */
  heldGaps(limit = 50): GapRow[] {
    const n = Math.max(1, Math.min(limit, 1000));
    return this.sql
      .prepare(
        `SELECT * FROM gaps WHERE human_reviewed = 1 AND review_disposition = 'held'
         ORDER BY id DESC LIMIT ${n}`,
      )
      .all() as GapRow[];
  }

  /** Return a reviewed gap to the queue to revise the decision. If it was PUBLISHED, this
   *  un-publishes it AND logs a public correction (we never quietly drop a public claim). If it
   *  was only held/rejected (never public), it simply re-queues — no correction, since nothing was
   *  ever published. The prior reviewer_note is kept as context; the disposition is cleared. */
  reopenGapForRevision(id: number): void {
    const gap = this.getGap(id);
    const wasPublished = gap?.published === 1;
    this.sql
      .prepare(`UPDATE gaps SET human_reviewed = 0, published = 0, review_disposition = NULL WHERE id = @id`)
      .run({ id });
    if (wasPublished && gap) {
      this.insertCorrection({
        domain: gap.domain,
        module: "redtape",
        kind: "retraction",
        reason: "Published gap returned to the review queue for revision.",
        refId: id,
        createdAt: nowIso(),
      });
    }
  }

  // ---- corrections (public retraction/amendment ledger) -------------------

  insertCorrection(c: {
    domain: string;
    module: string;
    kind: string;
    reason: string;
    refId?: number | null;
    createdAt: string;
  }): number {
    const info = this.sql
      .prepare(
        `INSERT INTO corrections (domain, module, kind, reason, ref_id, created_at)
         VALUES (@domain, @module, @kind, @reason, @refId, @createdAt)`,
      )
      .run({
        domain: c.domain,
        module: c.module,
        kind: c.kind,
        reason: c.reason,
        refId: c.refId ?? null,
        createdAt: c.createdAt,
      });
    return Number(info.lastInsertRowid);
  }

  listCorrections(limit = 100): CorrectionRow[] {
    const n = Math.max(1, Math.min(limit, 1000));
    return this.sql
      .prepare(`SELECT * FROM corrections ORDER BY created_at DESC, id DESC LIMIT ${n}`)
      .all() as CorrectionRow[];
  }

  // ---- analytics (first-party, aggregate-only; powers /privacy) -----------
  // Every method here reads or writes ONLY aggregate counts. The table holds no per-visitor data
  // (no IP/UA/cookie column exists), so none of these can leak one. See schema.ts + /privacy.

  /** Increment the running count for one (day, path, referrer-class) bucket. Called from the
   *  request path (middleware), so it stays a single prepared UPSERT — cheap and lock-friendly. */
  recordHit(h: { day: string; path: string; refKind: string; refHost: string }): void {
    this.sql
      .prepare(
        `INSERT INTO analytics_hits (day, path, ref_kind, ref_host, count)
         VALUES (@day, @path, @refKind, @refHost, 1)
         ON CONFLICT(day, path, ref_kind, ref_host) DO UPDATE SET count = count + 1`,
      )
      .run(h);
  }

  /** Per-day visit totals (summed across paths) on/after `sinceDay` (YYYY-MM-DD), oldest first. */
  analyticsDailyTotals(sinceDay: string): { day: string; count: number }[] {
    return this.sql
      .prepare(
        `SELECT day, SUM(count) AS count FROM analytics_hits
         WHERE day >= @sinceDay GROUP BY day ORDER BY day ASC`,
      )
      .all({ sinceDay }) as { day: string; count: number }[];
  }

  /** Most-visited normalized routes in the window (all paths, incl. the /feed + /api consumption
   *  buckets — the caller splits those out). */
  analyticsTopPaths(sinceDay: string, limit = 12): { path: string; count: number }[] {
    const n = Math.max(1, Math.min(limit, 100));
    return this.sql
      .prepare(
        `SELECT path, SUM(count) AS count FROM analytics_hits
         WHERE day >= @sinceDay GROUP BY path ORDER BY count DESC, path ASC LIMIT ${n}`,
      )
      .all({ sinceDay }) as { path: string; count: number }[];
  }

  /** Every path's total in the window (uncapped — the normalized path set is small). Lets the
   *  caller separate human page views from the /feed + /api consumption buckets. */
  analyticsPathTotals(sinceDay: string): { path: string; count: number }[] {
    return this.sql
      .prepare(
        `SELECT path, SUM(count) AS count FROM analytics_hits
         WHERE day >= @sinceDay GROUP BY path ORDER BY count DESC, path ASC`,
      )
      .all({ sinceDay }) as { path: string; count: number }[];
  }

  /** Page-view totals by referrer class (direct/gov/search/other) in the window. Excludes the
   *  /feed + /api consumption buckets so the "where visitors come from" mix reflects humans. */
  analyticsRefKindTotals(sinceDay: string): { ref_kind: string; count: number }[] {
    return this.sql
      .prepare(
        `SELECT ref_kind, SUM(count) AS count FROM analytics_hits
         WHERE day >= @sinceDay AND path NOT IN ('/feed', '/api')
         GROUP BY ref_kind ORDER BY count DESC`,
      )
      .all({ sinceDay }) as { ref_kind: string; count: number }[];
  }

  /** The headline .gov panel: which federal domains sent visitors here, by public apex. */
  analyticsGovReferrers(sinceDay: string, limit = 50): { ref_host: string; count: number }[] {
    const n = Math.max(1, Math.min(limit, 500));
    return this.sql
      .prepare(
        `SELECT ref_host, SUM(count) AS count FROM analytics_hits
         WHERE day >= @sinceDay AND ref_kind = 'gov' AND ref_host <> ''
           AND path NOT IN ('/feed', '/api')
         GROUP BY ref_host ORDER BY count DESC, ref_host ASC LIMIT ${n}`,
      )
      .all({ sinceDay }) as { ref_host: string; count: number }[];
  }

  /** Total recorded visits in the window. */
  analyticsTotalVisits(sinceDay: string): number {
    const row = this.sql
      .prepare(`SELECT COALESCE(SUM(count), 0) AS n FROM analytics_hits WHERE day >= @sinceDay`)
      .get({ sinceDay }) as { n: number };
    return row.n;
  }

  /** Earliest day with any recorded hit (for the "counting since …" line), or null if empty. */
  analyticsFirstDay(): string | null {
    const row = this.sql.prepare(`SELECT MIN(day) AS d FROM analytics_hits`).get() as {
      d: string | null;
    };
    return row.d ?? null;
  }

  /** Wipe every analytics row and return how many were removed. Operator maintenance only (the
   *  `pnpm analytics:reset` CLI): lets a low-traffic launch clear counts inflated by the
   *  operator's own testing. Touches only the aggregate table — no visitor data exists to lose. */
  resetAnalytics(): number {
    return this.sql.prepare(`DELETE FROM analytics_hits`).run().changes;
  }

  close(): void {
    this.sql.close();
  }
}

export interface GapInput {
  domain: string;
  url?: string | null;
  collectsPiiEvidence?: string[];
  piaFound?: boolean | null;
  piaRefs?: string[];
  sornFound?: boolean | null;
  sornRefs?: string[];
  queriesRun?: string[];
  sourcesChecked?: string[];
  gapAssessment: string;
  confidence?: number | null;
  factVsInferenceNotes?: string | null;
  agentRecommendation?: string | null;
  createdAt: string;
}

export interface SnapshotInput {
  url: string;
  domain: string;
  capturedAt: string;
  domHash?: string | null;
  screenshotRef?: string | null;
  trackerSnapshotJson?: string | null;
  privacyTextHash?: string | null;
  formFieldsJson?: string | null;
  sealPresent?: boolean;
  redirectTarget?: string | null;
  waybackUrl?: string | null;
}

export interface ScorecardInput {
  url: string;
  domain: string;
  trackerCount: number;
  sessionReplay: boolean;
  firstPartyProxied: boolean;
  privacyNoticeUrl: string | null;
  requestCount: number;
  engineVersion: string;
  severity: string;
  trackersJson: string;
  reasonsJson: string;
  /** JSON array of normalized PII field kinds (optional; defaults to null). */
  formFieldsJson?: string | null;
}

export interface SubdomainInput {
  fqdn: string;
  apex: string;
  labels?: string[];
  flagSeverity?: string | null;
  flagReason?: string | null;
  apexOwnerOrg?: string | null;
  apexOwnerSuborg?: string | null;
}

// ---- singleton + convenience free functions (the §3.4 surface) -------------

let _default: DaylightDb | null = null;

/** Create a fresh DB bound to `path` (":memory:" for tests). */
export function createDb(path: string): DaylightDb {
  return new DaylightDb(openConnection(path));
}

/** Process-wide default DB, opened lazily from DAYLIGHT_DB_PATH. */
export function getDb(): DaylightDb {
  if (!_default) _default = createDb(resolveDbPath());
  return _default;
}

/** Override the default (used by tests + the worker to bind an explicit path). */
export function setDefaultDb(db: DaylightDb): void {
  _default = db;
}

export const upsertDomain = (rec: DomainRecord, seenAt: string): void =>
  getDb().upsertDomain(rec, seenAt);
export const getDomain = (name: string): DomainRow | null => getDb().getDomain(name);
export const searchDomains = (f?: SearchFilter): DomainRow[] => getDb().searchDomains(f);
export const insertObservation = (obs: Observation) => getDb().insertObservation(obs);
export const latestObservation = (m: string, d: string): ObservationRow | null =>
  getDb().latestObservation(m, d);
export const insertChange = (c: Change): number => getDb().insertChange(c);
export const listChanges = (f?: ChangeFilter): ChangeRow[] => getDb().listChanges(f);
export const domainHistory = (name: string): ChangeRow[] => getDb().domainHistory(name);
export const recordScanStart = (m: string): number => getDb().recordScanStart(m);
export const recordScanFinish = (id: number, r: ScanFinish): void =>
  getDb().recordScanFinish(id, r);
export const getStatus = (): ScanRow[] => getDb().getStatus();
