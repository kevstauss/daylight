// Foundry run — joins Lookout's already-ingested CT subdomains with Ledger's registry to produce,
// per build vendor, a build-concentration index and an unlaunched-project watch. Adds no new data
// source: it reads the `subdomains` and `domains` tables both modules already populate.

import type { Change } from "@daylight/core";
import { sha256 } from "@daylight/core";
import type { DaylightDb } from "@daylight/db";
import {
  attributeProjects,
  buildConcentrationIndex,
  registrableApex,
  unlaunchedProjectWatch,
  type ConcentrationEntry,
  type RegistryView,
  type UnlaunchedProject,
} from "./attribute.js";

export interface VendorReport {
  vendorApex: string;
  ownerLabel: string | null;
  /** Distinct registered agencies whose projects stage through this vendor. */
  agencyCount: number;
  index: ConcentrationEntry[];
  unlaunched: UnlaunchedProject[];
  projectCount: number;
}

export interface FoundryReport {
  vendors: VendorReport[];
  generatedAt: string;
}

/** A vendor is an apex whose build tree stages projects for at least this many DISTINCT registered
 *  target apexes other than itself — i.e. it builds for more than one property. */
const VENDOR_MIN_TARGETS = 2;

/** Build a registry view over the current `domains` snapshot. */
export function registryViewFromDb(db: DaylightDb): RegistryView {
  const rows = db.allDomains();
  const owners = new Map<string, { org: string | null; suborg: string | null }>();
  for (const r of rows) owners.set(r.domain.toLowerCase(), { org: r.org ?? null, suborg: r.suborg ?? null });
  return {
    has: (apex) => owners.has(apex.toLowerCase()),
    ownerOf: (apex) => owners.get(apex.toLowerCase()) ?? null,
  };
}

const ownerLabelOf = (o: { org: string | null; suborg: string | null } | null): string | null => {
  if (!o) return null;
  const parts = [o.org, o.suborg].filter((s): s is string => !!s && s.trim().length > 0);
  return parts.length ? parts.join(" / ") : null;
};

/**
 * Compute the Foundry report over whatever CT subdomains + registry rows the DB currently holds.
 * Vendor apexes are detected structurally (an apex that stages ≥2 distinct registered target
 * apexes), so no vendor is hard-coded — the NDS cluster surfaces on its own, and any future vendor
 * would too.
 */
export function runFoundry(db: DaylightDb, now: string): FoundryReport {
  const registry = registryViewFromDb(db);
  const subs = db.allSubdomains();

  // Group hosts by their registrable apex (the vendor-tree root).
  const byApex = new Map<string, string[]>();
  for (const s of subs) {
    const apex = s.apex?.toLowerCase() || registrableApex(s.fqdn);
    if (!apex.endsWith(".gov")) continue;
    (byApex.get(apex) ?? byApex.set(apex, []).get(apex)!).push(s.fqdn.toLowerCase());
  }

  const vendors: VendorReport[] = [];
  for (const [apex, hosts] of byApex) {
    const projects = attributeProjects(hosts, apex, registry);
    const targets = new Set(
      projects.map((p) => p.resolvedApex).filter((a): a is string => !!a && a !== apex),
    );
    const unlaunched = unlaunchedProjectWatch(projects);
    // A vendor either builds for ≥2 registered targets, or stages ≥2 as-yet-unregistered projects.
    if (targets.size < VENDOR_MIN_TARGETS && unlaunched.length < VENDOR_MIN_TARGETS) continue;

    const index = buildConcentrationIndex(projects);
    vendors.push({
      vendorApex: apex,
      ownerLabel: ownerLabelOf(registry.ownerOf(apex)),
      agencyCount: index.length,
      index,
      unlaunched,
      projectCount: projects.length,
    });
  }

  vendors.sort((a, b) => b.agencyCount - a.agencyCount || b.projectCount - a.projectCount);
  return { vendors, generatedAt: now };
}

const FOUNDRY_SOURCE = "https://crt.sh/";

export interface FoundryScanResult {
  report: FoundryReport;
  changesEmitted: number;
}

/**
 * Scheduled Foundry pass (the cron entry point). Computes the report over the already-ingested
 * CT + registry tables, records a `/status` scan like every other module, and emits ONE `added`
 * change the first time each unlaunched project is seen — idempotent via an `INSERT OR IGNORE`
 * observation keyed by (vendor, project), so a daily re-run never re-floods the feed. Existence-only:
 * it writes only derived facts, and never connects to any discovered host. The concentration index
 * is not emitted as a change (it would re-fire every run); it is read live on `/foundry`.
 */
export function runFoundryScan(db: DaylightDb, now: string): FoundryScanResult {
  const scanId = db.recordScanStart("foundry");
  try {
    const report = runFoundry(db, now);
    let changesEmitted = 0;
    db.sql.transaction(() => {
      for (const v of report.vendors) {
        for (const u of v.unlaunched) {
          const key = `foundry:unlaunched:${v.vendorApex}:${u.project}`;
          const target = u.candidateApexes[0] ?? `${u.project}.gov`;
          const obs = db.insertObservation({
            module: "foundry",
            domain: v.vendorApex,
            observedAt: now,
            sourceUrl: FOUNDRY_SOURCE,
            contentHash: sha256(key),
            payload: { project: u.project, candidate_apex: target, hosts: u.hosts, env_tiers: u.envTiers, confidence: u.confidence },
          });
          if (!obs.inserted) continue; // already seen — don't re-emit
          const change: Change = {
            module: "foundry",
            domain: target,
            detectedAt: now,
            kind: "added",
            severity: "notable",
            reason: `unlaunched project "${u.project}" building on ${v.vendorApex} — no ${target} registered yet${u.confidence === "low" ? " (low-confidence attribution)" : ""}`,
          };
          db.insertChange(change);
          changesEmitted++;
        }
      }
    })();
    db.recordScanFinish(scanId, { ok: true, itemsSeen: report.vendors.reduce((n, v) => n + v.projectCount, 0), changesEmitted });
    return { report, changesEmitted };
  } catch (err) {
    db.recordScanFinish(scanId, { ok: false, error: err instanceof Error ? err.message : String(err), itemsSeen: 0, changesEmitted: 0 });
    throw err;
  }
}
