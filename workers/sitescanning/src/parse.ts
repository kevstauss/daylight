import { sha256 } from "@daylight/core";
import type { ColumnIndex } from "./csv.js";

/** One normalized GSA Site-Scanning row, reduced to the fields Daylight uses. */
export interface SiteScanRecord {
  url: string; // scanned final URL (row key)
  domain: string; // base_domain, lowercased .gov apex
  scannedAt: string; // scan_date
  primaryScanStatus: string | null;
  /** true = DAP detected, false = explicitly not detected, null = GSA left the cell blank/unknown.
   *  The blank case matters: we only promote on a site's OWN GA when dap is EXPLICITLY false, so a
   *  blank dap can't misread the government-wide DAP tag as the site's own analytics. */
  dap: boolean | null;
  gaTagId: string | null;
  thirdPartyDomains: string[]; // parsed from the JSON-encoded cell
  thirdPartyCount: number | null;
}

const at = (cols: string[], i: number): string => (cols[i] ?? "").replace(/\r$/, "").trim();

/** Parse the JSON-array-in-a-cell fields (third_party_service_domains etc.). Tolerates a bare
 *  empty cell, `[]`, or a malformed value (→ []) without throwing. */
function parseJsonList(cell: string): string[] {
  const s = cell.trim();
  if (!s || s === "[]") return [];
  try {
    const v = JSON.parse(s);
    if (Array.isArray(v)) return v.map((x) => String(x).trim().toLowerCase()).filter(Boolean);
  } catch {
    /* fall through — a malformed list is treated as empty, never a mis-read */
  }
  return [];
}

/** Map a raw CSV row to a normalized record. Returns null for a non-.gov row (out of scope) or a
 *  row with no usable URL/apex, so the caller skips it. */
export function parseRow(cols: string[], idx: ColumnIndex): SiteScanRecord | null {
  const url = at(cols, idx.url);
  const domain = at(cols, idx.base_domain).toLowerCase();
  const tld = at(cols, idx.top_level_domain).toLowerCase();
  // Scope gate — Daylight watches federal .gov (the SSRF/scope doctrine, applied at ingest).
  if (!url || !domain || tld !== "gov" || !domain.endsWith(".gov")) return null;
  const dapRaw = at(cols, idx.dap).toLowerCase();
  const gaRaw = at(cols, idx.ga_tag_id);
  const countRaw = at(cols, idx.third_party_service_count);
  const count = Number(countRaw);
  return {
    url,
    domain,
    scannedAt: at(cols, idx.scan_date),
    primaryScanStatus: at(cols, idx.primary_scan_status) || null,
    dap: dapRaw === "" ? null : dapRaw === "true" || dapRaw === "1",
    gaTagId: gaRaw || null,
    thirdPartyDomains: parseJsonList(at(cols, idx.third_party_service_domains)),
    thirdPartyCount: Number.isFinite(count) ? count : null,
  };
}

// A separator that cannot occur in the field values, so the join stays injective.
const SEP = String.fromCharCode(31); // ASCII Unit Separator (0x1F)

/** Stable hash of the fields that would make a scan "change" — lets an unchanged daily row be
 *  skipped and is stored so we can tell a real diff from re-ingesting the same dump. */
export function scanContentHash(r: SiteScanRecord): string {
  return sha256(
    [
      r.url,
      r.primaryScanStatus ?? "",
      r.dap === true ? "1" : r.dap === false ? "0" : "",
      r.gaTagId ?? "",
      [...r.thirdPartyDomains].sort().join(","),
    ].join(SEP),
  );
}

// Third parties that are EXPECTED on federal sites and must NOT trigger a Floodlight promotion:
// the government-wide Digital Analytics Program and its GA/GTM transport, hosted fonts, and common
// library CDNs. A NEW appearance of any of these is not a finding. Anything else new — an ad
// pixel, a session-replay vendor, a social tracker — is exactly what we want Floodlight to look at.
// (Ad networks like doubleclick, and session-replay/social pixels, are deliberately NOT benign.)
const BENIGN_HOSTS = new Set<string>([
  "dap.digitalgov.gov",
  "www.google-analytics.com",
  "google-analytics.com",
  "ssl.google-analytics.com",
  "analytics.google.com",
  "www.googletagmanager.com",
  "googletagmanager.com",
  "fonts.googleapis.com",
  "fonts.gstatic.com",
  "ajax.googleapis.com",
  "cdnjs.cloudflare.com",
  "code.jquery.com",
  "stackpath.bootstrapcdn.com",
  "maxcdn.bootstrapcdn.com",
  "search.usa.gov",
  "search.gov",
  "touchpoints.app.cloud.gov",
]);

// Suffixes for sharded benign hosts (GA/GTM answer from region1.*/www.*; fonts/libs from *.gstatic
// /*.googleapis). Coarsening these the way Floodlight coarsens vendor hosts keeps a rotated shard
// from reading as a "new" third party.
const BENIGN_SUFFIXES = [
  ".google-analytics.com",
  ".googletagmanager.com",
  ".gstatic.com",
  ".googleapis.com",
];

/** True when a third-party host is expected government/analytics/CDN plumbing (not a finding). */
export function isBenignThirdParty(host: string): boolean {
  const h = host.trim().toLowerCase();
  if (BENIGN_HOSTS.has(h)) return true;
  return BENIGN_SUFFIXES.some((suf) => h.endsWith(suf));
}
