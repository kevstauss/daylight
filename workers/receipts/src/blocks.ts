// "Does this site tell archivers to stay away?" — read from the one place a site DECLARES its
// crawl policy: robots.txt.
//
// THE LINE THIS MODULE HOLDS. A federal site instructing the Internet Archive not to preserve it
// is a real, quotable, re-verifiable fact. A federal site behind Akamai or Cloudflare that
// intermittently 403s the archiver is NOT the same thing, and must never be reported as though
// it were:
//
//   - trumpaccounts.gov has 702 Internet Archive captures and no robots.txt at all. It returns
//     403 to roughly 1 attempt in 6. Calling that "blocking the Internet Archive" would be
//     false — the Archive holds hundreds of copies of it.
//   - moms.gov sits behind Akamai, which denied even a robots.txt request, while the Archive
//     still holds 148 captures of it.
//
// Bot protection is a hosting default that an agency press office has very likely never seen.
// A robots.txt directive naming an archiver is a decision someone made and wrote down. Only the
// second is evidence of intent, so only the second is reported as a declared block. The
// behavioural signal is recorded as what it literally is — "no successful capture in N days" —
// and never as a motive.

/** UA tokens that mean "the Internet Archive's crawler" in a robots.txt. */
const ARCHIVER_AGENTS = ["ia_archiver", "ia_archiver-web.archive.org", "archive.org_bot", "wayback"];
/** Us. A site telling Daylight specifically to go away is worth stating plainly. */
const DAYLIGHT_AGENTS = ["daylightbot"];

export type BlockedParty = "internet-archive" | "daylight";

export interface DeclaredBlock {
  party: BlockedParty;
  /** The robots.txt User-agent token that carries the directive. */
  userAgent: string;
  /** The exact Disallow line — quoted verbatim so the claim is checkable, never paraphrased. */
  directive: string;
}

interface Group {
  agents: string[];
  disallows: string[];
}

/** Parse robots.txt into user-agent groups. Consecutive User-agent lines share one rule block. */
function parseGroups(robotsTxt: string): Group[] {
  const groups: Group[] = [];
  let current: Group | null = null;
  let expectingAgents = false;

  for (const raw of robotsTxt.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();

    if (field === "user-agent") {
      if (!current || !expectingAgents) {
        current = { agents: [], disallows: [] };
        groups.push(current);
        expectingAgents = true;
      }
      current.agents.push(value.toLowerCase());
    } else if (field === "disallow") {
      if (!current) continue;
      expectingAgents = false;
      current.disallows.push(value);
    } else {
      expectingAgents = false;
    }
  }
  return groups;
}

/** Does this group actually forbid the whole site? `Disallow: /` does; `Disallow:` (empty) is
 *  the opposite — it explicitly ALLOWS everything — and a path-scoped rule is housekeeping, not
 *  a refusal to be archived. Only a site-wide refusal is reported. */
const forbidsEverything = (g: Group): string | null =>
  g.disallows.find((d) => d === "/") ?? null;

/**
 * Archiver-blocking directives a site has DECLARED in its robots.txt.
 *
 * Returns only site-wide `Disallow: /` rules aimed at a named archiver (or at us). A wildcard
 * `User-agent: *` block is deliberately NOT reported: it is a blanket crawl policy, not a
 * decision about preservation, and reading intent into it would be exactly the overclaim this
 * module exists to prevent.
 */
export function declaredBlocks(robotsTxt: string): DeclaredBlock[] {
  const out: DeclaredBlock[] = [];
  for (const g of parseGroups(robotsTxt)) {
    const rule = forbidsEverything(g);
    if (!rule) continue;
    for (const agent of g.agents) {
      const party: BlockedParty | null = ARCHIVER_AGENTS.includes(agent)
        ? "internet-archive"
        : DAYLIGHT_AGENTS.includes(agent)
          ? "daylight"
          : null;
      if (!party) continue;
      out.push({ party, userAgent: agent, directive: `User-agent: ${agent} / Disallow: ${rule}` });
    }
  }
  return out;
}

/** Neutral, quotable copy for a declared block. States what the file says and when we read it —
 *  never why, never "they are hiding something". The robots.txt URL is the source link, so any
 *  reader can check it themselves. */
export function describeDeclaredBlock(b: DeclaredBlock, domain: string, observedAt: string): string {
  const who = b.party === "internet-archive" ? "the Internet Archive's crawler" : "Daylight's crawler";
  const date = observedAt.slice(0, 10);
  return `${domain}/robots.txt instructs ${who} (${b.userAgent}) not to crawl the site as of ${date} — "${b.directive}". Public archiving of this site is disallowed by the site's own published crawl policy.`;
}

// ---- Observed refusal (distinct from a declared one) ---------------------------------------
//
// Save Page Now tells us, in its own words, when an origin turns its crawler away:
//   "The target server blocks access to https://techprosperitycorps.gov/. (HTTP status=403)"
//
// This is NOT a declared block and must never be described as one — nothing was published, and
// we cannot see whether it is a deliberate policy or a CDN default nobody reviewed. But it is a
// hard, checkable fact with real consequences: as of this writing techprosperitycorps.gov has
// zero captures in the Wayback Machine, so a federal site exists that nothing has preserved.
//
// The report therefore quotes the Archive rather than characterising the site, and the wording
// stays on what happened ("the Archive is unable to capture it") rather than on intent
// ("they are blocking archiving"). The bar is deliberately narrow: SPN2 must explicitly report
// the origin refusing its crawler. An intermittent 403 on a site the Archive holds hundreds of
// copies of — trumpaccounts.gov, ~1 attempt in 6 — is a flaky edge, not a refusal, which is why
// the caller also weighs how many captures actually exist.

/** SPN2's message when the ORIGIN turned its crawler away, as opposed to SPN2 itself failing. */
const ORIGIN_REFUSED_RE = /target server blocks access.*HTTP status=(4\d\d)/i;

/** The origin's HTTP status when Save Page Now reports the site refused it — else null. */
export function originRefusedArchiver(spn2Failure: string): string | null {
  return ORIGIN_REFUSED_RE.exec(spn2Failure)?.[1] ?? null;
}

export interface ObservedRefusal {
  /** The origin's status to the archiver, per SPN2 (e.g. "403"). */
  status: string;
  /** Captures the Archive already holds. 0 means nothing anywhere has preserved this site. */
  existingCaptures: number;
  /** The Internet Archive's own message, quoted verbatim. */
  archiveMessage: string;
  /** Did OUR capture of the page succeed in the same run? Evidence the site serves ordinary
   *  requests and the 403 is specific to the archiver. Omit when we didn't get that far. */
  weCapturedOk?: boolean;
  /** Does the site's robots.txt disallow an archiver? Omit when robots.txt was unreadable —
   *  "we couldn't read it" is not "it permits archiving". */
  robotsDisallowsArchiver?: boolean;
}

/**
 * Copy for an observed refusal, assembled ONLY from facts the caller actually established.
 *
 * Every clause here is load-bearing and conditional on purpose. An earlier draft hardcoded "the
 * site serves ordinary requests normally, and its robots.txt does not disallow archivers" into
 * the sentence — true for the site that prompted it, and an unverified assertion for every other
 * site. A claim string must never state a fact the caller did not check.
 *
 * Language is graded by evidence: no archived copy at all is a preservation gap; a site the
 * Archive already holds copies of has merely become harder to capture.
 */
export function describeObservedRefusal(r: ObservedRefusal, domain: string, observedAt: string): string {
  const date = observedAt.slice(0, 10);
  const parts = [
    `The Internet Archive was unable to capture ${domain} as of ${date}: its Save Page Now service reports ` +
      `"${r.archiveMessage}" (HTTP ${r.status} to the Archive's crawler).`,
  ];
  if (r.weCapturedOk) parts.push(`${domain} served Daylight's own request for the same page normally.`);
  if (r.robotsDisallowsArchiver === false) parts.push(`Its robots.txt does not disallow archivers.`);
  parts.push(
    r.existingCaptures === 0
      ? `The Wayback Machine holds no capture of this site, so no independent public copy of it exists.`
      : `The Wayback Machine holds ${r.existingCaptures.toLocaleString()} earlier capture(s) of this site.`,
  );
  return parts.join(" ");
}
