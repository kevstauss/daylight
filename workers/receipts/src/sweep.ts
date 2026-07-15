import type { DaylightDb } from "@daylight/db";
import { captureAndSnapshot } from "./live.js";
import { checkArchiverPolicy, recordArchiverRefusal } from "./policy.js";
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
  /** Hosts where the Internet Archive itself reported the origin turning its crawler away. */
  archiverRefusals: number;
}

export interface ReceiptsSweepOptions {
  channel?: string;
  waybackSave?: WaybackSaver;
  log?: (msg: string) => void;
  /**
   * The archiver's verbatim failure for a host, if the caller recorded one. The reason lives in
   * the caller's saver closure, so it has to be handed back rather than guessed at — and it must
   * be SPN2's own text, since that is what distinguishes "the site turned the Archive away" from
   * "the Archive was busy".
   */
  archiveFailureFor?: (host: string) => string | undefined;
}

/** Snapshot each host's homepage (public, load-only) and diff vs the last snapshot for removals. */
export async function runReceiptsSweep(
  db: DaylightDb,
  hosts: string[],
  opts: ReceiptsSweepOptions = {},
): Promise<ReceiptsSweepResult> {
  const uniq = [...new Set(hosts.map((h) => h.toLowerCase()))].filter((h) => h.endsWith(".gov"));
  const out: ReceiptsSweepResult = {
    captured: 0,
    gated: 0,
    removals: 0,
    archived: 0,
    archiveFailed: 0,
    policyChanges: 0,
    archiverRefusals: 0,
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
      else {
        out.archiveFailed++;
        // Did the ARCHIVE say the site turned it away? Only then is there a claim to make, and
        // recordArchiverRefusal re-checks that itself before writing anything.
        const reason = opts.archiveFailureFor?.(host);
        if (reason) {
          try {
            const id = await recordArchiverRefusal(db, host, reason, {
              weCapturedOk: r.ok && !r.gated,
              log: opts.log,
            });
            if (id !== null) out.archiverRefusals++;
          } catch (err) {
            opts.log?.(`[receipts] ${host}: refusal check failed — ${err instanceof Error ? err.message : err}`);
          }
        }
      }
    }
    opts.log?.(
      `[receipts] ${host}: ${r.gated ? "gated" : r.ok ? `ok (${r.removed?.length ?? 0} removals)` : `error: ${r.error}`}`,
    );
  }
  return out;
}
