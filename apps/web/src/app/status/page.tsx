import type { Metadata } from "next";
import { statusRows, type ScanRow } from "@/lib/data";
import { EmptyState, Panel, Timestamp } from "@/components/ui";

export const metadata: Metadata = { title: "Status" };
export const dynamic = "force-dynamic";

const MODULES = ["ledger", "lookout", "floodlight", "receipts", "redtape"] as const;

export default function StatusPage() {
  const rows = safe(() => statusRows(), [] as ScanRow[]);
  const byModule = new Map(rows.map((r) => [r.module, r]));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">System status</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Each module&rsquo;s last run and last error. A watchdog that silently dies is worse than
          none, so our own uptime is public.
        </p>
      </div>

      <Panel>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-edge text-left font-mono text-[11px] uppercase tracking-wide text-faint">
              <th className="px-4 py-2 font-normal">Module</th>
              <th className="px-4 py-2 font-normal">State</th>
              <th className="px-4 py-2 font-normal">Last run</th>
              <th className="px-4 py-2 font-normal">Items</th>
              <th className="px-4 py-2 font-normal">Changes</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-edge">
            {MODULES.map((m) => {
              const r = byModule.get(m);
              return (
                <tr key={m}>
                  <td className="px-4 py-2.5 font-mono text-ink">{m}</td>
                  <td className="px-4 py-2.5">{renderState(r)}</td>
                  <td className="px-4 py-2.5">
                    <Timestamp iso={r?.finished_at ?? r?.started_at ?? null} />
                  </td>
                  <td className="px-4 py-2.5 font-mono text-muted">{r?.items_seen ?? "—"}</td>
                  <td className="px-4 py-2.5 font-mono text-muted">{r?.changes_emitted ?? "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Panel>

      {rows.length === 0 ? (
        <EmptyState title="No worker has run yet." hint="Status populates after the first scan." />
      ) : null}
    </div>
  );
}

function renderState(r: ScanRow | undefined) {
  if (!r) return <span className="font-mono text-xs text-faint">not yet scanned</span>;
  if (r.finished_at === null)
    return <span className="font-mono text-xs text-signal">running…</span>;
  if (r.ok === 1) return <span className="font-mono text-xs text-calm">ok</span>;
  return (
    <span className="font-mono text-xs text-alarm" title={r.error ?? undefined}>
      error{r.error ? ` — ${truncate(r.error, 60)}` : ""}
    </span>
  );
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}
