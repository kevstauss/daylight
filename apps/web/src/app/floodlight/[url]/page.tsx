import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { sha256 } from "@daylight/core";
import { type ChangeRow, floodlightScorecard, floodlightUrlChanges } from "@/lib/data";
import { flags } from "@/lib/flags";
import { configuredSiteUrl } from "@/lib/site";
import { pageMetadata } from "@/lib/seo";
import { Eyebrow, InternalLink, Panel, SeverityBadge, SourceRef, Timestamp } from "@/components/ui";
import { CiteBlock } from "@/components/cite-block";
import { JsonLd } from "@/components/json-ld";
import { breadcrumbLd } from "@/lib/structured-data";
import { ModuleIcon } from "@/components/module-icon";

export const dynamic = "force-dynamic";

// The App Router already URL-decodes the param; decoding again throws URIError on a bare '%'.
// Idempotent for real URLs and never throws (same rule as /domain/[name]).
function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** The URL as humans write it — scheme and trailing slash stripped — for titles/breadcrumbs. */
const shortUrl = (u: string): string => u.replace(/^https?:\/\//, "").replace(/\/$/, "");

export async function generateMetadata({
  params,
}: {
  params: Promise<{ url: string }>;
}): Promise<Metadata> {
  const { url } = await params;
  const target = safeDecode(url);
  const sc = flags().floodlight ? floodlightScorecard(target) : null;
  if (!sc) {
    // No scorecard on record — keep the resolution crawlable but out of the index.
    return pageMetadata({
      title: "Scorecard",
      description: `Daylight has no Floodlight scorecard for ${target} yet.`,
      path: `/floodlight/${encodeURIComponent(target)}`,
      noindex: true,
    });
  }
  const n = sc.tracker_count ?? 0;
  const facts = [
    `${n} third-party tracker${n === 1 ? "" : "s"}`,
    ...(sc.first_party_proxied ? ["analytics reverse-proxied through a first-party endpoint"] : []),
    ...(sc.session_replay ? ["session replay observed"] : []),
    sc.privacy_notice_url ? "privacy notice linked" : "no privacy notice linked",
  ];
  return pageMetadata({
    title: `${shortUrl(sc.url)} — tracker scorecard`,
    description: `Floodlight scorecard for ${sc.url}: ${facts.join(", ")} — observed ${sc.scanned_at.slice(0, 10)} by loading the public page once, the way a browser would.`,
    // Canonicalize on the stored URL, so any variant encoding resolves to one indexed page.
    path: `/floodlight/${encodeURIComponent(sc.url)}`,
  });
}

interface Tracker {
  vendor: string;
  category: string;
  host: string;
  path: string;
  firstPartyProxied: boolean;
}

const parseJson = <T,>(s: string | null, fallback: T): T => {
  try {
    return s ? (JSON.parse(s) as T) : fallback;
  } catch {
    return fallback;
  }
};

export default async function FloodlightUrlPage({ params }: { params: Promise<{ url: string }> }) {
  if (!flags().floodlight) notFound();
  const { url } = await params;
  const target = safeDecode(url);
  const sc = floodlightScorecard(target);
  if (!sc) notFound();

  const trackers = parseJson<Tracker[]>(sc.trackers_json, []);
  const reasons = parseJson<string[]>(sc.reasons_json, []);
  const changes = floodlightUrlChanges(target);
  const thirdParty = trackers.filter((t) => !t.firstPartyProxied);
  const firstParty = trackers.filter((t) => t.firstPartyProxied);

  return (
    <div className="space-y-6">
      <JsonLd
        data={breadcrumbLd([
          { name: "Daylight", path: "/" },
          { name: "Floodlight", path: "/floodlight" },
          { name: shortUrl(sc.url), path: `/floodlight/${encodeURIComponent(sc.url)}` },
        ])}
      />
      <div>
        <div className="flex items-center gap-2.5">
          <ModuleIcon name="floodlight" className="h-6 w-6 shrink-0 text-ink" />
          <Eyebrow>floodlight · scorecard</Eyebrow>
        </div>
        <h1 className="mt-1 break-all font-mono text-xl font-semibold tracking-tight text-ink">{sc.url}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
          <SeverityBadge severity={sc.severity ?? "info"} />
          <span className="font-mono text-xs text-faint">
            {sc.tracker_count ?? 0} third-party tracker{(sc.tracker_count ?? 0) === 1 ? "" : "s"} · {sc.request_count ?? 0} request{(sc.request_count ?? 0) === 1 ? "" : "s"} · scanned{" "}
            <Timestamp iso={sc.scanned_at} />
          </span>
          <InternalLink href={`/domain/${encodeURIComponent(sc.domain)}`}>
            <span className="font-mono text-xs">{sc.domain}</span>
          </InternalLink>
        </div>
      </div>

      {/* Flags — each means "bad when present" */}
      <div className="flex flex-wrap gap-2 text-xs">
        <Flag on={!!sc.first_party_proxied} label="Reverse-proxy disguise" />
        <Flag on={!!sc.session_replay} label="Session replay" />
        <Flag on={!sc.privacy_notice_url} label="No privacy notice" />
      </div>

      {reasons.length > 0 ? (
        <Panel className="px-4 py-3">
          <Eyebrow>why it's flagged</Eyebrow>
          <ul className="mt-1.5 list-disc space-y-1 pl-5 text-sm text-muted">
            {reasons.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </Panel>
      ) : null}

      <TrackerTable title="First-party reverse-proxied endpoints" rows={firstParty} />
      <TrackerTable title="Third-party trackers" rows={thirdParty} />

      <section>
        <Eyebrow>privacy notice</Eyebrow>
        <p className="mt-1 text-sm text-muted">
          {sc.privacy_notice_url ? (
            <>
              Linked: <span className="break-all font-mono text-xs text-ink">{sc.privacy_notice_url}</span>
            </>
          ) : (
            "No privacy notice was linked from this page."
          )}
        </p>
      </section>

      {changes.length > 0 ? (
        <section>
          <Eyebrow>tracker changes over time</Eyebrow>
          <Panel className="mt-1 divide-y divide-edge">
            {changes.map((c: ChangeRow) => (
              <div key={c.id} className="flex items-start gap-3 px-4 py-2.5">
                <SeverityBadge severity={c.severity} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-ink">{c.reason ?? `${c.kind} tracker`}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3">
                    <Timestamp iso={c.detected_at} />
                    <SourceRef href={c.source_url} />
                    <a
                      href={`/change/${c.id}`}
                      className="font-mono text-xs text-faint underline decoration-edgeStrong underline-offset-2 hover:text-ink"
                    >
                      cite →
                    </a>
                  </div>
                </div>
              </div>
            ))}
          </Panel>
        </section>
      ) : null}

      <CiteBlock
        title={`Floodlight scorecard for ${sc.url}`}
        url={`${configuredSiteUrl()}/floodlight/${encodeURIComponent(sc.url)}`}
        hash={sha256(
          JSON.stringify([
            sc.url,
            sc.tracker_count,
            sc.session_replay,
            sc.first_party_proxied,
            sc.privacy_notice_url,
            sc.scanned_at,
          ]),
        )}
      />

      <p className="text-xs text-faint">
        Engine {sc.engine_version ?? "?"} · a passive, load-only capture of a public page. See{" "}
        <InternalLink href="/methods">methods</InternalLink>.
      </p>
    </div>
  );
}

function Flag({ on, label }: { on: boolean; label: string }) {
  return (
    <span
      className={`rounded-sm border px-2 py-1 font-mono ${
        on ? "border-alarm/60 text-alarm" : "border-edge text-faint"
      }`}
    >
      {on ? "⚑ " : "— "}
      {label}
    </span>
  );
}

function TrackerTable({ title, rows }: { title: string; rows: Tracker[] }) {
  if (rows.length === 0) return null;
  return (
    <section>
      <Eyebrow>
        {title} ({rows.length})
      </Eyebrow>
      <Panel className="mt-1 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <tbody className="divide-y divide-edge">
              {rows.map((t, i) => (
                <tr key={i} className="align-top">
                  <td className="px-4 py-2 text-ink">{t.vendor}</td>
                  <td className="px-4 py-2 font-mono text-xs text-faint">{t.category}</td>
                  <td className="break-all px-4 py-2 font-mono text-xs text-muted">
                    {t.host}
                    {t.path}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </section>
  );
}
