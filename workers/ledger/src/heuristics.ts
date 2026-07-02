import type { Change, DomainRecord, Severity, Watchlist } from "@daylight/core";
import { emailDomain, matchesAny } from "./text.js";

const SEV_ORDER: Record<Severity, number> = { info: 0, notable: 1, high: 2 };

export interface ContactMismatch {
  contactDomain: string;
  severity: Severity;
  reason: string;
}

/** Resolves the Organization name for a registered apex `.gov`, or null if unknown. */
export type OrgResolver = (domain: string) => string | null;

/** The registrable unit for a .gov is its last two labels (e.g. samhsa.hhs.gov → hhs.gov). */
export function registrableApex(domain: string): string {
  const parts = domain.toLowerCase().split(".").filter(Boolean);
  return parts.length <= 2 ? domain.toLowerCase() : parts.slice(-2).join(".");
}

const normalizeOrg = (org: string | null): string =>
  (org ?? "").trim().toLowerCase().replace(/\s+/g, " ");

/**
 * H1 — contact-domain mismatch (flagship). A security-contact email whose domain is
 * foreign to the row's own domain is a candidate. We deliberately clear the legitimate
 * cases so the flags stay sober and press-credible:
 *   - the contact's own apex, or a recognized central mailbox (allowlist);
 *   - a contact at another domain owned by the SAME organization (e.g. vote.gov →
 *     @eac.gov, both Election Assistance Commission) — cleared when `orgOf` resolves it.
 * What survives is a genuine cross-organization mismatch. It escalates to "high" when the
 * contact domain is itself a watchlisted product .gov (like ndstudio.gov) — which catches
 * the Bobba finding (usadf.gov → akash@ndstudio.gov) structurally, no name hardcoded.
 */
export function contactDomainMismatch(
  rec: DomainRecord,
  wl: Watchlist,
  orgOf?: OrgResolver,
): ContactMismatch | null {
  const d = emailDomain(rec.securityContactEmail);
  if (!d) return null;
  const dApex = registrableApex(d);
  if (d === rec.domain || dApex === rec.domain) return null; // own apex (or a subdomain of it)
  if (wl.centralSecurityAllowlist.includes(d) || wl.centralSecurityAllowlist.includes(dApex)) {
    return null; // recognized central mailbox
  }

  // Same-organization inter-domain contact is legitimate — clear it when resolvable.
  if (orgOf) {
    const contactOrg = orgOf(d) ?? orgOf(dApex);
    if (contactOrg && normalizeOrg(contactOrg) === normalizeOrg(rec.org)) return null;
  }

  const watchedProduct = wl.apexDomains.includes(d) || wl.apexDomains.includes(dApex);
  const severity: Severity = watchedProduct ? "high" : "notable";
  const org = rec.org && rec.org.trim() ? rec.org.trim() : "unknown organization";
  const reason = `security contact is @${d}, foreign to ${rec.domain} (${org})`;
  return { contactDomain: d, severity, reason };
}

interface Candidate {
  severity: Severity;
  reason: string;
  rank: number; // tie-break within a severity; higher = more headline-worthy
}

/**
 * Apply H1–H4 to a raw change and return the final severity + human reason.
 * Highest severity wins; H1's contact story is the headline on ties.
 */
export function classifyChange(
  change: Change,
  rec: DomainRecord,
  wl: Watchlist,
  orgOf?: OrgResolver,
): { severity: Severity; reason: string | undefined } {
  const candidates: Candidate[] = [];
  const isContactChange = change.kind === "modified" && change.field === "securityContactEmail";

  // H3 — new federal *executive* domain (exact type per §5.5; excludes Legislative/Judicial).
  if (change.kind === "added" && rec.domainType.trim().toLowerCase() === "federal - executive") {
    candidates.push({
      severity: "notable",
      reason: `new federal domain: ${rec.domain} (${rec.org || "unknown organization"})`,
      rank: 1,
    });
  }

  // H2 — org / suborg watch.
  const orgMatch = matchesAny(rec.org, wl.orgWatch);
  const suborgMatch = matchesAny(rec.suborg, wl.suborgWatch);
  if (change.kind === "added" && (orgMatch || suborgMatch)) {
    const kind = orgMatch ? "organization" : "suborganization";
    candidates.push({
      severity: "high",
      reason: `watched ${kind} "${orgMatch ?? suborgMatch}" on new domain ${rec.domain}`,
      rank: 3,
    });
  } else if (
    change.kind === "modified" &&
    ((change.field === "org" && orgMatch) || (change.field === "suborg" && suborgMatch))
  ) {
    candidates.push({
      severity: "notable",
      reason: `${rec.domain} changed into watched ${change.field} "${orgMatch ?? suborgMatch}"`,
      rank: 3,
    });
  }

  // H1 — contact-domain mismatch (on add or contact change).
  const mismatch =
    change.kind === "added" || isContactChange ? contactDomainMismatch(rec, wl, orgOf) : null;
  if (mismatch) {
    candidates.push({ severity: mismatch.severity, reason: mismatch.reason, rank: 4 });
  }

  // H4 — contact change on a watchlisted / flagged domain.
  if (isContactChange) {
    const watchlisted = wl.apexDomains.includes(rec.domain);
    if (watchlisted || mismatch) {
      const severity: Severity = mismatch && mismatch.severity === "high" ? "high" : "notable";
      const reason = mismatch
        ? mismatch.reason
        : `security contact on watched domain ${rec.domain} changed to ${rec.securityContactEmail ?? "(blank)"}`;
      candidates.push({ severity, reason, rank: 2 });
    }
  }

  // H5 — a removal is the "quietly vanished" signal Receipts is built around; Ledger should treat
  // its OWN removals with weight, not bury them as unranked info. A watchlisted apex dropping out
  // of the registry is high; any other removal is at least notable. (rec here is the PREVIOUS
  // record — a removed domain has no current row, so the caller passes prior state.)
  const org = rec.org && rec.org.trim() ? rec.org.trim() : "unknown organization";
  if (change.kind === "removed") {
    const watchlisted = wl.apexDomains.includes(rec.domain);
    candidates.push({
      severity: watchlisted ? "high" : "notable",
      reason: watchlisted
        ? `watchlisted domain ${rec.domain} was removed from the federal registry (${org})`
        : `${rec.domain} was removed from the federal registry (${org})`,
      rank: 5,
    });
  } else if (wl.apexDomains.includes(rec.domain)) {
    // H5 floor — any change touching a watchlisted apex is at least notable (never silent info).
    // Lowest rank, so a more specific H1–H4 reason always wins the tie; this only raises info.
    candidates.push({
      severity: "notable",
      reason:
        change.kind === "modified" && change.field
          ? `${change.field} changed on watchlisted domain ${rec.domain}`
          : `change on watchlisted domain ${rec.domain}`,
      rank: 0,
    });
  }

  if (candidates.length === 0) return { severity: "info", reason: undefined };
  candidates.sort((a, b) => SEV_ORDER[b.severity] - SEV_ORDER[a.severity] || b.rank - a.rank);
  const top = candidates[0]!;
  return { severity: top.severity, reason: top.reason };
}

/** Sentinel-domain prefix for the concentration idempotency observation (keyed by contact apex),
 *  so a stable concentration is reported once — not re-emitted on every run. Shared by the daily
 *  run and the git-history backfill. */
export const CONCENTRATION_SENTINEL = "__ledger_concentration__:";

/** One contact apex that is the security-contact-of-record for multiple DISTINCT organizations. */
export interface ContactConcentration {
  contactApex: string; // e.g. "ndstudio.gov"
  orgs: string[]; // the distinct owning organizations it is the contact for
  domains: string[]; // the .gov domains sharing this foreign contact
}

/**
 * Cross-record concentration heuristic. contactDomainMismatch (H1) is per-row; this is the
 * complementary AGGREGATE: it groups the full current registry by the registrable apex of each
 * row's security contact and flags when ONE foreign, non-allowlisted contact apex is the
 * security-contact-of-record for `minOrgs`+ DISTINCT owning organizations.
 *
 * That structural signature — one small office quietly becoming the security contact across
 * several unrelated agencies — is the 5 U.S.C. §3161 takeover pattern, and it reproduces the
 * Bobba finding (akash@ndstudio.gov) *without* a hand-added watchlist entry. Same-apex contacts
 * (a domain listing its own apex), allowlisted central mailboxes, and single-org clusters are
 * excluded so a normal shared-services contact never trips it.
 */
export function contactConcentration(
  records: DomainRecord[],
  wl: Watchlist,
  minOrgs = 3,
): ContactConcentration[] {
  const groups = new Map<string, { orgs: Map<string, string>; domains: Set<string> }>();
  for (const rec of records) {
    const d = emailDomain(rec.securityContactEmail);
    if (!d) continue;
    const apex = registrableApex(d);
    if (apex === registrableApex(rec.domain)) continue; // the domain's own apex — not foreign
    if (wl.centralSecurityAllowlist.includes(d) || wl.centralSecurityAllowlist.includes(apex)) {
      continue; // recognized central mailbox — legitimately shared, never a concentration
    }
    let g = groups.get(apex);
    if (!g) {
      g = { orgs: new Map(), domains: new Set() };
      groups.set(apex, g);
    }
    const orgKey = normalizeOrg(rec.org);
    if (orgKey) g.orgs.set(orgKey, rec.org.trim());
    g.domains.add(rec.domain);
  }

  const out: ContactConcentration[] = [];
  for (const [apex, g] of groups) {
    if (g.orgs.size >= minOrgs) {
      out.push({ contactApex: apex, orgs: [...g.orgs.values()], domains: [...g.domains].sort() });
    }
  }
  return out.sort((a, b) => b.orgs.length - a.orgs.length || a.contactApex.localeCompare(b.contactApex));
}
