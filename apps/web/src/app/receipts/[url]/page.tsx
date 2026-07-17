import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { type ChangeRow, type SnapshotRow, receiptsSnapshots, receiptsUrlChanges } from "@/lib/data";
import { flags } from "@/lib/flags";
import { pageMetadata } from "@/lib/seo";
import { Eyebrow, InternalLink, Panel, SeverityBadge, Timestamp } from "@/components/ui";
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
  const snapshots = flags().receipts ? receiptsSnapshots(target) : [];
  if (snapshots.length === 0) {
    // Nothing on record — keep the resolution crawlable but out of the index.
    return pageMetadata({
      title: "Snapshot history",
      description: `Daylight has no Receipts snapshots for ${target} yet.`,
      path: `/receipts/${encodeURIComponent(target)}`,
      noindex: true,
    });
  }
  const n = snapshots.length;
  const latest = snapshots[0]?.captured_at.slice(0, 10);
  return pageMetadata({
    title: `${shortUrl(target)} — snapshot history`,
    description: `${n} dated snapshot${n === 1 ? "" : "s"} of ${target}, a public federal .gov page — trackers, privacy notice, agency seal, and form fields over time, with independent archived copies where saved.${latest ? ` Latest capture ${latest}.` : ""}`,
    path: `/receipts/${encodeURIComponent(target)}`,
  });
}

const count = (json: string | null): number => {
  try {
    return json ? (JSON.parse(json) as unknown[]).length : 0;
  } catch {
    return 0;
  }
};

export default async function ReceiptsUrlPage({ params }: { params: Promise<{ url: string }> }) {
  if (!flags().receipts) notFound();
  const { url } = await params;
  const target = safeDecode(url);
  const snapshots = receiptsSnapshots(target);
  if (snapshots.length === 0) notFound();
  const removals = receiptsUrlChanges(target).filter((c) => c.kind === "removed");
  const domain = snapshots[0]?.domain ?? target;

  return (
    <div className="space-y-6">
      <JsonLd
        data={breadcrumbLd([
          { name: "Daylight", path: "/" },
          { name: "Receipts", path: "/receipts" },
          { name: shortUrl(target), path: `/receipts/${encodeURIComponent(target)}` },
        ])}
      />
      <div>
        <div className="flex items-center gap-2.5">
          <ModuleIcon name="receipts" className="h-6 w-6 shrink-0 text-ink" />
          <Eyebrow>receipts · snapshot history</Eyebrow>
        </div>
        <h1 className="mt-1 break-all font-mono text-xl font-semibold tracking-tight text-ink">{target}</h1>
        <p className="mt-1 max-w-measure text-sm text-muted">
          Dated snapshots of this page, newest first — with an independent archived copy where one
          was saved. What quietly disappears (a tracker, a privacy notice, an agency seal) becomes a
          removal on the record.{" "}
          <InternalLink href={`/domain/${encodeURIComponent(domain)}`}>{domain}</InternalLink>
        </p>
      </div>

      {removals.length > 0 ? (
        <section>
          <Eyebrow>removals detected</Eyebrow>
          <Panel className="mt-1 divide-y divide-edge">
            {removals.map((c: ChangeRow) => (
              <div key={c.id} className="flex items-start gap-3 px-4 py-2.5">
                <SeverityBadge severity={c.severity} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-ink">{c.reason ?? `${c.field} removed`}</p>
                  <Timestamp iso={c.detected_at} />
                </div>
              </div>
            ))}
          </Panel>
        </section>
      ) : null}

      <section>
        <Eyebrow>snapshots ({snapshots.length})</Eyebrow>
        <Panel className="mt-1 divide-y divide-edge">
          {snapshots.map((s: SnapshotRow) => (
            <div key={s.id} className="px-4 py-3">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <Timestamp iso={s.captured_at} />
                <span className="font-mono text-xs text-faint">
                  {count(s.tracker_snapshot_json)} tracker{count(s.tracker_snapshot_json) === 1 ? "" : "s"} ·{" "}
                  {s.privacy_text_hash ? "privacy notice ✓" : "no privacy notice"} ·{" "}
                  {s.seal_present ? "seal ✓" : "no seal"} · {count(s.form_fields_json)} PII fields
                </span>
                {s.wayback_url ? (
                  <a href={s.wayback_url} className="link font-mono text-xs">
                    archived copy ↗
                  </a>
                ) : (
                  <span className="font-mono text-xs text-faint">no archive</span>
                )}
              </div>
            </div>
          ))}
        </Panel>
      </section>

      <p className="text-xs text-faint">
        Snapshots are load-only public captures; the raw screenshot store is never served. See{" "}
        <InternalLink href="/methods">methods</InternalLink>.
      </p>
    </div>
  );
}
