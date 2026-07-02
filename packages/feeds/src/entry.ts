import type { Severity } from "@daylight/core";

/** A feed-ready change. The web layer maps persisted `changes` rows into these. */
export interface FeedEntry {
  id: string | number;
  domain: string;
  detectedAt: string; // ISO UTC
  severity: Severity;
  title: string;
  summary?: string;
  /** Canonical permalink for this item (relative or absolute). Defaults to the domain page when
   *  unset; change-based entries point at their /change/{id} permalink for precise citation. */
  link?: string;
  /** The exact public source artifact (commit blob / crt.sh / wayback) — a "source →" link. */
  sourceUrl?: string | null;
}

export interface FeedMeta {
  title: string;
  description: string;
  siteUrl: string; // absolute origin, no trailing slash, e.g. "https://daylight.example"
  feedUrl: string; // absolute URL of this feed document
}

/** Structural shape of a persisted `changes` row (no @daylight/db dependency here). */
export interface ChangeLike {
  id: number | string;
  domain: string;
  detected_at: string;
  kind: string;
  field: string | null;
  old_value: string | null;
  new_value: string | null;
  severity: string;
  reason: string | null;
  source_url?: string | null;
}

const asSeverity = (s: string): Severity =>
  s === "high" || s === "notable" ? s : "info";

const short = (v: string | null): string =>
  v === null || v === "" ? "(none)" : v;

/** Human title for a change: prefer the worker's `reason`, else synthesize one. */
export function synthesizeTitle(c: ChangeLike): string {
  if (c.reason && c.reason.trim()) return c.reason.trim();
  switch (c.kind) {
    case "added":
      return `New domain: ${c.domain}`;
    case "removed":
      return `Domain removed: ${c.domain}`;
    case "modified":
      return c.field
        ? `${c.field} changed on ${c.domain}: ${short(c.old_value)} → ${short(c.new_value)}`
        : `${c.domain} changed`;
    default:
      return `${c.domain} changed`;
  }
}

/** Map a persisted change row into a feed entry. */
export function changeToEntry(c: ChangeLike): FeedEntry {
  return {
    id: c.id,
    domain: c.domain,
    detectedAt: c.detected_at,
    severity: asSeverity(c.severity),
    title: synthesizeTitle(c),
    summary: c.reason ?? undefined,
    link: `/change/${c.id}`,
    sourceUrl: c.source_url ?? undefined,
  };
}

/** Absolute deep link to a domain's page. */
export function domainLink(siteUrl: string, domain: string): string {
  return `${siteUrl.replace(/\/+$/, "")}/domain/${encodeURIComponent(domain)}`;
}

/** The canonical link for a feed item: its explicit permalink (resolved against the origin) or,
 *  when unset, the domain page. */
export function entryLink(siteUrl: string, e: FeedEntry): string {
  const site = siteUrl.replace(/\/+$/, "");
  if (!e.link) return domainLink(site, e.domain);
  return /^https?:\/\//i.test(e.link) ? e.link : `${site}${e.link.startsWith("/") ? "" : "/"}${e.link}`;
}
