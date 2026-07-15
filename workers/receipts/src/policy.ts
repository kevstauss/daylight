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
import {
  declaredBlocks,
  describeDeclaredBlock,
  describeObservedRefusal,
  originRefusedArchiver,
  type DeclaredBlock,
} from "./blocks.js";
import { countCaptures } from "./cdx.js";

/** The observation domain keys — kept distinct from the page-snapshot stream for the same host. */
const policyKey = (host: string): string => `${host}#robots-policy`;
const refusalKey = (host: string): string => `${host}#archiver-refusal`;

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

const captureKey = (host: string): string => `${host}#capture-status`;

/** Why a capture produced nothing. Coarse on purpose: the exact wording of a browser error is
 *  noise, but "the origin turned us away" and "the page never loaded" are different facts. */
export type CaptureFailureKind = "refused" | "unreachable";

export function classifyCaptureFailure(error: string): CaptureFailureKind {
  return /HTTP (4\d\d|5\d\d)/.test(error) ? "refused" : "unreachable";
}

/**
 * Record whether a watched page could be captured at all.
 *
 * Without this, a host we cannot see simply has no snapshot, and a page built from snapshots
 * renders that as absence — the site quietly disappears from "what we're watching" and the reader
 * is never told. Eleven federal sites were in exactly that position: not unwatched, not
 * uninteresting, just invisible. Silence read as coverage.
 *
 * Idempotent on the outcome, so a host that has been refusing us for weeks writes one row, not
 * one per sweep.
 */
export function recordCaptureOutcome(
  db: DaylightDb,
  host: string,
  outcome: { ok: boolean; error?: string; now?: string },
): void {
  const now = outcome.now ?? nowIso();
  const kind = outcome.ok ? "ok" : classifyCaptureFailure(outcome.error ?? "");
  const status = /HTTP (\d{3})/.exec(outcome.error ?? "")?.[1] ?? null;
  db.insertObservation({
    module: "receipts",
    domain: captureKey(host),
    observedAt: now,
    sourceUrl: `https://${host}/`,
    contentHash: sha256(JSON.stringify([kind, status])),
    payload: { host, ok: outcome.ok, kind, status, error: outcome.error ?? null },
  });
}

export interface RefusalOptions {
  now?: string;
  /** Did our own BROWSER capture succeed this run? Deliberately not used in the published copy —
   *  see refusesOurPlainRequest. Kept for the observation payload only. */
  weCapturedOk?: boolean;
  log?: (msg: string) => void;
  /** Seam for tests; defaults to a real guarded request. */
  probe?: (url: string) => Promise<number | null>;
}

/** The URL SPN2 says refused, which may be a redirect target rather than the host we asked for. */
function refusedUrlFrom(spn2Failure: string, host: string): string | undefined {
  const m = /blocks access to (\S+?)\.?\s*\(HTTP status=/i.exec(spn2Failure);
  const url = m?.[1];
  if (!url) return undefined;
  try {
    return new URL(url).host.toLowerCase() === host.toLowerCase() ? undefined : url;
  } catch {
    return undefined;
  }
}

/**
 * Does this URL refuse a plain, honest, non-browser request from us?
 *
 * This is the control that keeps the claim honest. Our page capture drives a real browser and
 * sails past bot protection, so "we captured it" tells us nothing about how the site treats a
 * crawler. Asking the same way an archiver would does. Identity stays honest — same DaylightBot
 * UA as everywhere else; the point is to be treated as what we are, not to sneak past anything.
 */
async function plainRequestStatus(url: string): Promise<number | null> {
  try {
    const res = await fetch(url, {
      headers: { "user-agent": ua() },
      redirect: "follow",
      signal: AbortSignal.timeout(15_000),
    });
    return res.status;
  } catch {
    return null;
  }
}

/**
 * Record that the Internet Archive was turned away by a site, when — and only when — Save Page
 * Now says so itself.
 *
 * `spn2Failure` must be SPN2's verbatim failure. Everything else (slot limits, timeouts, 503s)
 * is the archiver having a bad day and is filtered out by originRefusedArchiver, because
 * blaming the site for those would be a fabrication.
 *
 * Severity follows the evidence, not the vibe: a site with NO capture anywhere is a real
 * preservation gap (`high`); a site the Archive already holds copies of has only become harder
 * to capture (`notable`). Idempotent — a standing refusal is reported once, not every sweep.
 */
export async function recordArchiverRefusal(
  db: DaylightDb,
  host: string,
  spn2Failure: string,
  opts: RefusalOptions = {},
): Promise<number | null> {
  const status = originRefusedArchiver(spn2Failure);
  if (!status) return null; // not the origin refusing — nothing to say about the site

  const now = opts.now ?? nowIso();
  const pageUrl = `https://${host}/`;
  const existing = await countCaptures(pageUrl);
  // Can't count ⇒ can't characterise the consequence ⇒ say nothing. "We couldn't reach CDX"
  // must never surface as "nothing has preserved this site".
  if (existing === null) {
    opts.log?.(`[receipts] ${host}: archiver refused (HTTP ${status}) but capture count unknown — not recording`);
    return null;
  }

  // Whether the site publishes a directive is part of the claim, so read it rather than assume.
  const prevPolicy = db.latestObservation("receipts", policyKey(host));
  const declared = prevPolicy
    ? ((JSON.parse(prevPolicy.payload_json) as { blocks?: DeclaredBlock[] }).blocks ?? [])
    : [];
  const robotsDisallowsArchiver = prevPolicy ? declared.length > 0 : undefined;

  // Strip only our own "error:<code>: " prefix, not the first colon in SPN2's sentence.
  const message = spn2Failure.replace(/^error:[a-z-]+:\s*/i, "");
  const refusedUrl = refusedUrlFrom(spn2Failure, host);

  // The control: does the refusing server also turn away OUR plain request? Without this the
  // report implies the site singles out the Archive, which for every case seen so far is untrue.
  const probeUrl = refusedUrl ?? pageUrl;
  const probe = opts.probe ?? plainRequestStatus;
  const ourStatus = await probe(probeUrl);
  const refusesOurPlainRequest = ourStatus === null ? undefined : ourStatus === Number(status);

  const refusal = {
    status,
    existingCaptures: existing,
    archiveMessage: message,
    refusedUrl,
    refusesOurPlainRequest,
    robotsDisallowsArchiver,
  };
  const contentHash = sha256(
    JSON.stringify([status, existing === 0, robotsDisallowsArchiver, refusesOurPlainRequest, refusedUrl ?? null]),
  );
  const { inserted } = db.insertObservation({
    module: "receipts",
    domain: refusalKey(host),
    observedAt: now,
    sourceUrl: `https://web.archive.org/save/${pageUrl}`,
    contentHash,
    payload: { host, ...refusal, spn2Failure, weCapturedOk: opts.weCapturedOk },
  });
  if (!inserted) return null; // same situation as last time

  const id = db.insertChange({
    module: "receipts",
    domain: host,
    detectedAt: now,
    kind: "added",
    field: "archiver_refused",
    oldValue: null,
    newValue: `HTTP ${status} to the Internet Archive`,
    // A site that refuses every automated client is a preservation problem, not a story about
    // the Archive — so it never outranks 'notable' however few copies exist.
    severity: existing === 0 && refusesOurPlainRequest !== true ? "high" : "notable",
    reason: describeObservedRefusal(refusal, host, now),
    // The Archive's own save endpoint: anyone can re-run it and see the same refusal.
    sourceUrl: `https://web.archive.org/save/${pageUrl}`,
  } satisfies Change);
  opts.log?.(
    `[receipts] ${host}: Internet Archive refused (HTTP ${status}); ${existing} existing capture(s) — recorded`,
  );
  return id;
}
