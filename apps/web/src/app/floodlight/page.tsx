import { notFound } from "next/navigation";
import Link from "next/link";
import type { ScorecardRow } from "@/lib/data";
import { floodlightScorecards, scorecardCount } from "@/lib/data";
import { flags } from "@/lib/flags";
import { EmptyState, Panel, SeverityBadge, Timestamp } from "@/components/ui";
import { ModuleIcon } from "@/components/module-icon";
import { pageMetadata, PAGE_DESCRIPTIONS } from "@/lib/seo";
import { JsonLd } from "@/components/json-ld";
import { breadcrumbLd, webPageLd } from "@/lib/structured-data";

export const metadata = pageMetadata({
  title: "Floodlight",
  description: PAGE_DESCRIPTIONS.floodlight,
  path: "/floodlight",
  feeds: { rss: "/floodlight/feed.xml", json: "/floodlight/feed.json" },
});
export const dynamic = "force-dynamic";

interface Tracker {
  vendor: string;
  category: string;
  host: string;
  firstPartyProxied: boolean;
}

function trackersOf(row: ScorecardRow): Tracker[] {
  try {
    return JSON.parse(row.trackers_json ?? "[]") as Tracker[];
  } catch {
    return [];
  }
}

interface VendorChip {
  vendor: string;
  category: string;
  hosts: string[];
  firstPartyProxied: boolean;
}

/**
 * The scorecard already dedupes on vendor+host, so one vendor on multiple hosts
 * appears as several entries. On the compact list that reads as a duplicate, so
 * collapse to one chip per vendor (keeping the proxied/third-party split, which
 * is a real semantic difference) and surface each distinct host in the label.
 */
function collapseVendors(trackers: Tracker[]): VendorChip[] {
  const byVendor = new Map<string, VendorChip>();
  for (const t of trackers) {
    const key = `${t.vendor}|${t.firstPartyProxied}`;
    const chip = byVendor.get(key);
    if (chip) {
      if (!chip.hosts.includes(t.host)) chip.hosts.push(t.host);
    } else {
      byVendor.set(key, {
        vendor: t.vendor,
        category: t.category,
        hosts: [t.host],
        firstPartyProxied: t.firstPartyProxied,
      });
    }
  }
  return [...byVendor.values()];
}

export default async function FloodlightPage({
  searchParams,
}: {
  searchParams: Promise<{ [k: string]: string | string[] | undefined }>;
}) {
  if (!flags().floodlight) notFound();
  const sp = await searchParams;
  const sevRaw = Array.isArray(sp.severity) ? sp.severity[0] : sp.severity;
  const severity = ["high", "notable", "info"].includes(sevRaw ?? "") ? sevRaw : undefined;

  const rows = safe(() => floodlightScorecards({ severity, limit: 100 }), []);
  const total = safe(() => scorecardCount(), 0);

  return (
    <div className="space-y-6">
      <JsonLd data={webPageLd({ type: "CollectionPage", name: "Floodlight", description: PAGE_DESCRIPTIONS.floodlight, path: "/floodlight" })} />
      <JsonLd data={breadcrumbLd([{ name: "Daylight", path: "/" }, { name: "Floodlight", path: "/floodlight" }])} />
      <div>
        <div className="flex items-center gap-2.5"><ModuleIcon name="floodlight" className="h-6 w-6 shrink-0 text-ink" /><h1 className="text-2xl font-semibold tracking-tight">Floodlight</h1></div>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          &ldquo;Is this gov site tracking me?&rdquo; A scorecard of third-party trackers,
          session-replay tools, tracking disguised as the site&rsquo;s own traffic, and whether the
          page even has a privacy notice. Passive, public-page loads only. {total.toLocaleString()} pages scored.
        </p>
        {flags().floodlightScan ? (
          <Link
            href="/floodlight/scan"
            className="mt-3 inline-block rounded border border-edgeStrong bg-panel px-3 py-1.5 font-mono text-xs text-ink transition-colors hover:border-ink"
          >
            Scan a URL →
          </Link>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="No scorecards yet."
          hint="The analysis engine is live and fixture-tested; the live page-capture scanner is pending a scheduler/host decision. Once a URL is scanned, its scorecard appears here."
        />
      ) : (
        <Panel>
          <ul className="divide-y divide-edge">
            {rows.map((r) => {
              const trackers = trackersOf(r);
              return (
                <li key={r.url} className="px-4 py-3">
                  <div className="flex items-start gap-3">
                    <SeverityBadge severity={r.severity ?? "info"} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <Link
                          href={`/floodlight/${encodeURIComponent(r.url)}`}
                          className="truncate font-mono text-sm text-ink underline decoration-transparent underline-offset-2 hover:decoration-alarm"
                        >
                          {r.url}
                        </Link>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                        <span className="text-muted">{r.tracker_count ?? 0} tracker{(r.tracker_count ?? 0) === 1 ? "" : "s"}</span>
                        <span className={r.session_replay ? "text-alarm" : "text-faint"}>
                          session replay {r.session_replay ? "ON" : "off"}
                        </span>
                        <span className={r.first_party_proxied ? "text-alarm" : "text-faint"}>
                          reverse-proxy {r.first_party_proxied ? "detected" : "no"}
                        </span>
                        <span className={r.privacy_notice_url ? "text-faint" : "text-signal"}>
                          privacy notice {r.privacy_notice_url ? "present" : "absent"}
                        </span>
                        <Timestamp iso={r.scanned_at} prefix="scanned" />
                      </div>
                      {trackers.length > 0 ? (
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {collapseVendors(trackers).map((t) => (
                            <span
                              key={`${t.vendor}-${t.firstPartyProxied}`}
                              className={`rounded border px-1.5 py-0.5 font-mono text-[10px] ${t.firstPartyProxied ? "border-alarm/50 text-alarm" : "border-edge text-muted"}`}
                              // Same vendor on multiple hosts collapses to "vendor ×N" (each host is a
                              // distinct endpoint, not a duplicate). Don't signal the reverse-proxy
                              // disguise by color alone (WCAG 1.4.1): a visible "· proxied" marker + an
                              // aria-label carrying category and every host.
                              aria-label={`${t.vendor}${t.firstPartyProxied ? ", reverse-proxied first-party analytics" : ""} — ${t.category}, on ${t.hosts.length} host${t.hosts.length === 1 ? "" : "s"}: ${t.hosts.join(", ")}`}
                              title={`${t.category} · ${t.hosts.join(", ")}${t.firstPartyProxied ? " · reverse-proxied" : ""}`}
                            >
                              {t.vendor}
                              {t.hosts.length > 1 ? <span aria-hidden="true"> ×{t.hosts.length}</span> : null}
                              {t.firstPartyProxied ? <span aria-hidden="true"> · proxied</span> : null}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </Panel>
      )}

      <p className="text-xs text-faint">
        <Link href="/floodlight/feed.xml" className="link">
          Tracker-change feed (RSS) →
        </Link>
      </p>
    </div>
  );
}

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}
