import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { sha256 } from "@daylight/core";
import { synthesizeTitle } from "@daylight/feeds";
import { changeById } from "@/lib/data";
import { configuredSiteUrl, severityLabel, SITE_NAME } from "@/lib/site";
import { pageMetadata } from "@/lib/seo";
import { HashChip, InternalLink, Panel, SeverityBadge, SourceRef, Timestamp } from "@/components/ui";
import { CiteBlock } from "@/components/cite-block";
import { JsonLd } from "@/components/json-ld";
import { breadcrumbLd, reportLd } from "@/lib/structured-data";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const c = changeById(Number(id));
  if (!c) {
    return pageMetadata({
      title: "Change",
      description: "This change record was not found.",
      path: `/change/${id}`,
      noindex: true,
      ogImage: false,
    });
  }
  const headline = synthesizeTitle({
    id: c.id,
    domain: c.domain,
    detected_at: c.detected_at,
    kind: c.kind,
    field: c.field,
    old_value: c.old_value,
    new_value: c.new_value,
    severity: c.severity,
    reason: c.reason,
  });
  const date = c.detected_at.slice(0, 10);
  return pageMetadata({
    title: `Change #${c.id} · ${c.domain}`,
    ogTitle: `${headline} · ${SITE_NAME}`,
    description: `${headline}. Observed ${date} on ${c.domain} by Daylight's ${c.module} module — timestamped and linked to its public source.`,
    path: `/change/${c.id}`,
    ogImage: false, // per-change card comes from change/[id]/opengraph-image.tsx
  });
}

export default async function ChangePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const nid = Number(id);
  const c = Number.isFinite(nid) ? changeById(nid) : null;
  if (!c) notFound();

  // A stable content fingerprint over the change's fields — the citable primitive.
  const fingerprint = sha256(
    JSON.stringify([c.module, c.domain, c.kind, c.field, c.old_value, c.new_value, c.detected_at, c.severity]),
  );
  const canonical = `${configuredSiteUrl()}/change/${c.id}`;
  const title = synthesizeTitle({
    id: c.id,
    domain: c.domain,
    detected_at: c.detected_at,
    kind: c.kind,
    field: c.field,
    old_value: c.old_value,
    new_value: c.new_value,
    severity: c.severity,
    reason: c.reason,
  });

  return (
    <div className="max-w-measure space-y-6">
      <JsonLd
        data={reportLd({
          id: c.id,
          headline: title,
          datePublished: c.detected_at,
          domain: c.domain,
          sourceUrl: c.source_url,
          fingerprint,
        })}
      />
      <JsonLd
        data={breadcrumbLd([
          { name: "Daylight", path: "/" },
          { name: c.domain, path: `/domain/${c.domain}` },
          { name: `Change #${c.id}`, path: `/change/${c.id}` },
        ])}
      />
      <div>
        <div className="flex items-center gap-2.5">
          <SeverityBadge severity={c.severity} />
          <span className="font-mono text-[11px] uppercase tracking-wide text-faint">
            {c.module} · change #{c.id}
          </span>
        </div>
        <h1 className="mt-2 text-xl font-semibold leading-snug tracking-tight text-ink">{title}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
          <InternalLink href={`/domain/${encodeURIComponent(c.domain)}`}>
            <span className="font-mono text-xs">{c.domain}</span>
          </InternalLink>
          <Timestamp iso={c.detected_at} prefix="detected" />
          <SourceRef href={c.source_url} />
        </div>
      </div>

      <Panel className="px-4 py-4">
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
          <Field label="Kind" value={c.kind} mono />
          <Field label="Severity" value={severityLabel(c.severity)} />
          {c.field ? <Field label="Field" value={c.field} mono /> : null}
          <Field label="Old value" value={c.old_value} mono />
          <Field label="New value" value={c.new_value} mono />
        </dl>
        <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-edge pt-3 text-xs text-faint">
          <span>content fingerprint</span>
          <HashChip hash={fingerprint} />
          {c.source_url ? <SourceRef href={c.source_url} label="public source" /> : null}
        </div>
      </Panel>

      <CiteBlock title={title} url={canonical} hash={fingerprint} />

      <p className="text-xs text-faint">
        This is a permanent, citable permalink for a single observed change. Every value above is
        derived from public data; the source link points at the exact artifact it was read from.
      </p>
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string | null; mono?: boolean }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-faint">{label}</dt>
      <dd className={`mt-0.5 break-words text-sm text-ink ${mono ? "font-mono" : ""}`}>
        {value && value.trim() ? value : <span className="text-faint">—</span>}
      </dd>
    </div>
  );
}
