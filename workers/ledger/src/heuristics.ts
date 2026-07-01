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

  // H3 — new federal domain.
  if (change.kind === "added" && /^federal/i.test(rec.domainType)) {
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

  if (candidates.length === 0) return { severity: "info", reason: undefined };
  candidates.sort((a, b) => SEV_ORDER[b.severity] - SEV_ORDER[a.severity] || b.rank - a.rank);
  const top = candidates[0]!;
  return { severity: top.severity, reason: top.reason };
}
