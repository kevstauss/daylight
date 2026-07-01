// In-process daily Ledger scheduler. One Fly machine runs the web read-path AND the
// daily batch, sharing the one SQLite volume (avoids Fly's one-machine-per-volume limit).
// Activated only when DAYLIGHT_LEDGER_CRON is set (so `pnpm dev` stays quiet locally).

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const cronExpr = process.env.DAYLIGHT_LEDGER_CRON?.trim();
  if (!cronExpr) return;

  const [{ default: cron }, core, db, ledger, repo] = await Promise.all([
    import("node-cron"),
    import("@daylight/core"),
    import("@daylight/db"),
    import("@daylight/ledger"),
    import("./lib/repoFile"),
  ]);

  const findWatchlist = (): string | null =>
    process.env.DAYLIGHT_WATCHLIST?.trim() || repo.findRepoFile("config/watchlist.yaml");

  const runOnce = async (emitChanges: boolean): Promise<void> => {
    const wlPath = findWatchlist();
    if (!wlPath) {
      console.warn("[ledger] config/watchlist.yaml not found — skipping run");
      return;
    }
    const database = db.createDb(db.resolveDbPath());
    try {
      const res = await ledger.runLedger({
        db: database,
        watchlist: core.loadWatchlist(wlPath),
        emitChanges,
      });
      console.log(`[ledger:${emitChanges ? "cron" : "seed"}] ${JSON.stringify(res)}`);
    } catch (err) {
      console.error("[ledger] run error", err);
    } finally {
      database.close();
    }
  };

  // First boot with an empty registry → establish a silent baseline (no per-domain
  // "added" flood), then let the daily cron emit real diffs.
  try {
    const database = db.createDb(db.resolveDbPath());
    const empty =
      (database.sql.prepare("SELECT COUNT(*) AS n FROM domains").get() as { n: number }).n === 0;
    database.close();
    if (empty) void runOnce(false);
  } catch (err) {
    console.error("[ledger] seed check failed", err);
  }

  if (!cron.validate(cronExpr)) {
    console.warn(`[ledger] invalid DAYLIGHT_LEDGER_CRON: ${cronExpr}`);
    return;
  }
  cron.schedule(cronExpr, () => void runOnce(true), { timezone: "UTC" });
  console.log(`[ledger:cron] scheduled '${cronExpr}' (UTC)`);
}
