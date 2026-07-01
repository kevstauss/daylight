import type { Severity, Watchlist } from "@daylight/core";
import { registrableApex, splitLabels } from "./labels.js";

const SEV_ORDER: Record<Severity, number> = { info: 0, notable: 1, high: 2 };

// H3 — collection/inference infrastructure labels (a subset of the high-signal set).
const INFRA_LABELS = new Set(["analytics", "metrics", "infra", "inference"]);

export interface ScoreResult {
  fqdn: string;
  apex: string;
  labels: string[];
  onWatchlist: boolean;
  severity: Severity;
  reason: string;
}

/**
 * H2 mimic tokens: a label token → the function domain it imitates. Built from the
 * watched apex names + comparator keys so no function name is hardcoded. e.g.
 * "vote"/"vote-gov" → vote.gov, "passports"/"passport" → passports.gov, "freedom" → freedom.gov.
 */
export function buildMimicTokens(wl: Watchlist): Map<string, string> {
  const tokens = new Map<string, string>();
  const sources = new Set<string>([...wl.apexDomains, ...Object.keys(wl.comparators)]);
  for (const raw of sources) {
    const domain = raw.toLowerCase();
    const label0 = domain.split(".")[0];
    if (!label0) continue;
    const functionDomain = domain.includes(".") ? domain : wl.comparators[domain] ?? `${domain}.gov`;
    const add = (t: string) => {
      if (t && !tokens.has(t)) tokens.set(t, functionDomain);
    };
    add(label0);
    add(`${label0}-gov`);
    if (label0.endsWith("s")) add(label0.slice(0, -1)); // passports → passport
  }
  return tokens;
}

interface Candidate {
  severity: Severity;
  reason: string;
  rank: number;
}

/**
 * Score a subdomain against the watchlist (spec §5):
 *  H2 function-mimic (flagship) > H3 collection/inference infra > H1 high-signal label > notable.
 * `ownerLabel` (from Ledger enrichment) is woven into the H2 reason when provided.
 */
export function scoreSubdomain(fqdn: string, wl: Watchlist, ownerLabel?: string | null): ScoreResult {
  const f = fqdn.toLowerCase();
  const apex = registrableApex(f);
  const labels = splitLabels(f, apex);
  const onWatchlist = wl.apexDomains.includes(apex) || wl.subdomainApexes.includes(apex);
  const candidates: Candidate[] = [];
  const ownerSuffix = ownerLabel ? ` (${ownerLabel})` : "";

  // H2 — function-mimic: a label imitates another agency's function under a non-owning apex.
  const tokens = buildMimicTokens(wl);
  for (const label of labels) {
    const functionDomain = tokens.get(label);
    if (functionDomain && registrableApex(functionDomain) !== apex) {
      candidates.push({
        severity: "high",
        reason: `looks like ${functionDomain} hosted under ${apex}${ownerSuffix}`,
        rank: 4,
      });
      break;
    }
  }

  // H3 — collection/inference infrastructure.
  const infra = labels.filter((l) => INFRA_LABELS.has(l));
  if (infra.length) {
    candidates.push({
      severity: "high",
      reason: `collection/inference infrastructure label${infra.length > 1 ? "s" : ""} ${infra.join(", ")} on ${apex}${ownerSuffix}`,
      rank: 3,
    });
  }

  // H1 — high-signal label.
  const high = labels.filter((l) => wl.subdomainFlags.high.includes(l));
  if (high.length) {
    candidates.push({
      severity: "high",
      reason: `high-signal subdomain label${high.length > 1 ? "s" : ""} ${high.join(", ")} on ${apex}${ownerSuffix}`,
      rank: 2,
    });
  }

  // notable — lower-signal label.
  const notable = labels.filter((l) => wl.subdomainFlags.notable.includes(l));
  if (notable.length) {
    candidates.push({
      severity: "notable",
      reason: `subdomain label${notable.length > 1 ? "s" : ""} ${notable.join(", ")} on ${apex}${ownerSuffix}`,
      rank: 1,
    });
  }

  if (candidates.length === 0) {
    return { fqdn: f, apex, labels, onWatchlist, severity: "info", reason: `new subdomain of ${apex}${ownerSuffix}` };
  }
  candidates.sort((a, b) => SEV_ORDER[b.severity] - SEV_ORDER[a.severity] || b.rank - a.rank);
  const top = candidates[0]!;
  return { fqdn: f, apex, labels, onWatchlist, severity: top.severity, reason: top.reason };
}
