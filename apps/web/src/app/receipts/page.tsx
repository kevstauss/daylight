import { archiveDriftMinutes, archiveTimestamp } from "@daylight/core";
import { notFound } from "next/navigation";
import Link from "next/link";
import {
  archiverRefusalMap,
  coverageSnapshotRows,
  removalLedgerRows,
  snapshotCount,
  type ArchiverRefusal,
  type CoverageRow,
  type SnapshotRow,
} from "@/lib/data";
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
  const refusals = safe(() => archiverRefusalMap(), new Map<string, ArchiverRefusal>());

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
                        <div className="flex items-baseline gap-2">
                          <Archive row={s} refusal={refusals.get(s.domain)} />
                          <ArchiveHistoryLink row={s} />
                        </div>
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

/**
 * Where "Save Page Now" should point. A vanity domain that 301s elsewhere (techprosperitycorps.gov
 * → www.peacecorps.gov/tech) has no content of its own, so archiving it preserves a redirect;
 * the destination is the thing worth keeping.
 *
 * redirect_target is NOT trustworthy input: a capture that failed in the browser records Chrome's
 * internal error URL (chrome-error://chromewebdata/), which produced links like
 * web.archive.org/save/chrome-error://chromewebdata/. Anything that isn't a real http(s) URL falls
 * back to the page we actually watch.
 */
function archiveTarget(row: CoverageRow): string {
  const t = row.redirect_target;
  if (!t) return row.url;
  try {
    const u = new URL(t);
    return u.protocol === "http:" || u.protocol === "https:" ? t : row.url;
  } catch {
    return row.url;
  }
}

/**
 * The offer to have the Internet Archive capture a page we have no copy of.
 *
 * The copy is careful about a genuinely counterintuitive mechanism: clicking this does NOT make
 * the reader's browser fetch the page. It asks the Archive's servers to, so it meets the exact
 * same door our own attempt did — a reader is not a way around a block. What a person does add
 * is a different moment, and these refusals are probabilistic rather than absolute (moms.gov
 * turns the Archive away right now, yet the Archive holds 148 captures of it), so the attempt is
 * genuinely worth making. Promise nothing; say what is known.
 */
function SaveOffer({ row, refusal }: { row: CoverageRow; refusal?: ArchiverRefusal }) {
  const target = archiveTarget(row);
  return (
    <div className="space-y-0.5">
      <a
        href={`https://web.archive.org/save/${target}`}
        target="_blank"
        rel="noopener noreferrer"
        className="link whitespace-nowrap"
        title={`Ask the Internet Archive to capture ${target} now. The Archive's own crawler fetches the page, so this may hit the same refusal our attempt did.`}
      >
        Ask the Archive ↗
      </a>
      {refusal?.refusesOurPlainRequest ? (
        <p className="max-w-[16rem] text-[11px] leading-snug text-faint">
          This server refuses automated clients, including the Archive. A save may not succeed.
        </p>
      ) : null}
    </div>
  );
}

function Archive({ row, refusal }: { row: CoverageRow; refusal?: ArchiverRefusal }) {
  // No copy on file — offer the reader the one action that can actually create one.
  if (!row.archive_url) return <SaveOffer row={row} refusal={refusal} />;
  const archivedAt = archiveTimestamp(row.archive_url);
  if (!archivedAt) return <SaveOffer row={row} refusal={refusal} />; // unpinned: not a receipt
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

/** Everything the Internet Archive already holds for this page — usually the more useful click
 *  than making a new capture. */
function ArchiveHistoryLink({ row }: { row: CoverageRow }) {
  return (
    <a
      href={`https://web.archive.org/web/*/${archiveTarget(row)}`}
      target="_blank"
      rel="noopener noreferrer"
      className="whitespace-nowrap text-faint underline decoration-dotted underline-offset-2 hover:text-muted"
      title="Every capture the Internet Archive holds for this page"
    >
      all ↗
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
