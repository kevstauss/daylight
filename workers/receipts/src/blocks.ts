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
