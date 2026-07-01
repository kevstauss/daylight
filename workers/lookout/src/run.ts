import type { Change, Watchlist } from "@daylight/core";
import { nowIso, sha256 } from "@daylight/core";
import type { DaylightDb } from "@daylight/db";
import { ownerForApex, ownerLabel } from "@daylight/enrich";
import type { CertRecord } from "./crtsh.js";
import { registrableApex, normalizeFqdn } from "./labels.js";
import { scoreSubdomain } from "./scoring.js";

export interface RunLookoutOptions {
  db: DaylightDb;
  watchlist: Watchlist;
  certs: CertRecord[];
  now?: string;
  /** Also process apexes outside the watchlist (FLAG_LOOKOUT_ALL_GOV). */
  allGov?: boolean;
}

export interface RunLookoutResult {
  ok: boolean;
  error?: string;
  certsSeen: number;
  subdomainsAdded: number;
  changeIds: number[];
}

const CT_SOURCE = "https://crt.sh/";

/**
 * Backfill pipeline (spec §4): for each cert, record the observation and, for every
 * never-before-seen SAN under a watched apex, insert the subdomain, score it, enrich it
 * with the Ledger owner, and emit an `added` change. Idempotent by fqdn / cert hash.
 */
export function runLookoutBackfill(opts: RunLookoutOptions): RunLookoutResult {
  const { db, watchlist, certs } = opts;
  const now = opts.now ?? nowIso();
  const scanId = db.recordScanStart("lookout");

  try {
    const out = db.sql.transaction((): { subdomainsAdded: number; changeIds: number[] } => {
      let subdomainsAdded = 0;
      const changeIds: number[] = [];

      for (const cert of certs) {
        const certApex = registrableApex(normalizeFqdn(cert.commonName || cert.sans[0] || ""));
        // Record the cert observation (idempotent by cert hash).
        db.insertObservation({
          module: "lookout",
          domain: certApex,
          observedAt: now,
          sourceUrl: CT_SOURCE,
          contentHash: sha256(cert.certSha256),
          payload: {
            common_name: cert.commonName,
            san_list: cert.sans,
            issuer: cert.issuer,
            not_before: cert.notBefore,
            not_after: cert.notAfter,
            cert_sha256: cert.certSha256,
            log_source: cert.logSource,
          },
        });

        for (const rawSan of cert.sans) {
          const fqdn = normalizeFqdn(rawSan);
          if (!fqdn) continue;
          const apex = registrableApex(fqdn);
          if (fqdn === apex) continue; // the apex itself is Ledger's beat, not a subdomain
          const onWatch = watchlist.apexDomains.includes(apex) || watchlist.subdomainApexes.includes(apex);
          if (!onWatch && !opts.allGov) continue;

          const owner = ownerForApex(db, apex);
          const score = scoreSubdomain(fqdn, watchlist, ownerLabel(owner));
          const up = db.upsertSubdomain(
            {
              fqdn,
              apex,
              labels: score.labels,
              flagSeverity: score.severity,
              flagReason: score.reason,
              apexOwnerOrg: owner?.org ?? null,
              apexOwnerSuborg: owner?.suborg ?? null,
            },
            now,
          );
          if (!up.inserted) continue;

          const change: Change = {
            module: "lookout",
            domain: apex,
            detectedAt: now,
            kind: "added",
            severity: score.severity,
            reason: `new subdomain ${fqdn} — ${score.reason}`,
          };
          changeIds.push(db.insertChange(change));
          subdomainsAdded++;
        }
      }
      return { subdomainsAdded, changeIds };
    })();

    db.recordScanFinish(scanId, {
      ok: true,
      itemsSeen: certs.length,
      changesEmitted: out.changeIds.length,
    });
    return { ok: true, certsSeen: certs.length, ...out };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    db.recordScanFinish(scanId, { ok: false, error, itemsSeen: 0, changesEmitted: 0 });
    return { ok: false, error, certsSeen: 0, subdomainsAdded: 0, changeIds: [] };
  }
}
