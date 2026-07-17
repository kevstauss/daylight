import { nowIso } from "@daylight/core";
import type { DaylightDb } from "@daylight/db";
import { indexColumns, missingColumns, parseCsv } from "./csv.js";
import { isBenignThirdParty, parseRow, scanContentHash, type SiteScanRecord } from "./parse.js";
import { DEFAULT_SOURCE_URL, fetchSiteScanCsv } from "./fetch.js";

export interface RunSiteScanOptions {
  db: DaylightDb;
  /** Provide CSV text directly (tests / a saved dump); otherwise the bulk dump is fetched. */
  csvText?: string;
  sourceUrl?: string;
  apiKey?: string;
  now?: string;
  /** Set false to seed a silent baseline: populate site_scans WITHOUT queuing any promotion. */
  emitChanges?: boolean;
}

export interface RunSiteScanResult {
  ok: boolean;
  error?: string;
  headerOk: boolean;
  /** Rows read from the dump (before deduping the same URL scanned more than once). */
  itemsSeen: number;
  /** Distinct URLs whose merged scan payload differed from what we already held. */
  changed: number;
  /** .gov apexes newly queued for a Floodlight pass this run. */
  promoted: number;
}

/** Prior-run state for one URL, read from the table BEFORE this run writes anything. */
interface PriorScan {
  status: string | null;
  ga: string | null;
  third: Set<string>;
}

/** Would this newly-appeared signal be worth a full Floodlight look? Only when the CURRENT merged
 *  scan completed AND we have a PRIOR completed scan to establish absence against — a timeout is not
 *  an absence, so we never read a failed/first scan as "this just appeared" (the settled-both-sides
 *  rule already in Floodlight/Receipts). Returns the human reason, or null. */
function promotionReason(record: SiteScanRecord, prior: PriorScan | null): string | null {
  if (record.primaryScanStatus !== "completed") return null;
  if (!prior || prior.status !== "completed") return null;

  const newThird = record.thirdPartyDomains.filter(
    (h) => !prior.third.has(h) && !isBenignThirdParty(h),
  );
  if (newThird.length > 0) {
    return `GSA Site Scanning: new third party ${newThird.slice(0, 3).join(", ")}${
      newThird.length > 3 ? ", …" : ""
    } on ${record.url}`;
  }
  // A site's OWN Google Analytics appearing is worth a look — but ONLY when GSA explicitly reports
  // dap=false. A blank/unknown dap could be the government-wide DAP tag, which is expected, so we
  // stay conservative and don't promote on it.
  if (record.dap === false && record.gaTagId && record.gaTagId !== (prior.ga ?? null)) {
    return `GSA Site Scanning: new Google Analytics tag ${record.gaTagId} on ${record.url}`;
  }
  return null;
}

/**
 * Collapse the day's rows to ONE canonical record per URL. GSA's dump scans the same final URL more
 * than once (different initial URLs redirect to it), and those scans report slightly different
 * third-party sets. Diffing each raw row against the live table would compare a later duplicate
 * against an earlier one from the SAME run and invent phantom "new tracker" promotions — so we union
 * the day's third parties per URL, treat the URL as completed if ANY scan completed, and diff that
 * one canonical record against the prior run.
 */
function mergeByUrl(records: SiteScanRecord[]): SiteScanRecord[] {
  const merged = new Map<string, { rec: SiteScanRecord; third: Set<string> }>();
  for (const rec of records) {
    const ex = merged.get(rec.url);
    if (!ex) {
      merged.set(rec.url, { rec: { ...rec }, third: new Set(rec.thirdPartyDomains) });
      continue;
    }
    for (const h of rec.thirdPartyDomains) ex.third.add(h);
    if (rec.primaryScanStatus === "completed") ex.rec.primaryScanStatus = "completed";
    // dap tri-state merge: a positive detection in any scan wins; an explicit negative fills an
    // as-yet-unknown value, but never overrides a positive.
    if (rec.dap === true) ex.rec.dap = true;
    else if (rec.dap === false && ex.rec.dap === null) ex.rec.dap = false;
    if (!ex.rec.gaTagId && rec.gaTagId) ex.rec.gaTagId = rec.gaTagId;
    if (rec.scannedAt > ex.rec.scannedAt) ex.rec.scannedAt = rec.scannedAt;
  }
  const out: SiteScanRecord[] = [];
  for (const { rec, third } of merged.values()) {
    rec.thirdPartyDomains = [...third].sort();
    rec.thirdPartyCount = third.size;
    out.push(rec);
  }
  return out;
}

/**
 * One Site-Scanning pass: download GSA's daily federal-web scan, diff it (per URL, against a
 * snapshot of the prior run) and QUEUE (never trust) unwatched .gov apexes for a full Floodlight
 * pass when a new non-benign third party appears. Writes NO public changes — this is breadth
 * infrastructure that feeds Floodlight. Every write is transactional; the header guard fails loud to
 * /status on schema drift rather than mis-mapping GSA's wide, evolving CSV.
 *
 * GSA's dump is a public structured dataset of hostnames + tag ids + status enums — no free text and
 * no PII — so it needs no redactText scrub (mirrors Ledger treating the CISA CSV as public data).
 */
export async function runSiteScan(opts: RunSiteScanOptions): Promise<RunSiteScanResult> {
  const { db } = opts;
  const now = opts.now ?? nowIso();
  const emit = opts.emitChanges !== false;
  const sourceUrl = opts.sourceUrl ?? DEFAULT_SOURCE_URL;
  const scanId = db.recordScanStart("sitescanning");

  try {
    const csvText = opts.csvText ?? (await fetchSiteScanCsv(sourceUrl, { apiKey: opts.apiKey }));
    const { header, rows } = parseCsv(csvText);
    const idx = indexColumns(header);
    if (!idx) {
      const error = `GSA Site Scanning CSV drift — missing required column(s): [${missingColumns(
        header,
      ).join(", ")}]. Skipped ingest (no state written).`;
      db.recordScanFinish(scanId, { ok: false, error, itemsSeen: 0, changesEmitted: 0 });
      return { ok: false, error, headerOk: false, itemsSeen: 0, changed: 0, promoted: 0 };
    }

    const records: SiteScanRecord[] = [];
    for (const cols of rows) {
      const rec = parseRow(cols, idx);
      if (rec) records.push(rec);
    }
    const itemsSeen = records.length;
    const current = mergeByUrl(records);

    const out = db.sql.transaction((): { changed: number; promoted: number } => {
      // Prior state = the table BEFORE this run's writes, so a diff never compares against a row
      // this same run just upserted (the phantom-promotion trap).
      const prior = new Map<string, PriorScan>();
      for (const row of db.allSiteScans()) {
        let third: string[] = [];
        try {
          const v = JSON.parse(row.third_party_domains_json ?? "[]");
          if (Array.isArray(v)) third = v.map((x) => String(x).toLowerCase());
        } catch {
          third = [];
        }
        prior.set(row.url, { status: row.primary_scan_status, ga: row.ga_tag_id, third: new Set(third) });
      }

      let changed = 0;
      const promotedApexes = new Set<string>(); // one apex may have several flagged URLs — count once
      for (const rec of current) {
        if (emit && !promotedApexes.has(rec.domain)) {
          const reason = promotionReason(rec, prior.get(rec.url) ?? null);
          if (reason) {
            db.enqueuePromotion({ domain: rec.domain, reason, sourceUrl }, now);
            promotedApexes.add(rec.domain);
          }
        }
        const res = db.upsertSiteScan(
          {
            url: rec.url,
            domain: rec.domain,
            scannedAt: rec.scannedAt || now,
            sourceUrl,
            primaryScanStatus: rec.primaryScanStatus,
            dap: rec.dap,
            gaTagId: rec.gaTagId,
            thirdPartyDomains: rec.thirdPartyDomains,
            thirdPartyCount: rec.thirdPartyCount,
            contentHash: scanContentHash(rec),
          },
          now,
        );
        if (res.changed) changed++;
      }
      return { changed, promoted: promotedApexes.size };
    })();

    db.recordScanFinish(scanId, { ok: true, itemsSeen, changesEmitted: out.promoted });
    return { ok: true, headerOk: true, itemsSeen, ...out };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    db.recordScanFinish(scanId, { ok: false, error, itemsSeen: 0, changesEmitted: 0 });
    return { ok: false, error, headerOk: true, itemsSeen: 0, changed: 0, promoted: 0 };
  }
}
