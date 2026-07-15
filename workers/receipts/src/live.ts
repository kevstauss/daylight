import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { nowIso, sha256 } from "@daylight/core";
import type { DaylightDb } from "@daylight/db";
import { capturePage, type CaptureOptions } from "@daylight/floodlight/capture";
import { hostAllowed, isGovHost } from "@daylight/floodlight/guards";
import { redactText } from "@daylight/redact";
import { runReceiptsSnapshot } from "./run.js";
import { isWebUrl, snapshotFromLiveCapture } from "./snapshot-map.js";
import type { WaybackSaver } from "./wayback.js";

function ua(): string {
  const site = (process.env.DAYLIGHT_SITE_URL?.trim() || "http://localhost:3000").replace(/\/+$/, "");
  return `DaylightBot/0.5 (+${site}/methods; observational; public-data-only)`;
}

/**
 * Hash the privacy policy's actual TEXT (not just its URL), so an edited/gutted policy at the
 * same link is detected as a change. Light guarded fetch: .gov only, SSRF-checked, timeout,
 * no redirect-following, redacted. Returns null on any failure → caller keeps the URL hash.
 */
async function privacyTextHash(privacyUrl: string, allowPrivate?: boolean): Promise<string | null> {
  let u: URL;
  try {
    u = new URL(privacyUrl);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (!isGovHost(u.hostname)) return null;
  if (!(await hostAllowed(u.hostname, { allowPrivate }))) return null;
  try {
    const res = await fetch(privacyUrl, {
      headers: { "user-agent": ua() },
      redirect: "manual",
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const text = (await res.text())
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
    if (!text) return null;
    return sha256(redactText(text.slice(0, 200000)).value);
  } catch {
    return null;
  }
}

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
  /** Whether this capture tried to archive (see RunReceiptsResult.archiveAttempted). */
  archiveAttempted?: boolean;
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
    // Screenshots land in the raw store but are never served and never read back for the diff
    // (the removal ledger works off DOM facts + hashes), so capturing them only bloats the raw
    // store on the Fly volume. Default them OFF; Wayback keeps the durable visual copy. A caller
    // can still opt back in (skipScreenshot: false) if a review→publish flow ever needs the image.
    live = await capturePage(url, { ...opts, skipScreenshot: opts.skipScreenshot ?? true });
  } catch (err) {
    return { ok: false, gated: false, url, error: err instanceof Error ? err.message : String(err) };
  }
  if (live.gated) return { ok: true, gated: true, url };

  // A navigation that died in the browser leaves finalUrl on chrome-error://chromewebdata/ and an
  // empty DOM. Snapshotting that records a FALSE baseline — "0 trackers, no privacy notice, no
  // seal" — for a page we never actually saw, and the next real capture would then read as a
  // wave of additions. Prod carried four of these (studentaid.gov, state.gov, usda.gov, fcc.gov).
  // A failed load is an error to retry, not an observation to publish.
  if (!isWebUrl(live.finalUrl)) {
    return { ok: false, gated: false, url, error: `navigation failed (ended at ${live.finalUrl})` };
  }

  // A browser renders a 403 block page exactly as willingly as the real site, and a block page
  // has no trackers, no privacy notice and no seal — so filing one as a baseline states three
  // flattering falsehoods about an agency, and sets the next real capture up to read as a wave of
  // additions. Prod filed the SAME Akamai refusal as the homepage of fcc.gov, state.gov AND
  // usda.gov; the giveaway was all three sharing one DOM hash.
  //
  // Only a 2xx document is the page. Anything else is a failed observation to retry, not a fact
  // to publish. (A gated page is handled above: recorded as existing, never entered.)
  if (live.status !== null && (live.status < 200 || live.status >= 300)) {
    return { ok: false, gated: false, url, error: `page returned HTTP ${live.status} — not a capture of the page` };
  }

  const capturedAt = opts.now ?? nowIso();
  const screenshotRef = storeScreenshot(live.screenshotPng, sha256(url + capturedAt));
  const snapshot = snapshotFromLiveCapture(url, live, capturedAt, screenshotRef);
  // Prefer the policy's TEXT hash over its URL hash, so a same-link-but-changed policy is caught.
  const pUrl = live.capture.dom.privacyNoticeUrl;
  if (pUrl) {
    const h = await privacyTextHash(pUrl, opts.allowPrivate);
    if (h) snapshot.privacyTextHash = h;
  }
  const r = await runReceiptsSnapshot({ db, snapshot, now: capturedAt, waybackSave: opts.waybackSave });
  return {
    ok: true,
    gated: false,
    url,
    changeIds: r.changeIds,
    removed: r.removed,
    waybackUrl: r.waybackUrl,
    archiveAttempted: r.archiveAttempted,
  };
}
