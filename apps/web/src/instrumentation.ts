// In-process schedulers. One Fly machine runs the web read-path AND the scheduled
// batch workers (Ledger daily diff, Lookout crt.sh backfill), sharing the one SQLite
// volume. Each cron activates only when its env var is set (so `pnpm dev` stays quiet).

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const ledgerCron = process.env.DAYLIGHT_LEDGER_CRON?.trim();
  const lookoutCron = process.env.DAYLIGHT_LOOKOUT_CRON?.trim();
  if (!ledgerCron && !lookoutCron) return;

  const [{ default: cron }, core, db, ledger, lookout, repo] = await Promise.all([
    import("node-cron"),
    import("@daylight/core"),
    import("@daylight/db"),
    import("@daylight/ledger"),
    import("@daylight/lookout"),
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
    try {
      let added = 0;
      for (const apex of [...wl.apexDomains, ...wl.subdomainApexes]) {
        const certs = await lookout.fetchCrtShCerts(apex);
        added += lookout.runLookoutBackfill({ db: database, watchlist: wl, certs }).subdomainsAdded;
        await new Promise((r) => setTimeout(r, 2000)); // be gentle with crt.sh
      }
      console.log(`[lookout:cron] backfill complete — ${added} new subdomains`);
    } catch (err) {
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
}
