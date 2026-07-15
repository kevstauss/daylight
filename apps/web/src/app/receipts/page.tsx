import { archiveDriftMinutes, archiveTimestamp } from "@daylight/core";
import { notFound } from "next/navigation";
import Link from "next/link";
import { coverageSnapshotRows, removalLedgerRows, snapshotCount, type CoverageRow, type SnapshotRow } from "@/lib/data";
import { flags } from "@/lib/flags";
import { EmptyState, Eyebrow, Panel, SeverityBadge, Timestamp } from "@/components/ui";
import { ModuleIcon } from "@/components/module-icon";
import { pageMetadata, PAGE_DESCRIPTIONS } from "@/lib/seo";
import { JsonLd } from "@/components/json-ld";
import { breadcrumbLd, webPageLd } from "@/lib/structured-data";

export const metadata = pageMetadata({
  title: "Receipts — removal ledger",
  description: PAGE_DESCRIPTIONS.receipts,
  path: "/receipts",
  feeds: { rss: "/receipts/feed.xml", json: "/receipts/feed.json" },
});
export const dynamic = "force-dynamic";

function trackerCount(s: SnapshotRow): number {
  try {
    return (JSON.parse(s.tracker_snapshot_json ?? "[]") as unknown[]).length;
  } catch {
    return 0;
  }
}

export default function ReceiptsPage() {
  if (!flags().receipts) notFound();
  const ledger = safe(() => removalLedgerRows(200), []);
  const coverage = safe(() => coverageSnapshotRows(500), []);
  const snaps = safe(() => snapshotCount(), 0);

  return (
    <div className="space-y-8">
      <JsonLd data={webPageLd({ type: "CollectionPage", name: "Receipts", description: PAGE_DESCRIPTIONS.receipts, path: "/receipts" })} />
      <JsonLd data={breadcrumbLd([{ name: "Daylight", path: "/" }, { name: "Receipts", path: "/receipts" }])} />
      <div>
        <div className="flex items-center gap-2.5">
          <ModuleIcon name="receipts" className="h-6 w-6 shrink-0 text-ink" />
          <h1 className="text-2xl font-semibold tracking-tight">Receipts</h1>
        </div>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Snapshot before they delete it. When a watched page quietly drops a tracker, a privacy
          notice, or an agency seal, Receipts captures it — dated, with an independent archived copy.
          &ldquo;We took it down&rdquo; becomes a timestamped record of exactly what was there and
          when it vanished.
        </p>
        <p className="mt-2 font-mono text-xs text-faint">
          {coverage.length.toLocaleString()} pages watched · {snaps.toLocaleString()} snapshots on
          file · {ledger.length.toLocaleString()} removals recorded
        </p>
      </div>

      {/* ── What quietly changed: the removal ledger ── */}
      <section className="space-y-3">
        <Eyebrow>receipts · what quietly changed</Eyebrow>
        {ledger.length === 0 ? (
          <EmptyState
            title="No removals recorded yet."
            hint="A removal lands here the moment a later snapshot shows something that was there before is gone — a tracker, a privacy notice, an agency seal, or a form field. Until then, the baseline of what's on each page is below."
          />
        ) : (
          <Panel>
            <ul className="divide-y divide-edge">
              {ledger.map((c) => (
                <li key={c.id} className="flex items-start gap-3 px-4 py-3">
                  <SeverityBadge severity={c.severity} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-ink">
                      {c.reason ?? `${c.field ?? "item"} removed from ${c.domain}`}
                    </p>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs">
                      <Link href={`/domain/${encodeURIComponent(c.domain)}`} className="link">
                        {c.domain}
                      </Link>
                      {c.old_value ? (
                        <span className="font-mono text-faint">was: {c.old_value}</span>
                      ) : null}
                      <Timestamp iso={c.detected_at} prefix="vanished" />
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </Panel>
        )}
        <p className="text-xs text-faint">
          <Link href="/receipts/feed.xml" className="link">
            Removal feed (RSS) →
          </Link>
        </p>
      </section>

      {/* ── What we're watching now: the coverage baseline ── */}
      <section className="space-y-3">
        <Eyebrow>receipts · what we&rsquo;re watching</Eyebrow>
        {coverage.length === 0 ? (
          <EmptyState
            title="No snapshots captured yet."
            hint="Receipts snapshots each watched page twice a week; the baseline for every page appears here after the first capture."
          />
        ) : (
          <Panel>
            <p className="border-b border-edge px-4 py-2.5 text-xs text-muted">
              The current baseline for each watched page — what a future snapshot is diffed against.
              A removal above is simply one of these facts going from present to gone.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[36rem] text-sm">
                <thead>
                  <tr className="border-b border-edge text-left text-[11px] uppercase tracking-wide text-faint">
                    <th className="px-4 py-2 font-medium">Page</th>
                    <th className="px-4 py-2 font-medium">Last captured</th>
                    <th className="px-4 py-2 text-right font-medium">Trackers</th>
                    <th className="px-4 py-2 font-medium">Privacy notice</th>
                    <th className="px-4 py-2 font-medium">Seal</th>
                    <th className="px-4 py-2 font-medium">Archive</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-edge">
                  {coverage.map((s) => (
                    <tr key={s.id}>
                      <td className="px-4 py-2.5">
                        <Link href={`/domain/${encodeURIComponent(s.domain)}`} className="link font-mono text-xs">
                          {s.domain}
                        </Link>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-muted">
                        <Timestamp iso={s.captured_at} />
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-xs text-ink">{trackerCount(s)}</td>
                      <td className="px-4 py-2.5"><Presence on={!!s.privacy_text_hash} /></td>
                      <td className="px-4 py-2.5"><Presence on={s.seal_present === 1} /></td>
                      <td className="px-4 py-2.5 text-xs">
                        <Archive row={s} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        )}
      </section>
    </div>
  );
}

/**
 * The independent archived copy, dated by the archive's OWN capture instant — never by the
 * snapshot row that happens to hold the link. The two can differ a lot: an archive may be
 * carried forward from an earlier capture, or adopted from the Internet Archive's own crawl
 * when our save failed, in which case it can sit hours from what we looked at. It is still real
 * evidence; it is just evidence of the page at *that* moment, and the reader has to be able to
 * see which. Anything close enough to our capture to corroborate it reads as "Archived"; the
 * rest carries its date on its face.
 */
const CORROBORATES_MINUTES = 60;

function Archive({ row }: { row: CoverageRow }) {
  if (!row.archive_url) return <span className="text-faint">—</span>;
  const archivedAt = archiveTimestamp(row.archive_url);
  if (!archivedAt) return <span className="text-faint">—</span>; // unpinned: not a receipt
  const drift = archiveDriftMinutes(row.archive_url, row.captured_at);
  const corroborates = drift !== null && drift <= CORROBORATES_MINUTES;
  const stamp = fmtArchiveDate(archivedAt);
  return (
    <a
      href={row.archive_url}
      target="_blank"
      rel="noopener noreferrer"
      className="link whitespace-nowrap"
      title={
        corroborates
          ? `Independent archived copy (Internet Archive), captured ${fmtArchiveInstant(archivedAt)} — alongside this snapshot`
          : `Nearest independent archived copy (Internet Archive), captured ${fmtArchiveInstant(archivedAt)} — ${fmtDrift(drift)} from this snapshot, not a copy of it`
      }
    >
      {corroborates ? "Archived ↗" : `Archived ${stamp} ↗`}
    </a>
  );
}

function fmtArchiveDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(d);
}

function fmtArchiveInstant(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(d)} UTC`;
}

function fmtDrift(mins: number | null): string {
  if (mins === null) return "an unknown distance";
  if (mins < 90) return `${mins} min`;
  const h = Math.round(mins / 60);
  if (h < 48) return `${h} h`;
  return `${Math.round(h / 24)} days`;
}

/** A present/absent fact, stated plainly. "Present" (a privacy notice, a seal) reads as the
 *  reassuring state; absence is neutral — never alarm-colored. */
function Presence({ on }: { on: boolean }) {
  return on ? (
    <span className="font-mono text-xs text-calm">✓ present</span>
  ) : (
    <span className="font-mono text-xs text-faint">none</span>
  );
}

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}
