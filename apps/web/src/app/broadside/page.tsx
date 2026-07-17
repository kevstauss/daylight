import { notFound } from "next/navigation";
import Link from "next/link";
import type { AdRow } from "@/lib/data";
import {
  adCount,
  broadsideChanges,
  broadsideNewAds,
  broadsideQuietlyPulled,
  broadsideSpendByCategory,
} from "@/lib/data";
import { flags } from "@/lib/flags";
import { EmptyState, Panel, SeverityBadge, Timestamp } from "@/components/ui";
import { ModuleIcon } from "@/components/module-icon";
import { pageMetadata, PAGE_DESCRIPTIONS } from "@/lib/seo";
import { JsonLd } from "@/components/json-ld";
import { breadcrumbLd, webPageLd } from "@/lib/structured-data";

export const metadata = pageMetadata({
  title: "Broadside",
  description: PAGE_DESCRIPTIONS.broadside,
  path: "/broadside",
});
export const dynamic = "force-dynamic";

const usd = (n: number): string => `$${n.toLocaleString("en-US")}`;

/** An individual ad's spend BUCKET as a range — never a midpoint. */
function adSpend(a: AdRow): string {
  const { spend_min: min, spend_max: max, spend_currency: c } = a;
  if (min == null && max == null) return "undisclosed";
  const cur = c && c !== "USD" ? ` ${c}` : "";
  if (min != null && max == null) return `≥ ${usd(min)}${cur}`;
  if (min == null && max != null) return `≤ ${usd(max)}${cur}`;
  return `${usd(min as number)}–${usd(max as number)}${cur}`;
}

export default function BroadsidePage() {
  if (!flags().broadside) notFound();

  const categories = safe(() => broadsideSpendByCategory(), []);
  const recent = safe(() => broadsideChanges({ limit: 30 }), []);
  const since90 = new Date(Date.now() - 90 * 86_400_000).toISOString();
  const fresh = safe(() => broadsideNewAds(since90, 30), []);
  const pulled = safe(() => broadsideQuietlyPulled(20), []);
  const total = safe(() => adCount(), 0);

  return (
    <div className="space-y-6">
      <JsonLd data={webPageLd({ type: "CollectionPage", name: "Broadside", description: PAGE_DESCRIPTIONS.broadside, path: "/broadside" })} />
      <JsonLd data={breadcrumbLd([{ name: "Daylight", path: "/" }, { name: "Broadside", path: "/broadside" }])} />

      <div>
        <div className="flex items-center gap-2.5">
          <ModuleIcon name="broadside" className="h-6 w-6 shrink-0 text-ink" />
          <h1 className="text-2xl font-semibold tracking-tight">Broadside</h1>
        </div>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          What the federal government pays to advertise to Americans, from public ad libraries.
          Spend and impressions are published only as <strong>buckets</strong>, so every total here
          is an <strong>estimated range</strong> — a sum of the disclosed bounds, never a single
          number. We read the public archive; we never touch a government system. Tracking{" "}
          {total.toLocaleString()} observed ad{total === 1 ? "" : "s"}.
        </p>
      </div>

      {/* Estimated spend by category — summed as a range. */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-ink">Estimated spend by category</h2>
        {categories.length === 0 ? (
          <EmptyState title="No ad spend observed yet." hint="Watched advertisers' ads will appear here once the archive is polled." />
        ) : (
          <Panel>
            <ul className="divide-y divide-edge">
              {categories.map((c) => (
                <li key={c.category} className="flex items-baseline justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <span className="text-sm text-ink">{c.category}</span>
                    <span className="ml-2 font-mono text-[11px] text-faint">
                      {c.disclosed_ads}/{c.ads_total} ad{c.ads_total === 1 ? "" : "s"} disclose spend
                    </span>
                  </div>
                  <div className="shrink-0 text-right">
                    <span className="font-mono text-sm text-ink">
                      {c.disclosed_ads === 0
                        ? "undisclosed"
                        : c.open_ended_ads > 0
                          ? `≥ ${usd(c.spend_min_total)}` /* an open-ended top bucket → floor, not a two-sided range */
                          : `${usd(c.spend_min_total)}–${usd(c.spend_max_total)}`}
                    </span>
                    <span className="block text-[10px] text-faint">estimated range</span>
                  </div>
                </li>
              ))}
            </ul>
          </Panel>
        )}
      </section>

      {/* Changes in spend + new-ad events. */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-ink">Recent activity</h2>
        {recent.length === 0 ? (
          <EmptyState title="No ad activity recorded yet." hint="New ads and spend-range increases will be logged here as they're observed." />
        ) : (
          <Panel>
            <ul className="divide-y divide-edge">
              {recent.map((c) => (
                <li key={c.id} className="flex items-start gap-3 px-4 py-3">
                  <SeverityBadge severity={c.severity} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-ink">{c.reason}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 text-xs text-faint">
                      <Link href={`/domain/${encodeURIComponent(c.domain)}`} className="link">{c.domain}</Link>
                      <Timestamp iso={c.detected_at} prefix="observed" />
                      {c.source_url ? <a href={c.source_url} className="link" rel="nofollow noopener">source →</a> : null}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </Panel>
        )}
      </section>

      {/* New ads. */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-ink">New ads (last 90 days)</h2>
        {fresh.length === 0 ? (
          <EmptyState title="No new ads observed." />
        ) : (
          <Panel>
            <ul className="divide-y divide-edge">
              {fresh.map((a) => (
                <li key={a.ad_key} className="flex items-baseline justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <Link href={`/domain/${encodeURIComponent(a.domain)}`} className="text-sm text-ink hover:underline">
                      {a.advertiser ?? a.domain}
                    </Link>
                    {a.category ? <span className="ml-2 font-mono text-[10px] text-faint">{a.category}</span> : null}
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-faint">
                      <Timestamp iso={a.first_seen} prefix="first seen" />
                      <span className="font-mono uppercase">{a.platform}</span>
                      {a.source_url ? <a href={a.source_url} className="link" rel="nofollow noopener">creative →</a> : null}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <span className="font-mono text-sm text-ink">{adSpend(a)}</span>
                    <span className="block text-[10px] text-faint">spend (est.)</span>
                  </div>
                </li>
              ))}
            </ul>
          </Panel>
        )}
      </section>

      {/* Quietly pulled — still declared running, no longer seen. */}
      {pulled.length > 0 ? (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-ink">Quietly pulled</h2>
          <p className="text-xs text-muted">
            Ads still declared running by the advertiser that we have stopped seeing in the archive —
            a disappearance recorded, not asserted.
          </p>
          <Panel>
            <ul className="divide-y divide-edge">
              {pulled.map((a) => (
                <li key={a.ad_key} className="flex items-baseline justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <span className="text-sm text-ink">{a.advertiser ?? a.domain}</span>
                    <div className="mt-0.5 text-xs text-faint">
                      <Timestamp iso={a.last_seen} prefix="last seen" />
                    </div>
                  </div>
                  <span className="shrink-0 font-mono text-sm text-ink">{adSpend(a)}</span>
                </li>
              ))}
            </ul>
          </Panel>
        </section>
      ) : null}
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
