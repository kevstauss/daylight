import { nowIso } from "@daylight/core";
import type { DaylightDb, SnapshotRow } from "@daylight/db";
import { redactText } from "@daylight/redact";
import { diffSnapshots } from "./diff.js";
import { snapshotContentHash } from "./html.js";
import type { Snapshot } from "./types.js";
import type { WaybackSaver } from "./wayback.js";

export interface RunReceiptsOptions {
  db: DaylightDb;
  snapshot: Snapshot;
  now?: string;
  /** Injected Wayback saver (mocked in CI, opt-in in prod). Omit to skip archiving. */
  waybackSave?: WaybackSaver;
}

export interface RunReceiptsResult {
  ok: boolean;
  shortCircuited: boolean;
  snapshotId: number | null;
  changeIds: number[];
  removed: string[];
  waybackUrl: string | null;
  /** Whether this run tried to archive. Distinguishes "no archive attempted (already have one)"
   *  from "tried and failed" — only the latter is a gap worth reporting. */
  archiveAttempted: boolean;
}

function rowToSnapshot(row: SnapshotRow): Snapshot {
  return {
    url: row.url,
    domain: row.domain,
    capturedAt: row.captured_at,
    domHash: row.dom_hash ?? "",
    trackers: row.tracker_snapshot_json ? (JSON.parse(row.tracker_snapshot_json) as string[]) : [],
    privacyTextHash: row.privacy_text_hash,
    privacyText: null,
    formFields: row.form_fields_json ? (JSON.parse(row.form_fields_json) as string[]) : [],
    sealPresent: row.seal_present === 1,
    redirectTarget: row.redirect_target,
    screenshotRef: row.screenshot_ref,
    waybackUrl: row.wayback_url,
  };
}

/**
 * Snapshot a page: dedupe by content (idempotent), archive to Wayback (injected), and diff
 * vs the previous snapshot to emit change events. Removals populate the removal ledger.
 * All page-derived text passes through the redact seam before persistence.
 */
export async function runReceiptsSnapshot(opts: RunReceiptsOptions): Promise<RunReceiptsResult> {
  const { db, snapshot } = opts;
  const now = opts.now ?? snapshot.capturedAt ?? nowIso();
  const scanId = db.recordScanStart("receipts");

  try {
    const contentHash = snapshotContentHash(snapshot);
    const prevRow = db.latestSnapshot(snapshot.url);

    // Idempotent by content: an unchanged re-capture emits no change and inserts no row.
    // It DOES retry a missing archive, though — archiving fails independently of capture
    // (SPN2 slot limits, a slow origin), and without this a page whose content is stable
    // would keep short-circuiting and never get archived at all.
    if (prevRow && snapshotContentHash(rowToSnapshot(prevRow)) === contentHash) {
      const retryArchive = !prevRow.wayback_url && !!opts.waybackSave;
      let retried: string | null = null;
      if (retryArchive) {
        retried = await opts.waybackSave!(snapshot.url);
        if (retried) db.updateSnapshotWayback(prevRow.id, retried);
      }
      db.recordScanFinish(scanId, { ok: true, itemsSeen: 1, changesEmitted: 0 });
      return {
        ok: true,
        shortCircuited: true,
        snapshotId: null,
        changeIds: [],
        removed: [],
        waybackUrl: retried,
        archiveAttempted: retryArchive,
      };
    }

    const waybackUrl = opts.waybackSave ? await opts.waybackSave(snapshot.url) : null;
    const redactedPrivacy = snapshot.privacyText ? redactText(snapshot.privacyText).value : null;
    const prev = prevRow ? rowToSnapshot(prevRow) : null;

    const out = db.sql.transaction((): Omit<RunReceiptsResult, "ok" | "waybackUrl" | "archiveAttempted"> => {
      db.insertObservation({
        module: "receipts",
        domain: snapshot.domain,
        observedAt: now,
        sourceUrl: snapshot.url,
        contentHash,
        payload: { ...snapshot, privacyText: redactedPrivacy, waybackUrl },
      });
      const snapshotId = db.insertSnapshot({
        url: snapshot.url,
        domain: snapshot.domain,
        capturedAt: now,
        domHash: snapshot.domHash,
        screenshotRef: snapshot.screenshotRef,
        trackerSnapshotJson: JSON.stringify(snapshot.trackers),
        privacyTextHash: snapshot.privacyTextHash,
        formFieldsJson: JSON.stringify(snapshot.formFields),
        sealPresent: snapshot.sealPresent,
        redirectTarget: snapshot.redirectTarget,
        waybackUrl,
      });

      const changeIds: number[] = [];
      const removed: string[] = [];
      if (prev) {
        for (const ch of diffSnapshots(prev, snapshot, now)) {
          changeIds.push(db.insertChange(ch));
          if (ch.kind === "removed") removed.push(ch.reason ?? ch.field ?? "");
        }
      }
      return { shortCircuited: false, snapshotId, changeIds, removed };
    })();

    db.recordScanFinish(scanId, { ok: true, itemsSeen: 1, changesEmitted: out.changeIds.length });
    return { ok: true, waybackUrl, archiveAttempted: !!opts.waybackSave, ...out };
  } catch (err) {
    db.recordScanFinish(scanId, {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      itemsSeen: 0,
      changesEmitted: 0,
    });
    throw err;
  }
}
