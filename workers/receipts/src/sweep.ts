import type { DaylightDb } from "@daylight/db";
import { captureAndSnapshot } from "./live.js";
import { checkArchiverPolicy } from "./policy.js";
import type { WaybackSaver } from "./wayback.js";

export interface ReceiptsSweepResult {
  captured: number;
  gated: number;
  removals: number;
  /** Pages whose independent archive was saved (or retried into place) this run. */
  archived: number;
  /** Pages left without an archive for THIS capture. A silently-unarchived receipt is the
   *  failure mode that matters most here, so the sweep counts it rather than shrugging. */
  archiveFailed: number;
  /** Hosts whose robots.txt newly declares (or stops declaring) a block on an archiver. */
  policyChanges: number;
}

/** Snapshot each host's homepage (public, load-only) and diff vs the last snapshot for removals. */
export async function runReceiptsSweep(
  db: DaylightDb,
  hosts: string[],
  opts: { channel?: string; waybackSave?: WaybackSaver; log?: (msg: string) => void } = {},
): Promise<ReceiptsSweepResult> {
  const uniq = [...new Set(hosts.map((h) => h.toLowerCase()))].filter((h) => h.endsWith(".gov"));
  const out: ReceiptsSweepResult = {
    captured: 0,
    gated: 0,
    removals: 0,
    archived: 0,
    archiveFailed: 0,
    policyChanges: 0,
  };
  for (const host of uniq) {
    // What the site declares about archivers, before we look at the page itself. Cheap (one
    // robots.txt), idempotent, and silent unless the declaration actually changed.
    try {
      const policy = await checkArchiverPolicy(db, host, { log: opts.log });
      out.policyChanges += policy.changeIds.length;
    } catch (err) {
      opts.log?.(`[receipts] ${host}: robots policy check failed — ${err instanceof Error ? err.message : err}`);
    }

    const r = await captureAndSnapshot(db, `https://${host}/`, {
      channel: opts.channel,
      waybackSave: opts.waybackSave,
      govOnly: true,
    });
    if (r.gated) out.gated++;
    else if (r.ok) out.captured++;
    out.removals += r.removed?.length ?? 0;
    // Counts this run's archive ATTEMPTS. A page that short-circuited with an archive already
    // on file is neither — nothing was tried and nothing is missing.
    if (r.archiveAttempted) {
      if (r.waybackUrl) out.archived++;
      else out.archiveFailed++;
    }
    opts.log?.(
      `[receipts] ${host}: ${r.gated ? "gated" : r.ok ? `ok (${r.removed?.length ?? 0} removals)` : `error: ${r.error}`}`,
    );
  }
  return out;
}
