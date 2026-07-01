import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import type { ScorecardRow } from "@/lib/data";
import { floodlightScorecards, scorecardCount } from "@/lib/data";
import { flags } from "@/lib/flags";
import { EmptyState, Panel, SeverityBadge, Timestamp } from "@/components/ui";

export const metadata: Metadata = { title: "Floodlight" };
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
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Floodlight</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          &ldquo;Is this gov site tracking me?&rdquo; — a scorecard of third-party trackers,
          session-replay tools, the reverse-proxy disguise trick, and whether the page even has a
          privacy notice. Passive, public-page loads only. {total.toLocaleString()} pages scored.
        </p>
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
                        <span className="truncate font-mono text-sm text-ink">{r.url}</span>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                        <span className="text-muted">{r.tracker_count ?? 0} trackers</span>
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
                          {trackers.map((t, i) => (
                            <span
                              key={`${t.vendor}-${i}`}
                              className={`rounded border px-1.5 py-0.5 font-mono text-[10px] ${t.firstPartyProxied ? "border-alarm/50 text-alarm" : "border-edge text-muted"}`}
                              title={`${t.category} · ${t.host}`}
                            >
                              {t.vendor}
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
        <Link href="/floodlight/feed.xml" className="text-signal hover:text-ink">
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
