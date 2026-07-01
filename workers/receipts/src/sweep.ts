import type { DaylightDb } from "@daylight/db";
import { captureAndSnapshot } from "./live.js";
import type { WaybackSaver } from "./wayback.js";

export interface ReceiptsSweepResult {
  captured: number;
  gated: number;
  removals: number;
}

/** Snapshot each host's homepage (public, load-only) and diff vs the last snapshot for removals. */
export async function runReceiptsSweep(
  db: DaylightDb,
  hosts: string[],
  opts: { channel?: string; waybackSave?: WaybackSaver; log?: (msg: string) => void } = {},
): Promise<ReceiptsSweepResult> {
  const uniq = [...new Set(hosts.map((h) => h.toLowerCase()))].filter((h) => h.endsWith(".gov"));
  const out: ReceiptsSweepResult = { captured: 0, gated: 0, removals: 0 };
  for (const host of uniq) {
    const r = await captureAndSnapshot(db, `https://${host}/`, {
      channel: opts.channel,
      waybackSave: opts.waybackSave,
      govOnly: true,
    });
    if (r.gated) out.gated++;
    else if (r.ok) out.captured++;
    out.removals += r.removed?.length ?? 0;
    opts.log?.(
      `[receipts] ${host}: ${r.gated ? "gated" : r.ok ? `ok (${r.removed?.length ?? 0} removals)` : `error: ${r.error}`}`,
    );
  }
  return out;
}
