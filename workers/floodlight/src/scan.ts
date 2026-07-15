import type { Change } from "@daylight/core";
import { nowIso, sha256 } from "@daylight/core";
import type { DaylightDb } from "@daylight/db";
import { redactText } from "@daylight/redact";
import { analyzeCapture, trackerKey } from "./analyze.js";
import type { PageCapture, Scorecard, Tracker } from "./types.js";

export interface RunFloodlightResult {
  scorecard: Scorecard;
  changeIds: number[];
  added: string[];
  removed: string[];
}

const rt = (s: string): string => redactText(s).value;

/**
 * Analyze a capture, persist the scorecard + a redacted raw observation, and diff trackers
 * vs the previous scan to emit added/removed change events (Receipts consumes these in
 * Phase 4). All page-derived text passes through the redact seam before persistence.
 */
export interface FloodlightScanOptions {
  now?: string;
  /**
   * Did the page finish loading before it was inventoried? Absence is only evidence when it did.
   *
   * Same defect Receipts had: a capture that timed out waiting for the page to go quiet has a
   * partial request log, so a tracker it "didn't see" may simply not have fired. Diffing that
   * against a complete scan publishes the race — "sba.gov added Microsoft Clarity@c.clarity.ms",
   * then t., then scripts., forever. Undefined means unknown, which is treated as unsettled.
   */
  settled?: boolean;
}

export function runFloodlightScan(
  db: DaylightDb,
  capture: PageCapture,
  opts: FloodlightScanOptions | string = {},
): RunFloodlightResult {
  // Back-compat: this used to take `now` positionally.
  const o: FloodlightScanOptions = typeof opts === "string" ? { now: opts } : opts;
  const scannedAt = o.now ?? nowIso();
  const scorecard = analyzeCapture(capture);
  // A scan can only testify to what it saw. Without a settled load, "gone" means "not yet".
  const absenceIsMeaningful = o.settled === true;

  // Redact the page URL ONCE and use it everywhere the URL is stored or shown — the scorecard
  // row (its PK), the observation, the content hash, and change reasons. A scanned URL can
  // carry PII in its query string (?email=…); nothing public may show it un-redacted. redactText
  // is idempotent for a clean URL, so the scorecard key stays stable across rescans.
  const redactedUrl = rt(scorecard.url);

  const redactedTrackers: Tracker[] = scorecard.trackers.map((t) => ({
    ...t,
    host: rt(t.host),
    path: rt(t.path),
  }));
  const redactedReasons = scorecard.reasons.map(rt);
  const redactedCapture = {
    url: rt(capture.url),
    requests: capture.requests.map((r) => ({
      ...r,
      url: rt(r.url),
      postBody: r.postBody === undefined ? undefined : rt(r.postBody),
    })),
    dom: capture.dom,
  };

  const scanId = db.recordScanStart("floodlight");
  const changeIds: number[] = [];
  const added: string[] = [];
  const removed: string[] = [];

  try {
    db.sql.transaction(() => {
      const prev = db.getScorecard(redactedUrl);
      const prevTrackers: Tracker[] = prev?.trackers_json
        ? (JSON.parse(prev.trackers_json) as Tracker[])
        : [];
      const prevKeys = new Set(prevTrackers.map(trackerKey));
      const currKeys = new Set(scorecard.trackers.map(trackerKey));

      const contentHash = sha256(
        JSON.stringify([
          redactedUrl,
          [...currKeys].sort(),
          scorecard.sessionReplay,
          scorecard.firstPartyProxied,
          scorecard.privacyNoticeUrl,
        ]),
      );
      db.insertObservation({
        module: "floodlight",
        domain: scorecard.domain,
        observedAt: scannedAt,
        sourceUrl: redactedUrl,
        contentHash,
        payload: redactedCapture,
      });

      const emit = (kind: Change["kind"], severity: Change["severity"], reason: string) => {
        changeIds.push(
          db.insertChange({ module: "floodlight", domain: scorecard.domain, detectedAt: scannedAt, kind, severity, reason }),
        );
      };

      for (const t of scorecard.trackers) {
        const k = trackerKey(t);
        if (!prevKeys.has(k)) {
          added.push(k);
          // "Added" rests on the PREVIOUS scan's absence — only trustworthy if that scan settled.
          if (prev && absenceIsMeaningful) {
            emit("added", t.firstPartyProxied ? "high" : "notable", `tracker added on ${redactedUrl}: ${k}`);
          }
        }
      }
      for (const k of prevKeys) {
        if (!currKeys.has(k)) {
          removed.push(k);
          // The claim is "this vendor is gone". A partial load cannot support it.
          if (absenceIsMeaningful) emit("removed", "notable", `tracker removed on ${redactedUrl}: ${k}`);
        }
      }
      if (!prev && scorecard.severity === "high") {
        emit("added", "high", `high-risk scorecard for ${redactedUrl}: ${redactedReasons.join("; ")}`);
      }

      db.upsertScorecard(
        {
          url: redactedUrl,
          domain: scorecard.domain,
          trackerCount: scorecard.trackerCount,
          sessionReplay: scorecard.sessionReplay,
          firstPartyProxied: scorecard.firstPartyProxied,
          privacyNoticeUrl: scorecard.privacyNoticeUrl,
          // Normalized PII kinds (e.g. 'ssn','photo') — not raw PII, so no redaction needed. Persisted
          // so Redtape can see a form collecting sensitive PII even when tracking is light.
          formFieldsJson: JSON.stringify(scorecard.formFields),
          requestCount: scorecard.requestCount,
          engineVersion: scorecard.engineVersion,
          severity: scorecard.severity,
          trackersJson: JSON.stringify(redactedTrackers),
          reasonsJson: JSON.stringify(redactedReasons),
        },
        scannedAt,
      );
    })();

    db.recordScanFinish(scanId, {
      ok: true,
      itemsSeen: capture.requests.length,
      changesEmitted: changeIds.length,
    });
  } catch (err) {
    db.recordScanFinish(scanId, {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      itemsSeen: 0,
      changesEmitted: 0,
    });
    throw err;
  }

  return {
    scorecard: { ...scorecard, url: redactedUrl, trackers: redactedTrackers, reasons: redactedReasons },
    changeIds,
    added,
    removed,
  };
}
