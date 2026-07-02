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
}

/** Scan each host's homepage once (public, .gov-only, load-only) and persist a scorecard. */
export async function runFloodlightSweep(
  db: DaylightDb,
  hosts: string[],
  opts: { channel?: string; log?: (msg: string) => void } = {},
): Promise<FloodlightSweepResult> {
  const uniq = [...new Set(hosts.map((h) => h.toLowerCase()))].filter((h) => h.endsWith(".gov"));
  const out: FloodlightSweepResult = { scanned: 0, flagged: 0, gated: 0 };
  for (const host of uniq) {
    const r = await captureAndScore(db, `https://${host}/`, { channel: opts.channel, govOnly: true });
    if (r.ok && !r.gated) out.scanned++;
    if (r.gated) out.gated++;
    if (r.severity === "high" || r.severity === "notable") out.flagged++;
    opts.log?.(`[floodlight] ${host}: ${r.ok ? (r.gated ? "gated" : r.severity) : `error: ${r.error}`}`);
    await new Promise((res) => setTimeout(res, 1500)); // gentle + let memory settle between browsers
  }
  return out;
}
