import type { Change, DomainRecord, Watchlist, WatchSubscription } from "@daylight/core";
import { nowIso, sha256, watchSubscriptions } from "@daylight/core";
import { type DaylightDb, rowToDomainRecord } from "@daylight/db";
import { redact } from "@daylight/redact";
import { EXPECTED_HEADER } from "./csv.js";
import { diff } from "./diff.js";
import { resolveChange } from "./emit.js";
import { CONCENTRATION_SENTINEL, contactConcentration, type OrgResolver } from "./heuristics.js";
import { canonicalHash, normalizeCsv, recordsToMap } from "./normalize.js";
import { DEFAULT_SOURCE_URL, fetchCsv } from "./fetch.js";

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

    // §6.1 — verify the header before diffing; fail loudly to /status on drift and skip
    // the diff (no state written) rather than silently mis-mapping.
    if (!parsed.headerOk) {
      const error = `CISA CSV header drift — expected [${EXPECTED_HEADER.join(
        ", ",
      )}], got [${parsed.header.join(", ")}]. Skipped diff.`;
      db.recordScanFinish(scanId, { ok: false, error, itemsSeen: 0, changesEmitted: 0 });
      return blank({ ok: false, error, headerOk: false });
    }

    const records = parsed.records;
    const itemsSeen = records.length;
    const fileHash = sha256(records.map(canonicalHash).sort().join("\n"));

    // All DB writes happen atomically: the whole-file sentinel is only durable once the
    // changes/alerts are, so an interrupted run rolls back and is re-processable.
    const out = db.sql.transaction((): Omit<RunLedgerResult, "ok" | "headerOk" | "itemsSeen"> => {
      const sentinel = db.insertObservation({
        module: "ledger",
        domain: FILE_SENTINEL,
        observedAt: now,
        sourceUrl,
        contentHash: fileHash,
        payload: { rows: itemsSeen },
      });
      if (!sentinel.inserted) {
        return { shortCircuited: true, changesEmitted: 0, alertsFired: 0, changeIds: [] };
      }

      // Previous state = the domains table BEFORE this run's writes. The table is kept
      // equal to the last snapshot (removed domains are deleted below), so `removed` is
      // computed against the prior snapshot, not the cumulative all-time set.
      const previous = new Map<string, DomainRecord>();
      for (const row of db.allDomains()) previous.set(row.domain, rowToDomainRecord(row));
      const current = recordsToMap(records);
      const rawChanges = diff(previous, current, now);
      const orgOf: OrgResolver = (d) =>
        current.get(d)?.org ?? previous.get(d)?.org ?? null;

      // Persist current state through the redact seam (pass-through for public CSV data;
      // withhold anything flagged from the servable store — never happens for this source).
      for (const rec of records) {
        const red = redact(rec);
        if (red.flagged) continue;
        db.upsertDomain(red.value, now);
        db.insertObservation({
          module: "ledger",
          domain: rec.domain,
          observedAt: now,
          sourceUrl,
          contentHash: canonicalHash(red.value),
          payload: red.value,
        });
      }
      // Reconcile removals: drop domains absent from the current snapshot so a `removed`
      // event fires exactly once. History is preserved in the changes table.
      for (const domain of previous.keys()) {
        if (!current.has(domain)) db.deleteDomain(domain);
      }

      let changesEmitted = 0;
      let alertsFired = 0;
      const changeIds: number[] = [];

      if (emit) {
        for (const raw of rawChanges) {
          // 'removed' has no CURRENT record; classify against its PREVIOUS row so H5 + watches can
          // weigh the removal (org/apex/contact live only in prior state).
          const rec = current.get(raw.domain) ?? previous.get(raw.domain);
          const { change, hits } = rec
            ? resolveChange(raw, rec, watchlist, orgOf, subs)
            : { change: raw, hits: [] as WatchSubscription[] };
          const id = db.insertChange({ ...change, sourceUrl });
          changeIds.push(id);
          changesEmitted++;

          for (const s of hits) {
            db.insertAlert({
              changeId: id,
              subscriptionPattern: s.pattern,
              channel: s.channel ?? "feed",
              target: s.target ?? null,
            });
            alertsFired++;
          }
        }

        // Cross-record CONTACT CONCENTRATION pass (H9): one foreign, non-allowlisted contact apex
        // serving ≥3 distinct orgs. Idempotent — an observation keyed by the exact org set gates
        // re-emission, so a stable concentration is reported once, not on every daily run.
        for (const cluster of contactConcentration(records, watchlist)) {
          const concHash = sha256(
            JSON.stringify(["ledger-concentration", cluster.contactApex, [...cluster.orgs].sort()]),
          );
          const seen = db.insertObservation({
            module: "ledger",
            domain: `${CONCENTRATION_SENTINEL}${cluster.contactApex}`,
            observedAt: now,
            sourceUrl,
            contentHash: concHash,
            payload: { orgs: cluster.orgs, domains: cluster.domains },
          });
          if (!seen.inserted) continue; // this exact concentration already reported
          const shown = cluster.domains.slice(0, 6).join(", ");
          const more = cluster.domains.length > 6 ? ", …" : "";
          const id = db.insertChange({
            module: "ledger",
            domain: cluster.contactApex,
            detectedAt: now,
            kind: "modified",
            field: "securityContactConcentration",
            severity: "high",
            reason: `security contact @${cluster.contactApex} is foreign to ${cluster.orgs.length} organizations it is the contact of record for (${shown}${more})`,
            sourceUrl,
          });
          changeIds.push(id);
          changesEmitted++;
        }
      }

      return { shortCircuited: false, changesEmitted, alertsFired, changeIds };
    })();

    db.recordScanFinish(scanId, { ok: true, itemsSeen, changesEmitted: out.changesEmitted });
    return { ok: true, headerOk: true, itemsSeen, ...out };
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
