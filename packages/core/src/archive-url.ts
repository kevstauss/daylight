// Reading a Wayback URL. Lives in core because the rule it encodes — an archive is dated by
// its OWN capture time, never by the row that happens to hold the link — is a provenance rule
// that the workers (which write archives) and the web read path (which renders their dates)
// must agree on exactly. Two copies of this regex is two chances to disagree about what a
// receipt claims.

/** A real receipt is pinned to a capture instant. A bare https://web.archive.org/web/<url>
 *  resolves to the Archive's MOST RECENT capture, so it shows the page's current state — the
 *  opposite of evidence about the past. */
const PINNED_RE = /^https:\/\/web\.archive\.org\/web\/(\d{14})\//;

export function isTimestampedArchiveUrl(url: string): boolean {
  return PINNED_RE.test(url);
}

/** Wayback/CDX stamps are YYYYMMDDHHMMSS in UTC. */
export function cdxTsToIso(ts: string): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(ts);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  const iso = `${y}-${mo}-${d}T${h}:${mi}:${s}.000Z`;
  return Number.isNaN(new Date(iso).getTime()) ? null : iso;
}

export function isoToCdxTs(iso: string): string | null {
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : new Date(t).toISOString().replace(/[-:T]/g, "").slice(0, 14);
}

/** When the Internet Archive actually captured this page, read off a pinned archive URL. */
export function archiveTimestamp(waybackUrl: string): string | null {
  const m = PINNED_RE.exec(waybackUrl);
  return m?.[1] ? cdxTsToIso(m[1]) : null;
}

/** Minutes between an archive's capture and the observation it is offered as evidence for.
 *  Null when either side is unreadable. Callers surface this rather than hiding it: an archive
 *  taken six hours from what we looked at is still evidence, just weaker and dated as such. */
export function archiveDriftMinutes(waybackUrl: string, observedAtIso: string): number | null {
  const archived = archiveTimestamp(waybackUrl);
  if (!archived) return null;
  const a = new Date(archived).getTime();
  const o = new Date(observedAtIso).getTime();
  if (Number.isNaN(a) || Number.isNaN(o)) return null;
  return Math.round(Math.abs(a - o) / 60_000);
}
