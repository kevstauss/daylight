import type { Metadata } from "next";
import Link from "next/link";
import { correctionsRows, type CorrectionRow } from "@/lib/data";
import { EmptyState, Eyebrow, Panel, Timestamp } from "@/components/ui";

export const metadata: Metadata = { title: "Corrections" };
export const dynamic = "force-dynamic";

export default function CorrectionsPage() {
  const rows = safe(() => correctionsRows(200), [] as CorrectionRow[]);

  return (
    <div className="space-y-6">
      <div>
        <Eyebrow>daylight · corrections</Eyebrow>
        <h1 className="text-2xl font-semibold tracking-tight">Corrections &amp; retractions</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          A watchdog&rsquo;s strongest credential is a visible record of its own mistakes. Whenever
          Daylight retracts or amends one of its <em>own</em> published claims — for example when a
          privacy filing is later found to exist — it is logged here, dated, in the same feed format
          as everything else. We never un-publish a claim silently; that would be the exact quiet
          removal Receipts exists to expose.
        </p>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="No corrections yet."
          hint="When a published finding is retracted or amended, it appears here with the reason and date."
        />
      ) : (
        <Panel>
          <ul className="divide-y divide-edge">
            {rows.map((c) => (
              <li key={c.id} className="flex items-start gap-3 px-4 py-3">
                <span
                  className={`mt-0.5 inline-flex shrink-0 items-center rounded-sm border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide ${
                    c.kind === "retraction" ? "border-alarm/50 text-alarm" : "border-signal/55 text-signal"
                  }`}
                >
                  {c.kind}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-ink">{c.reason}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5">
                    <Link
                      href={`/domain/${encodeURIComponent(c.domain)}`}
                      className="font-mono text-xs text-muted underline decoration-edgeStrong underline-offset-2 hover:text-ink"
                    >
                      {c.domain}
                    </Link>
                    <span className="font-mono text-xs text-faint">{c.module}</span>
                    <Timestamp iso={c.created_at} />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      )}
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
