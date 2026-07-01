import type { Change, DomainRecord, Watchlist, WatchSubscription } from "@daylight/core";
import { nowIso, sha256, watchSubscriptions } from "@daylight/core";
import { type DaylightDb, rowToDomainRecord } from "@daylight/db";
import { EXPECTED_HEADER } from "./csv.js";
import { diff } from "./diff.js";
import { classifyChange, type OrgResolver } from "./heuristics.js";
import { canonicalHash, normalizeCsv, recordsToMap } from "./normalize.js";
import { DEFAULT_SOURCE_URL, fetchCsv } from "./fetch.js";
import { evaluateWatches } from "./watches.js";

// Sentinel "domain" used only to store the whole-file hash as an observation, so the
// run-level short-circuit costs no schema change and reuses observation idempotency.
export const FILE_SENTINEL = "__ledger_file__";

export interface RunLedgerOptions {
  db: DaylightDb;
  watchlist: Watchlist;
  /** Provide CSV text directly (tests, seed-from-file); otherwise fetched. */
  csvText?: string;
  sourceUrl?: string;
  now?: string;
  /** Set false to seed a silent baseline (populate state without emitting changes/alerts). */
  emitChanges?: boolean;
  /** Override subscriptions; defaults to those derived from the watchlist. */
  subscriptions?: WatchSubscription[];
}

export interface RunLedgerResult {
  ok: boolean;
  error?: string;
  headerOk: boolean;
  shortCircuited: boolean;
  itemsSeen: number;
  changesEmitted: number;
  alertsFired: number;
  changeIds: number[];
}

export async function runLedger(opts: RunLedgerOptions): Promise<RunLedgerResult> {
  const { db, watchlist } = opts;
  const now = opts.now ?? nowIso();
  const emit = opts.emitChanges !== false;
  const sourceUrl = opts.sourceUrl ?? DEFAULT_SOURCE_URL;
  const subs = opts.subscriptions ?? watchSubscriptions(watchlist);
  const scanId = db.recordScanStart("ledger");

  try {
    const csvText = opts.csvText ?? (await fetchCsv(sourceUrl));
    const parsed = normalizeCsv(csvText);

    // §6.1 — verify the header before diffing; fail loudly to /status on drift.
    if (!parsed.headerOk) {
      const error = `CISA CSV header drift — expected [${EXPECTED_HEADER.join(
        ", ",
      )}], got [${parsed.header.join(", ")}]. Skipped diff.`;
      db.recordScanFinish(scanId, { ok: false, error, itemsSeen: 0, changesEmitted: 0 });
      return blank({ ok: false, error, headerOk: false });
    }

    const records = parsed.records;
    const itemsSeen = records.length;

    // Whole-file short-circuit: if we've already processed this exact file, do nothing.
    const fileHash = sha256(records.map(canonicalHash).sort().join("\n"));
    const sentinel = db.insertObservation({
      module: "ledger",
      domain: FILE_SENTINEL,
      observedAt: now,
      sourceUrl,
      contentHash: fileHash,
      payload: { rows: itemsSeen },
    });
    if (!sentinel.inserted) {
      db.recordScanFinish(scanId, { ok: true, itemsSeen, changesEmitted: 0 });
      return { ...blank({ ok: true, headerOk: true }), shortCircuited: true, itemsSeen };
    }

    // Previous state = the domains table BEFORE this run's upserts.
    const previous = new Map<string, DomainRecord>();
    for (const row of db.allDomains()) previous.set(row.domain, rowToDomainRecord(row));
    const current = recordsToMap(records);
    const rawChanges = diff(previous, current, now);

    // Org resolver for H1 same-org clearing: prefer this file's view, fall back to prior.
    const orgOf: OrgResolver = (domain) =>
      current.get(domain)?.org ?? previous.get(domain)?.org ?? null;

    // Persist current state (idempotent per row via content_hash).
    for (const rec of records) {
      db.upsertDomain(rec, now);
      db.insertObservation({
        module: "ledger",
        domain: rec.domain,
        observedAt: now,
        sourceUrl,
        contentHash: canonicalHash(rec),
        payload: rec,
      });
    }

    let changesEmitted = 0;
    let alertsFired = 0;
    const changeIds: number[] = [];

    if (emit) {
      for (const raw of rawChanges) {
        const rec = current.get(raw.domain);
        const { severity, reason } = rec
          ? classifyChange(raw, rec, watchlist, orgOf)
          : { severity: raw.severity, reason: raw.reason };
        const change: Change = { ...raw, severity, reason: reason ?? raw.reason };
        const id = db.insertChange(change);
        changeIds.push(id);
        changesEmitted++;

        if (rec) {
          for (const s of evaluateWatches(change, rec, subs)) {
            db.insertAlert({
              changeId: id,
              subscriptionPattern: s.pattern,
              channel: s.channel ?? "feed",
              target: s.target ?? null,
            });
            alertsFired++;
          }
        }
      }
    }

    db.recordScanFinish(scanId, { ok: true, itemsSeen, changesEmitted });
    return {
      ok: true,
      headerOk: true,
      shortCircuited: false,
      itemsSeen,
      changesEmitted,
      alertsFired,
      changeIds,
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    db.recordScanFinish(scanId, { ok: false, error, itemsSeen: 0, changesEmitted: 0 });
    return blank({ ok: false, error, headerOk: true });
  }
}

function blank(over: Partial<RunLedgerResult> & { ok: boolean }): RunLedgerResult {
  return {
    ok: over.ok,
    error: over.error,
    headerOk: over.headerOk ?? true,
    shortCircuited: over.shortCircuited ?? false,
    itemsSeen: over.itemsSeen ?? 0,
    changesEmitted: over.changesEmitted ?? 0,
    alertsFired: over.alertsFired ?? 0,
    changeIds: over.changeIds ?? [],
  };
}
