// How Receipts gets an independent, dated copy of a watched page — the thing that makes a
// removal claim checkable by someone who doesn't trust us.
//
// Two routes, in order:
//   1. Ask the Internet Archive to capture it now (Save Page Now). Best case: the archive is
//      taken seconds from our snapshot, so it corroborates the exact bytes we hashed.
//   2. If that fails, ADOPT the Archive's nearest existing capture. Save Page Now fails often
//      enough to matter (a 3-slot concurrency cap, intermittent 403s from hosts behind Akamai /
//      Cloudflare), while the same sites are independently crawled many times a day — so a real,
//      public, dated third-party copy usually exists within minutes of when we looked.
//
// An adopted capture is genuinely weaker evidence: it is not a copy of the bytes we hashed, only
// of the page around the same time. That is why the drift rides along and the UI dates every
// archive by the capture's OWN timestamp rather than by the snapshot holding the link. Weaker
// and honestly labelled beats a confident gap.
//
// Adoption is NOT a way around a site that refuses archiving — nothing here spoofs an identity
// or evades bot protection. It reads a public index and links to a copy that already exists.

import { findCaptureNear } from "./cdx.js";
import { saveToWayback, type WaybackOptions, type WaybackSaver } from "./wayback.js";

export interface ArchiverOptions extends WaybackOptions {
  /** How far from our observation an adopted capture may sit. Beyond this it stops being a
   *  receipt for what we saw, and "no archive" is the more honest answer. */
  windowHours?: number;
  /** Skip the adoption fallback (Save Page Now only). */
  noAdopt?: boolean;
  /** Told when we fall back to someone else's capture, with the drift. */
  onAdopt?: (url: string, archiveUrl: string, driftMinutes: number) => void;
  /** Clock seam for tests. */
  now?: () => string;
}

/**
 * A WaybackSaver that tries Save Page Now and falls back to adopting the nearest existing
 * capture. Returns a timestamp-pinned archive URL, or null when neither route finds one.
 */
export function makeArchiver(opts: ArchiverOptions = {}): WaybackSaver {
  return async (url: string): Promise<string | null> => {
    const saved = await saveToWayback(url, opts);
    if (saved) return saved;
    if (opts.noAdopt) return null;

    const at = opts.now?.() ?? new Date().toISOString();
    const nearby = await findCaptureNear(url, at, {
      fetchImpl: opts.fetchImpl,
      windowHours: opts.windowHours ?? 6,
    });
    if (!nearby) return null;
    opts.onAdopt?.(url, nearby.archiveUrl, nearby.driftMinutes);
    return nearby.archiveUrl;
  };
}
