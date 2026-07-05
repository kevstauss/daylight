import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { foundryReport } from "@/lib/data";
import { flags } from "@/lib/flags";
import { EmptyState, Panel } from "@/components/ui";
import { ModuleIcon } from "@/components/module-icon";

export const metadata: Metadata = { title: "Foundry" };
export const dynamic = "force-dynamic";

export default function FoundryPage() {
  if (!flags().foundry) notFound();
  const report = safe(() => foundryReport(), { vendors: [], generatedAt: "" });
  const vendors = report.vendors;

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2.5">
          <ModuleIcon name="foundry" className="h-6 w-6 shrink-0 text-ink" />
          <h1 className="text-2xl font-semibold tracking-tight">Foundry</h1>
        </div>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          The join Lookout and Ledger don&rsquo;t make: it clusters federal{" "}
          <code className="font-mono text-ink">.gov</code> properties by the shared build/staging
          tree they pass through in public Certificate Transparency logs, then reads the registry to
          answer two questions no single-record check can &mdash; <strong>how many distinct agencies
          are being built through one vendor</strong>, and <strong>which projects are staged but have
          no <code className="font-mono text-ink">.gov</code> registered yet</strong>. Existence-only:
          derived from public CT + the CISA registry; we never connect to a host.
        </p>
      </div>

      {vendors.length === 0 ? (
        <EmptyState
          title="No build vendors detected yet."
          hint="Foundry reads what Lookout and Ledger have ingested. Run the Lookout backfill (crt.sh) and a Ledger pass, then a vendor apex that stages ≥2 agencies' properties will surface here."
        />
      ) : (
        vendors.map((v) => (
          <Panel key={v.vendorApex}>
            <div className="border-b border-edge px-4 py-3">
              <p className="font-mono text-[11px] uppercase tracking-wider text-muted">foundry · vendor build-graph</p>
              <div className="mt-1 flex flex-wrap items-baseline gap-x-2">
                <Link href={`/domain/${encodeURIComponent(v.vendorApex)}`} className="font-mono text-sm text-ink link">
                  {v.vendorApex}
                </Link>
                {v.ownerLabel ? <span className="text-xs text-muted">{v.ownerLabel}</span> : null}
              </div>
              <p className="mt-1 text-sm text-muted">
                Stages <strong className="text-ink">{v.projectCount}</strong> projects for{" "}
                <strong className="text-ink">{v.agencyCount}</strong> distinct owning{" "}
                {v.agencyCount === 1 ? "agency" : "agencies"}.
              </p>
            </div>

            <div className="px-4 py-3">
              <h2 className="font-mono text-[11px] uppercase tracking-wider text-muted">Build-concentration index</h2>
              <ul className="mt-2 divide-y divide-edge">
                {v.index.map((e) => (
                  <li key={e.org} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2">
                    <span className="min-w-0 flex-1 text-sm text-ink">{e.org}</span>
                    <span className="font-mono text-xs text-faint">{e.projects.length}</span>
                    <div className="flex w-full flex-wrap gap-x-3 gap-y-0.5">
                      {e.projects.map((p) => (
                        <Link key={p.apex} href={`/domain/${encodeURIComponent(p.apex)}`} className="font-mono text-xs text-muted link">
                          {p.apex}
                        </Link>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            </div>

            {v.unlaunched.length > 0 ? (
              <div className="border-t border-edge px-4 py-3">
                <h2 className="font-mono text-[11px] uppercase tracking-wider text-muted">
                  Unlaunched-project watch
                </h2>
                <p className="mt-1 text-xs text-muted">
                  A staging host exists in CT, but no matching <code className="font-mono">.gov</code> apex is
                  in the registry yet. Low-confidence rows are short single-word codes that may be vendor plumbing.
                </p>
                <ul className="mt-2 divide-y divide-edge">
                  {v.unlaunched.map((u) => (
                    <li key={u.project} className="flex flex-wrap items-baseline gap-x-2 py-2">
                      <span className="font-mono text-sm text-ink">{u.project}</span>
                      <span className="font-mono text-[11px] text-faint">
                        → {u.candidateApexes[0] ?? `${u.project}.gov`} (not registered)
                      </span>
                      {u.confidence === "low" ? (
                        <span className="font-mono text-[10px] text-faint">low-confidence</span>
                      ) : null}
                      <div className="flex w-full flex-wrap gap-x-3 pt-0.5">
                        {u.hosts.map((h) => (
                          <span key={h} className="font-mono text-[11px] text-muted">{h}</span>
                        ))}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </Panel>
        ))
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
