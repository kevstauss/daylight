import { readFileSync } from "node:fs";
import { load } from "js-yaml";
import type { Watchlist, WatchSubscription } from "./types.js";

// Raw shape of config/watchlist.yaml (snake_case), before normalization.
interface RawWatchlist {
  apex_domains?: string[];
  subdomain_apexes?: string[];
  comparators?: Record<string, string>;
  person_watch?: string[];
  org_watch?: string[];
  suborg_watch?: string[];
  central_security_allowlist?: string[];
  subdomain_flags?: { high?: string[]; notable?: string[] };
  known_subdomains_seen?: string[];
}

const lc = (xs: string[] | undefined): string[] =>
  (xs ?? []).map((s) => s.trim().toLowerCase()).filter(Boolean);

const trimmed = (xs: string[] | undefined): string[] =>
  (xs ?? []).map((s) => s.trim()).filter(Boolean);

/** Parse and normalize `config/watchlist.yaml`. Domains lowercased; watched
 *  org/suborg strings preserve their original casing (matched case-insensitively). */
export function parseWatchlist(yamlText: string): Watchlist {
  const raw = (load(yamlText) ?? {}) as RawWatchlist;
  const comparators: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw.comparators ?? {})) {
    comparators[k.trim().toLowerCase()] = String(v).trim().toLowerCase();
  }
  return {
    apexDomains: lc(raw.apex_domains),
    subdomainApexes: lc(raw.subdomain_apexes),
    comparators,
    personWatch: trimmed(raw.person_watch),
    orgWatch: trimmed(raw.org_watch),
    suborgWatch: trimmed(raw.suborg_watch),
    centralSecurityAllowlist: lc(raw.central_security_allowlist),
    subdomainFlags: {
      high: lc(raw.subdomain_flags?.high),
      notable: lc(raw.subdomain_flags?.notable),
    },
    knownSubdomainsSeen: lc(raw.known_subdomains_seen),
  };
}

/** Load and normalize the watchlist from a file path. */
export function loadWatchlist(path: string): Watchlist {
  return parseWatchlist(readFileSync(path, "utf8"));
}

/** Flatten the person/org/suborg watches into evaluatable subscriptions. */
export function watchSubscriptions(wl: Watchlist): WatchSubscription[] {
  const subs: WatchSubscription[] = [];
  for (const pattern of wl.personWatch) subs.push({ kind: "person", pattern, channel: "feed" });
  for (const pattern of wl.orgWatch) subs.push({ kind: "org", pattern, channel: "feed" });
  for (const pattern of wl.suborgWatch) subs.push({ kind: "suborg", pattern, channel: "feed" });
  return subs;
}
