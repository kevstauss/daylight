import type { Change, DomainRecord, FlagKind, Observation } from "@daylight/core";
import { flagSqlPredicate, nowIso } from "@daylight/core";
import { openConnection, resolveDbPath, type Sqlite } from "./client.js";
import type {
  AlertRow,
  ChangeRow,
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
           (module, domain, detected_at, kind, field, old_value, new_value, severity, reason)
         VALUES (@module, @domain, @detectedAt, @kind, @field, @oldValue, @newValue, @severity, @reason)`,
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
            privacy_notice_url, request_count, engine_version, severity, trackers_json, reasons_json)
         VALUES
           (@url, @domain, @scannedAt, @trackerCount, @sessionReplay, @firstPartyProxied,
            @privacyNoticeUrl, @requestCount, @engineVersion, @severity, @trackersJson, @reasonsJson)
         ON CONFLICT(url) DO UPDATE SET
           domain = excluded.domain, scanned_at = excluded.scanned_at,
           tracker_count = excluded.tracker_count, session_replay = excluded.session_replay,
           first_party_proxied = excluded.first_party_proxied,
           privacy_notice_url = excluded.privacy_notice_url, request_count = excluded.request_count,
           engine_version = excluded.engine_version, severity = excluded.severity,
           trackers_json = excluded.trackers_json, reasons_json = excluded.reasons_json`,
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
            privacy_text_hash, form_fields_json, seal_present, wayback_url)
         VALUES
           (@url, @domain, @capturedAt, @domHash, @screenshotRef, @trackerSnapshotJson,
            @privacyTextHash, @formFieldsJson, @sealPresent, @waybackUrl)`,
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
            fact_vs_inference_notes, human_reviewed, reviewer_note, published, created_at)
         VALUES
           (@domain, @url, @collectsPiiEvidenceJson, @piaFound, @piaRefsJson, @sornFound,
            @sornRefsJson, @queriesRunJson, @sourcesCheckedJson, @gapAssessment, @confidence,
            @factVsInferenceNotes, 0, NULL, 0, @createdAt)`,
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
    return this.sql
      .prepare(
        `SELECT * FROM gaps
         WHERE human_reviewed = 1 AND published = 1
           AND queries_run_json IS NOT NULL AND queries_run_json <> '[]'
           AND sources_checked_json IS NOT NULL AND sources_checked_json <> '[]'
         ORDER BY created_at DESC, id DESC LIMIT ${n}`,
      )
      .all() as GapRow[];
  }

  /** Internal review queue — unreviewed rows (never a public path). */
  reviewQueueGaps(limit = 200): GapRow[] {
    const n = Math.max(1, Math.min(limit, 1000));
    return this.sql
      .prepare(`SELECT * FROM gaps WHERE human_reviewed = 0 ORDER BY created_at ASC LIMIT ${n}`)
      .all() as GapRow[];
  }

  /** Human review action — approve/reject + optional publish. */
  reviewGap(id: number, r: { published: boolean; reviewerNote?: string | null }): void {
    this.sql
      .prepare(
        `UPDATE gaps SET human_reviewed = 1, published = @published, reviewer_note = @note WHERE id = @id`,
      )
      .run({ id, published: r.published ? 1 : 0, note: r.reviewerNote ?? null });
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
