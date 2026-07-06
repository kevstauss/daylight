import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { removalLedgerRows, snapshotCount } from "@/lib/data";
import { flags } from "@/lib/flags";
import { EmptyState, Panel, SeverityBadge, Timestamp } from "@/components/ui";
import { ModuleIcon } from "@/components/module-icon";

export const metadata: Metadata = { title: "Receipts — removal ledger" };
export const dynamic = "force-dynamic";

export default function ReceiptsPage() {
  if (!flags().receipts) notFound();
  const ledger = safe(() => removalLedgerRows(200), []);
  const snaps = safe(() => snapshotCount(), 0);

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2.5"><ModuleIcon name="receipts" className="h-6 w-6 shrink-0 text-ink" /><h1 className="text-2xl font-semibold tracking-tight">Removal ledger</h1></div>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Snapshot before they delete it. When a watched page quietly drops a tracker, a privacy
          notice, or an agency seal, Receipts captures it — dated, with an independent archived copy.
          &ldquo;We took it down&rdquo; becomes a timestamped record of exactly what was there and
          when it vanished. {snaps.toLocaleString()} snapshots on file.
        </p>
      </div>

      {ledger.length === 0 ? (
        <EmptyState
          title="No removals recorded yet."
          hint="Receipts snapshots each watched page twice a week and pushes a copy to the Internet Archive. A removal lands here the moment a later snapshot shows something that was there before is gone — a tracker, a privacy notice, an agency seal, or a form field."
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
