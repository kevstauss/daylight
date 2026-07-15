// Watch what a site DECLARES about being archived, and record it when it changes.
//
// This is the one place Daylight says "this site told archivers to go away" — so it only ever
// fires on a written directive naming an archiver (see blocks.ts for why intermittent 403s from
// a CDN are emphatically not the same claim). robots.txt is quoted verbatim and its URL is the
// source link, so a reader can check the claim against the site in one click.
//
// Both directions are recorded. A block appearing on a federal site is the headline; a block
// being lifted is equally part of an honest ledger, and a watchdog that only reports the
// damning direction is not a ledger, it is a campaign.

import { nowIso, sha256 } from "@daylight/core";
import type { Change } from "@daylight/core";
import type { DaylightDb } from "@daylight/db";
import { fetchRobotsTxt } from "@daylight/floodlight/guards";
import { declaredBlocks, describeDeclaredBlock, type DeclaredBlock } from "./blocks.js";

/** The observation domain key — kept distinct from the page-snapshot stream for the same host. */
const policyKey = (host: string): string => `${host}#robots-policy`;

export interface ArchiverPolicyResult {
  /** null = we could not read robots.txt. NOT the same as "declares nothing". */
  blocks: DeclaredBlock[] | null;
  changeIds: number[];
  robotsUrl: string | null;
}

export interface ArchiverPolicyOptions {
  now?: string;
  userAgent?: string;
  allowPrivate?: boolean;
  log?: (msg: string) => void;
}

function ua(): string {
  const site = (process.env.DAYLIGHT_SITE_URL?.trim() || "http://localhost:3000").replace(/\/+$/, "");
  return `DaylightBot/0.5 (+${site}/methods; observational; public-data-only)`;
}

const fingerprint = (blocks: DeclaredBlock[]): string =>
  sha256(JSON.stringify(blocks.map((b) => `${b.party}|${b.userAgent}|${b.directive}`).sort()));

/**
 * Read a host's robots.txt and record any declared archiver block.
 *
 * Idempotent via the observation content hash: an unchanged policy re-emits nothing, so this can
 * run on every sweep. A change event fires only on a TRANSITION — the first time a block appears
 * (or the moment it is lifted) — never once per sweep for a standing directive.
 */
export async function checkArchiverPolicy(
  db: DaylightDb,
  host: string,
  opts: ArchiverPolicyOptions = {},
): Promise<ArchiverPolicyResult> {
  const now = opts.now ?? nowIso();
  const robots = await fetchRobotsTxt(`https://${host}/`, opts.userAgent ?? ua(), {
    allowPrivate: opts.allowPrivate,
  });
  // Unreadable robots.txt is silence, not consent and not refusal. moms.gov's Akamai edge denies
  // the file outright; reporting that as "declares nothing" would be as wrong as reporting it as
  // a block. We record nothing at all.
  if (!robots) return { blocks: null, changeIds: [], robotsUrl: null };

  const blocks = declaredBlocks(robots.text);
  const contentHash = fingerprint(blocks);
  const key = policyKey(host);
  const prev = db.latestObservation("receipts", key);
  const prevBlocks: DeclaredBlock[] = prev
    ? ((JSON.parse(prev.payload_json) as { blocks?: DeclaredBlock[] }).blocks ?? [])
    : [];

  const { inserted } = db.insertObservation({
    module: "receipts",
    domain: key,
    observedAt: now,
    sourceUrl: robots.url,
    contentHash,
    payload: { host, blocks, robotsUrl: robots.url },
  });
  // Same policy as last time → nothing to say.
  if (!inserted) return { blocks, changeIds: [], robotsUrl: robots.url };

  const changeIds: number[] = [];
  const seen = (list: DeclaredBlock[], b: DeclaredBlock): boolean =>
    list.some((x) => x.party === b.party && x.userAgent === b.userAgent);

  for (const b of blocks) {
    if (seen(prevBlocks, b)) continue; // standing directive, already reported
    changeIds.push(
      db.insertChange({
        module: "receipts",
        domain: host,
        detectedAt: now,
        kind: "added",
        field: "archiver_disallowed",
        oldValue: null,
        newValue: b.directive,
        // A federal site publishing an instruction not to preserve it is a first-order fact for
        // a preservation watchdog — and unlike a CDN's 403, someone wrote it on purpose.
        severity: "high",
        reason: describeDeclaredBlock(b, host, now),
        sourceUrl: robots.url,
      } satisfies Change),
    );
    opts.log?.(`[receipts] ${host}: declares a block on ${b.party} — ${b.directive}`);
  }

  for (const b of prevBlocks) {
    if (seen(blocks, b)) continue;
    changeIds.push(
      db.insertChange({
        module: "receipts",
        domain: host,
        detectedAt: now,
        kind: "removed",
        field: "archiver_disallowed",
        oldValue: b.directive,
        newValue: null,
        severity: "notable",
        reason: `${host}/robots.txt no longer instructs ${
          b.party === "internet-archive" ? "the Internet Archive's crawler" : "Daylight's crawler"
        } (${b.userAgent}) away from the site as of ${now.slice(0, 10)}. The previous directive was "${b.directive}".`,
        sourceUrl: robots.url,
      } satisfies Change),
    );
  }

  return { blocks, changeIds, robotsUrl: robots.url };
}
