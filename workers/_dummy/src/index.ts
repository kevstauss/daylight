// Phase 0 walking-skeleton prover. Writes one observation + one change so the full
// path (observation → change → live feed → /status) is exercised end-to-end before any
// real module exists. The Phase 0-1 spec §3.7 says: delete/disable once Ledger lands.

import { nowIso, sha256, type Change, type Observation } from "@daylight/core";
import { createDb, resolveDbPath } from "@daylight/db";

const DEMO_DOMAIN = "skeleton-demo";

function main(): void {
  const db = createDb(resolveDbPath());
  const scanId = db.recordScanStart("ledger");
  try {
    const now = nowIso();
    const payload = { note: "Daylight walking skeleton probe", phase: 0 };
    const obs: Observation = {
      module: "ledger",
      domain: DEMO_DOMAIN,
      observedAt: now,
      sourceUrl: "https://github.com/cisagov/dotgov-data (walking skeleton — no real diff yet)",
      contentHash: sha256(JSON.stringify(payload)),
      payload,
    };
    const { inserted } = db.insertObservation(obs);

    // Emit the demo change only once, so repeated runs stay idempotent.
    const alreadyEmitted = db.domainHistory(DEMO_DOMAIN).length > 0;
    if (!alreadyEmitted) {
      const change: Change = {
        module: "ledger",
        domain: DEMO_DOMAIN,
        detectedAt: now,
        kind: "added",
        severity: "info",
        reason:
          "Walking skeleton is live — a demo change proving the observation → change → feed path. It is removed when Ledger lands.",
      };
      db.insertChange(change);
    }

    db.recordScanFinish(scanId, {
      ok: true,
      itemsSeen: 1,
      changesEmitted: alreadyEmitted ? 0 : 1,
    });
    // eslint-disable-next-line no-console
    console.log(
      `[dummy] ok — observation inserted=${inserted}, change emitted=${!alreadyEmitted}`,
    );
  } catch (err) {
    db.recordScanFinish(scanId, {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      itemsSeen: 0,
      changesEmitted: 0,
    });
    throw err;
  } finally {
    db.close();
  }
}

main();
