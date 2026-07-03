import type { Metadata } from "next";
import Link from "next/link";
import { statusReport, type ModuleStatus } from "@/lib/status";
import { EmptyState, Panel, Timestamp } from "@/components/ui";

export const metadata: Metadata = { title: "Status" };
export const dynamic = "force-dynamic";

export default function StatusPage() {
  const report = safe(() => statusReport(), [] as ModuleStatus[]);
  const anyRun = report.some((m) => m.lastRun !== null);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">System status</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Each module&rsquo;s last run, expected cadence, and health. A watchdog that silently dies
          is worse than none, so a stopped scheduler shows as <strong>overdue</strong>, not a stale
          &ldquo;ok.&rdquo; A machine-readable version is at{" "}
          <Link href="/status.json" className="link">/status.json</Link>.
        </p>
      </div>

      <Panel className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-edge text-left font-mono text-[11px] uppercase tracking-wide text-faint">
                <th scope="col" className="px-4 py-2 font-normal">Module</th>
                <th scope="col" className="px-4 py-2 font-normal">State</th>
                <th scope="col" className="px-4 py-2 font-normal">Last run</th>
                <th scope="col" className="px-4 py-2 font-normal">Expected</th>
                <th scope="col" className="px-4 py-2 font-normal">Items</th>
                <th scope="col" className="px-4 py-2 font-normal">Changes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-edge">
              {report.map((m) => (
                <tr key={m.module}>
                  <td className="whitespace-nowrap px-4 py-2.5 font-mono text-ink">{m.module}</td>
                  <td className="px-4 py-2.5">{renderState(m)}</td>
                  <td className="px-4 py-2.5">
                    <Timestamp iso={m.lastRun} />
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs text-faint">{m.expected}</td>
                  <td className="px-4 py-2.5 font-mono text-muted">{m.itemsSeen ?? "—"}</td>
                  <td className="px-4 py-2.5 font-mono text-muted">{m.changesEmitted ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      {!anyRun ? (
        <EmptyState title="No worker has run yet." hint="Status populates after the first scan." />
      ) : null}
    </div>
  );
}

function renderState(m: ModuleStatus) {
  const age = m.ageHours !== null ? `${Math.floor(m.ageHours / 24)}d ${Math.floor(m.ageHours % 24)}h ago` : "";
  switch (m.state) {
    case "deferred":
      return <span className="font-mono text-xs text-faint">deferred (flag off)</span>;
    case "not-scanned":
      return <span className="font-mono text-xs text-faint">not yet scanned</span>;
    case "running":
      return <span className="font-mono text-xs text-signal">running…</span>;
    case "overdue":
      return (
        <span className="font-mono text-xs text-alarm">
          overdue — last ran {age}; expected {m.expected}
        </span>
      );
    case "error":
      return (
        <span className="font-mono text-xs text-alarm" title={m.error ?? undefined}>
          error{m.error ? ` — ${truncate(m.error, 50)}` : ""}
        </span>
      );
    default:
      return <span className="font-mono text-xs text-calm">ok</span>;
  }
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
