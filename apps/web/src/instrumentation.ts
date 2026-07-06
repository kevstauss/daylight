// In-process schedulers. One Fly machine runs the web read-path AND the scheduled
// batch workers (Ledger daily diff, Lookout crt.sh backfill), sharing the one SQLite
// volume. Each cron activates only when its env var is set (so `pnpm dev` stays quiet).

// A type-only import (erased at build) so the browser/DB stays out of the module graph — the
// runtime `@daylight/db` is still loaded lazily inside register().
import type { DaylightDb } from "@daylight/db";

// How long a brand-new .gov registration stays in the auto-watch tier (see
// DaylightDb.recentlyAddedDomains). Override with DAYLIGHT_NEW_DOMAIN_WATCH_DAYS.
const NEW_DOMAIN_WATCH_DAYS = Number(process.env.DAYLIGHT_NEW_DOMAIN_WATCH_DAYS) || 90;

/**
 * Sweep targets = the static tiers the caller passes (curated and/or the watchlist) PLUS the
 * dynamic tier read fresh from the DB each run: brand-new .gov registrations inside the probation
 * window (auto-watched from day one) and domains kept for turning up a finding. Deduped,
 * lowercased, .gov-only. Watchlist/curated are the priority tiers; scope is not limited to them.
 */
function sweepTargets(database: DaylightDb, ...staticTiers: string[]): string[] {
  const cutoff = new Date(Date.now() - NEW_DOMAIN_WATCH_DAYS * 86_400_000).toISOString();
  const all = [
    ...staticTiers,
    ...database.recentlyAddedDomains(cutoff),
    ...database.keptWatchDomains(),
  ];
  return [...new Set(all.map((h) => h.toLowerCase()))].filter((h) => h.endsWith(".gov"));
}

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const ledgerCron = process.env.DAYLIGHT_LEDGER_CRON?.trim();
  const lookoutCron = process.env.DAYLIGHT_LOOKOUT_CRON?.trim();
  const floodlightCron = process.env.DAYLIGHT_FLOODLIGHT_CRON?.trim();
  const receiptsCron = process.env.DAYLIGHT_RECEIPTS_CRON?.trim();
  const redtapeCron = process.env.DAYLIGHT_REDTAPE_CRON?.trim();
  const foundryCron = process.env.DAYLIGHT_FOUNDRY_CRON?.trim();
  if (!ledgerCron && !lookoutCron && !floodlightCron && !receiptsCron && !redtapeCron && !foundryCron) return;

  const [{ default: cron }, core, db, ledger, lookout, floodlight, receipts, receiptsSweep, redtape, foundry, repo] =
    await Promise.all([
      import("node-cron"),
      import("@daylight/core"),
      import("@daylight/db"),
      import("@daylight/ledger"),
      import("@daylight/lookout"),
      import("@daylight/floodlight"),
      import("@daylight/receipts"),
      import("@daylight/receipts/sweep"),
      import("@daylight/redtape"),
      import("@daylight/foundry"),
      import("./lib/repoFile"),
    ]);

  const findWatchlist = (): string | null =>
    process.env.DAYLIGHT_WATCHLIST?.trim() || repo.findRepoFile("config/watchlist.yaml");

  const loadWl = (): ReturnType<typeof core.loadWatchlist> | null => {
    const p = findWatchlist();
    if (!p) {
      console.warn("[daylight] config/watchlist.yaml not found — skipping scheduled run");
      return null;
    }
    return core.loadWatchlist(p);
  };

  // ---- Ledger daily diff ----
  const runLedger = async (emitChanges: boolean): Promise<void> => {
    const wl = loadWl();
    if (!wl) return;
    const database = db.createDb(db.resolveDbPath());
    try {
      const res = await ledger.runLedger({ db: database, watchlist: wl, emitChanges });
      console.log(`[ledger:${emitChanges ? "cron" : "seed"}] ${JSON.stringify(res)}`);
    } catch (err) {
      console.error("[ledger] run error", err);
    } finally {
      database.close();
    }
  };

  // ---- Lookout crt.sh backfill (existence-only; never touches discovered hosts) ----
  const runLookout = async (): Promise<void> => {
    const wl = loadWl();
    if (!wl) return;
    const database = db.createDb(db.resolveDbPath());
    const scanId = database.recordScanStart("lookout"); // one aggregate scan for /status
    try {
      let added = 0;
      let certsSeen = 0;
      // Watchlist apexes + the dynamic tier (newly-registered + kept) so a brand-new .gov also
      // gets its certs/subdomains enumerated. No CURATED_GOV here — Lookout stays watchlist-first.
      for (const apex of sweepTargets(database, ...wl.apexDomains, ...wl.subdomainApexes)) {
        const certs = await lookout.fetchCrtShCerts(apex);
        certsSeen += certs.length;
        added += lookout.runLookoutBackfill({ db: database, watchlist: wl, certs, recordScan: false }).subdomainsAdded;
        await new Promise((r) => setTimeout(r, 2000)); // be gentle with crt.sh
      }
      database.recordScanFinish(scanId, { ok: true, itemsSeen: certsSeen, changesEmitted: added });
      console.log(`[lookout:cron] backfill complete — ${added} new subdomains`);
    } catch (err) {
      database.recordScanFinish(scanId, { ok: false, error: String(err), itemsSeen: 0, changesEmitted: 0 });
      console.error("[lookout] run error", err);
    } finally {
      database.close();
    }
  };

  if (ledgerCron) {
    // First boot with an empty registry → silent baseline, then daily emitting diffs.
    try {
      const database = db.createDb(db.resolveDbPath());
      const empty =
        (database.sql.prepare("SELECT COUNT(*) AS n FROM domains").get() as { n: number }).n === 0;
      database.close();
      if (empty) void runLedger(false);
    } catch (err) {
      console.error("[ledger] seed check failed", err);
    }
    if (cron.validate(ledgerCron)) {
      cron.schedule(ledgerCron, () => void runLedger(true), { timezone: "UTC" });
      console.log(`[ledger:cron] scheduled '${ledgerCron}' (UTC)`);
    } else {
      console.warn(`[ledger] invalid DAYLIGHT_LEDGER_CRON: ${ledgerCron}`);
    }
  }

  if (lookoutCron) {
    if (cron.validate(lookoutCron)) {
      cron.schedule(lookoutCron, () => void runLookout(), { timezone: "UTC" });
      console.log(`[lookout:cron] scheduled '${lookoutCron}' (UTC)`);
    } else {
      console.warn(`[lookout] invalid DAYLIGHT_LOOKOUT_CRON: ${lookoutCron}`);
    }
  }

  const channel = process.env.DAYLIGHT_BROWSER_CHANNEL;
  // Floodlight + Receipts sweep the same set: curated baseline + watchlist + the dynamic tier
  // (newly-registered within the probation window + kept). Computed per run from the live DB.
  const browserSweepHosts = (database: DaylightDb): string[] | null => {
    const wl = loadWl();
    if (!wl) return null;
    return sweepTargets(database, ...floodlight.CURATED_GOV, ...wl.apexDomains, ...wl.subdomainApexes);
  };

  // ---- Floodlight sweep (live capture; public .gov homepages, load-only) ----
  const runFloodlight = async (): Promise<void> => {
    const database = db.createDb(db.resolveDbPath());
    try {
      const hosts = browserSweepHosts(database);
      if (!hosts) return;
      const r = await floodlight.runFloodlightSweep(database, hosts, { channel });
      console.log(
        `[floodlight:cron] sweep — ${r.scanned} scanned, ${r.gated} gated, ${r.flagged} flagged, ${r.retried} recovered` +
          (r.stillFailed.length ? `; still failing: ${r.stillFailed.join(", ")}` : ""),
      );
    } catch (err) {
      console.error("[floodlight] sweep error", err);
    } finally {
      database.close();
    }
  };

  // ---- Receipts sweep (snapshot + removal diff of the same public .gov homepages) ----
  const runReceipts = async (): Promise<void> => {
    const wayback =
      process.env.DAYLIGHT_WAYBACK === "1" ? (u: string) => receipts.saveToWayback(u) : undefined;
    const database = db.createDb(db.resolveDbPath());
    try {
      const hosts = browserSweepHosts(database);
      if (!hosts) return;
      const r = await receiptsSweep.runReceiptsSweep(database, hosts, { channel, waybackSave: wayback });
      console.log(`[receipts:cron] sweep — ${r.captured} captured, ${r.gated} gated, ${r.removals} removals`);
    } catch (err) {
      console.error("[receipts] sweep error", err);
    } finally {
      database.close();
    }
  };

  if (floodlightCron) {
    if (cron.validate(floodlightCron)) {
      cron.schedule(floodlightCron, () => void runFloodlight(), { timezone: "UTC" });
      console.log(`[floodlight:cron] scheduled '${floodlightCron}' (UTC)`);
    } else {
      console.warn(`[floodlight] invalid DAYLIGHT_FLOODLIGHT_CRON: ${floodlightCron}`);
    }
  }

  if (receiptsCron) {
    if (cron.validate(receiptsCron)) {
      cron.schedule(receiptsCron, () => void runReceipts(), { timezone: "UTC" });
      console.log(`[receipts:cron] scheduled '${receiptsCron}' (UTC)`);
    } else {
      console.warn(`[receipts] invalid DAYLIGHT_RECEIPTS_CRON: ${receiptsCron}`);
    }
  }

  // ---- Redtape sweep (idempotent; assesses new collection evidence, re-checks published gaps) ----
  const runRedtape = async (): Promise<void> => {
    if (!process.env.ANTHROPIC_API_KEY?.trim()) {
      console.warn("[redtape:cron] skipped — ANTHROPIC_API_KEY not set");
      return;
    }
    const wl = loadWl();
    if (!wl) return;
    const database = db.createDb(db.resolveDbPath());
    const scanId = database.recordScanStart("redtape");
    try {
      const r = await redtape.runRedtapeSweep({ db: database, watchlist: wl, researcher: redtape.claudeResearcher() });
      database.recordScanFinish(scanId, { ok: true, itemsSeen: r.candidates, changesEmitted: r.assessed + r.requeued });
      console.log(`[redtape:cron] ${r.assessed} assessed, ${r.skipped} unchanged, ${r.requeued} re-queued`);
    } catch (err) {
      database.recordScanFinish(scanId, { ok: false, error: String(err), itemsSeen: 0, changesEmitted: 0 });
      console.error("[redtape] sweep error", err);
    } finally {
      database.close();
    }
  };

  if (redtapeCron) {
    if (cron.validate(redtapeCron)) {
      cron.schedule(redtapeCron, () => void runRedtape(), { timezone: "UTC" });
      console.log(`[redtape:cron] scheduled '${redtapeCron}' (UTC)`);
    } else {
      console.warn(`[redtape] invalid DAYLIGHT_REDTAPE_CRON: ${redtapeCron}`);
    }
  }

  // ---- Foundry (derived: joins Lookout's CT subdomains + Ledger's registry — fetches nothing) ----
  // No network of its own, so schedule it a beat AFTER the Lookout backfill so it reads fresh CT.
  const runFoundry = (): void => {
    const database = db.createDb(db.resolveDbPath());
    try {
      const r = foundry.runFoundryScan(database, core.nowIso());
      console.log(
        `[foundry:cron] ${r.report.vendors.length} vendor(s), ` +
          `${r.report.vendors.reduce((n, v) => n + v.agencyCount, 0)} agency-links, ${r.changesEmitted} new unlaunched`,
      );
    } catch (err) {
      console.error("[foundry] run error", err);
    } finally {
      database.close();
    }
  };

  if (foundryCron) {
    if (cron.validate(foundryCron)) {
      cron.schedule(foundryCron, () => runFoundry(), { timezone: "UTC" });
      console.log(`[foundry:cron] scheduled '${foundryCron}' (UTC)`);
    } else {
      console.warn(`[foundry] invalid DAYLIGHT_FOUNDRY_CRON: ${foundryCron}`);
    }
  }
}
