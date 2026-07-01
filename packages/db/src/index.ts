import type { Change, DomainRecord, Observation } from "@daylight/core";
import { nowIso } from "@daylight/core";
import { openConnection, resolveDbPath, type Sqlite } from "./client.js";
import type {
  AlertRow,
  ChangeRow,
  DomainRow,
  ObservationRow,
  ScanRow,
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
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const limit = Math.max(1, Math.min(f.limit ?? 100, 1000));
    return this.sql
      .prepare(
        `SELECT * FROM changes ${where} ORDER BY detected_at DESC, id DESC LIMIT ${limit}`,
      )
      .all(params) as ChangeRow[];
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

  close(): void {
    this.sql.close();
  }
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
