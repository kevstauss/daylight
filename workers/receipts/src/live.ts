import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { nowIso, sha256 } from "@daylight/core";
import type { DaylightDb } from "@daylight/db";
import { capturePage, type CaptureOptions } from "@daylight/floodlight/capture";
import { runReceiptsSnapshot } from "./run.js";
import { snapshotFromLiveCapture } from "./snapshot-map.js";
import type { WaybackSaver } from "./wayback.js";

/** The raw store — screenshots + DOM live here and are NEVER served publicly (PRD §5/§8). */
function rawDir(): string {
  return process.env.DAYLIGHT_RAW_DIR?.trim() || join(process.cwd(), "data", "raw");
}

function storeScreenshot(png: Buffer | null, key: string): string | null {
  if (!png) return null;
  const dir = rawDir();
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${key}.png`);
  writeFileSync(path, png);
  return path;
}

export interface LiveSnapshotOptions extends CaptureOptions {
  now?: string;
  /** Opt-in Wayback archiving (external call). Off unless provided. */
  waybackSave?: WaybackSaver;
}

export interface LiveSnapshotResult {
  ok: boolean;
  gated: boolean;
  url: string;
  changeIds?: number[];
  removed?: string[];
  waybackUrl?: string | null;
  error?: string;
}

/**
 * Snapshot a public page live: capture (DOM + trackers + screenshot), store the screenshot in
 * the raw store, diff vs the previous snapshot, and emit removals. A gated page is recorded as
 * existing but never entered.
 */
export async function captureAndSnapshot(
  db: DaylightDb,
  url: string,
  opts: LiveSnapshotOptions = {},
): Promise<LiveSnapshotResult> {
  let live;
  try {
    live = await capturePage(url, opts);
  } catch (err) {
    return { ok: false, gated: false, url, error: err instanceof Error ? err.message : String(err) };
  }
  if (live.gated) return { ok: true, gated: true, url };

  const capturedAt = opts.now ?? nowIso();
  const screenshotRef = storeScreenshot(live.screenshotPng, sha256(url + capturedAt));
  const snapshot = snapshotFromLiveCapture(url, live, capturedAt, screenshotRef);
  const r = await runReceiptsSnapshot({ db, snapshot, now: capturedAt, waybackSave: opts.waybackSave });
  return {
    ok: true,
    gated: false,
    url,
    changeIds: r.changeIds,
    removed: r.removed,
    waybackUrl: r.waybackUrl,
  };
}
