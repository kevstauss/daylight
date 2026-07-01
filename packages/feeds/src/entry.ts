import type { Severity } from "@daylight/core";

/** A feed-ready change. The web layer maps persisted `changes` rows into these. */
export interface FeedEntry {
  id: string | number;
  domain: string;
  detectedAt: string; // ISO UTC
  severity: Severity;
  title: string;
  summary?: string;
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
  };
}

/** Absolute deep link to a domain's page. */
export function domainLink(siteUrl: string, domain: string): string {
  return `${siteUrl.replace(/\/+$/, "")}/domain/${encodeURIComponent(domain)}`;
}
