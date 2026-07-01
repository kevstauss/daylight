import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { removalLedgerRows, snapshotCount } from "@/lib/data";
import { flags } from "@/lib/flags";
import { EmptyState, Panel, SeverityBadge, Timestamp } from "@/components/ui";

export const metadata: Metadata = { title: "Receipts — removal ledger" };
export const dynamic = "force-dynamic";

export default function ReceiptsPage() {
  if (!flags().receipts) notFound();
  const ledger = safe(() => removalLedgerRows(200), []);
  const snaps = safe(() => snapshotCount(), 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Removal ledger</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Screenshot before they delete it. When a watched page quietly drops a tracker, a privacy
          notice, or an agency seal, Receipts captures it — dated, with an independent archived copy.
          &ldquo;We took it down&rdquo; becomes a timestamped record of exactly what was there and
          when it vanished. {snaps.toLocaleString()} snapshots on file.
        </p>
      </div>

      {ledger.length === 0 ? (
        <EmptyState
          title="No removals recorded yet."
          hint="The diff engine + removal ledger are live and fixture-tested; the live snapshot capture (Playwright + Wayback push) is pending a scheduler/host decision. Removals appear here the moment a second snapshot shows something gone."
        />
      ) : (
        <Panel>
          <ul className="divide-y divide-edge">
            {ledger.map((c) => (
              <li key={c.id} className="flex items-start gap-3 px-4 py-3">
                <SeverityBadge severity={c.severity} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-ink">{c.reason ?? `${c.field ?? "item"} removed from ${c.domain}`}</p>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs">
                    <Link href={`/domain/${encodeURIComponent(c.domain)}`} className="link">
                      {c.domain}
                    </Link>
                    {c.old_value ? <span className="font-mono text-faint">was: {c.old_value}</span> : null}
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
