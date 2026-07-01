import { loadWatchlist, type Watchlist } from "@daylight/core";
import { findRepoFile } from "./repoFile";

let cached: Watchlist | null = null;

/** Load config/watchlist.yaml once (server-side). Null if not found/parseable. */
export function watchlist(): Watchlist | null {
  if (cached) return cached;
  const p = process.env.DAYLIGHT_WATCHLIST?.trim() || findRepoFile("config/watchlist.yaml");
  if (!p) return null;
  try {
    cached = loadWatchlist(p);
    return cached;
  } catch {
    return null;
  }
}
