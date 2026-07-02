import type { DaylightDb } from "@daylight/db";
import { captureAndScore } from "./capture.js";

// Prominent federal .gov sites — the standing "hall of shame" set for the tracker scorecard.
// The scheduled sweep re-scans these (plus the watched apexes) so scorecards stay current and
// tracker add/remove diffs feed Receipts over time.
export const CURATED_GOV = [
  // High-traffic + high-PII services
  "whitehouse.gov", "usa.gov", "irs.gov", "ssa.gov", "medicare.gov", "medicaid.gov",
  "studentaid.gov", "va.gov", "cdc.gov", "weather.gov", "nih.gov", "ftc.gov",
  "consumerfinance.gov", "benefits.gov", "healthcare.gov", "congress.gov", "ready.gov",
  "vote.gov", "recreation.gov", "usajobs.gov", "sam.gov", "grants.gov",
  "disasterassistance.gov", "identitytheft.gov", "cms.gov", "fda.gov", "uscis.gov",
  // Departments + major agencies
  "dhs.gov", "state.gov", "treasury.gov", "justice.gov", "epa.gov", "nasa.gov",
  "noaa.gov", "usda.gov", "hud.gov", "dol.gov", "ed.gov", "hhs.gov", "commerce.gov",
  "energy.gov", "interior.gov", "transportation.gov", "gsa.gov", "opm.gov", "sba.gov",
  "fema.gov", "tsa.gov", "cbp.gov", "faa.gov",
  // Independent agencies / oversight
  "sec.gov", "fcc.gov", "nrc.gov", "eeoc.gov", "fdic.gov", "archives.gov", "loc.gov",
];

export interface FloodlightSweepResult {
  scanned: number;
  flagged: number;
  gated: number;
  /** Hosts that errored on the first pass and were captured on the retry pass. */
  retried: number;
  /** Hosts that failed both passes — logged by name, never silently dropped. */
  stillFailed: string[];
}

/** Scan each host's homepage once (public, .gov-only, load-only) and persist a scorecard. */
export async function runFloodlightSweep(
  db: DaylightDb,
  hosts: string[],
  opts: { channel?: string; log?: (msg: string) => void } = {},
): Promise<FloodlightSweepResult> {
  const uniq = [...new Set(hosts.map((h) => h.toLowerCase()))].filter((h) => h.endsWith(".gov"));
  const out: FloodlightSweepResult = { scanned: 0, flagged: 0, gated: 0, retried: 0, stillFailed: [] };
  const failed: string[] = [];

  for (const host of uniq) {
    const r = await captureAndScore(db, `https://${host}/`, { channel: opts.channel, govOnly: true });
    if (r.ok && !r.gated) out.scanned++;
    if (r.gated) out.gated++;
    if (r.severity === "high" || r.severity === "notable") out.flagged++;
    if (!r.ok) failed.push(host);
    opts.log?.(`[floodlight] ${host}: ${r.ok ? (r.gated ? "gated" : r.severity) : `error: ${r.error}`}`);
    await new Promise((res) => setTimeout(res, 1500)); // gentle + let memory settle between browsers
  }

  // Retry pass — a host that errored (usually a transient timeout on a heavy page or a busy
  // machine) gets one more attempt on the now-idle machine with a longer per-op budget. Nothing
  // is excluded on a single bad capture; a host that fails BOTH passes is surfaced by name.
  for (const host of failed) {
    await new Promise((res) => setTimeout(res, 3000));
    const r = await captureAndScore(db, `https://${host}/`, {
      channel: opts.channel,
      govOnly: true,
      timeoutMs: 40000, // overall cap = 40000 + 25000 = 65s for the stragglers
    });
    if (r.ok && !r.gated) {
      out.scanned++;
      out.retried++;
      if (r.severity === "high" || r.severity === "notable") out.flagged++;
    } else if (r.gated) {
      out.gated++;
    } else {
      out.stillFailed.push(host);
    }
    opts.log?.(`[floodlight] retry ${host}: ${r.ok ? (r.gated ? "gated" : r.severity) : `error: ${r.error}`}`);
  }

  return out;
}
