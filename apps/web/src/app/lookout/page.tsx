import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import type { SubdomainRow } from "@/lib/data";
import { searchSubdomains, subdomainCount } from "@/lib/data";
import { flags } from "@/lib/flags";
import { EmptyState, Panel, SeverityBadge, Timestamp } from "@/components/ui";
import { ModuleIcon } from "@/components/module-icon";

export const metadata: Metadata = { title: "Lookout" };
export const dynamic = "force-dynamic";

const str = (v: string | string[] | undefined): string =>
  (Array.isArray(v) ? v[0] : v)?.trim() ?? "";

function labelsOf(row: SubdomainRow): string[] {
  try {
    return JSON.parse(row.labels ?? "[]") as string[];
  } catch {
    return [];
  }
}

export default async function LookoutPage({
  searchParams,
}: {
  searchParams: Promise<{ [k: string]: string | string[] | undefined }>;
}) {
  if (!flags().lookout) notFound();
  const sp = await searchParams;
  const q = str(sp.q);
  const severity = ["high", "notable", "info"].includes(str(sp.severity)) ? str(sp.severity) : undefined;

  const rows = safe(() => searchSubdomains({ q: q || undefined, severity, limit: 200 }), []);
  const total = safe(() => subdomainCount(), 0);

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2.5"><ModuleIcon name="lookout" className="h-6 w-6 shrink-0 text-ink" /><h1 className="text-2xl font-semibold tracking-tight">Lookout</h1></div>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          New <code className="font-mono text-ink">.gov</code> subdomains as they appear in public
          Certificate Transparency logs — flagged when a name looks like a preview/staging/infra
          host or mimics another agency&rsquo;s function. Existence-only: we note that a cert exists;
          we never connect to the host. Watching {total.toLocaleString()} known subdomains.
        </p>
      </div>

      <form action="/lookout" method="get" className="flex gap-2">
        {severity ? <input type="hidden" name="severity" value={severity} /> : null}
        <input
          type="search"
          name="q"
          defaultValue={q}
          aria-label="Search subdomains"
          placeholder="Search a subdomain, apex, or owner (e.g. analytics, previews, ndstudio)…"
          className="w-full rounded border border-edge bg-panel px-3 py-2 text-sm text-ink placeholder:text-faint focus:border-accent"
        />
        <button
          type="submit"
          className="rounded border border-edge bg-panel px-4 py-2 font-mono text-xs text-ink hover:border-ink"
        >
          Search
        </button>
      </form>

      <div className="flex flex-wrap items-center gap-2 font-mono text-xs">
        <Link
          href={q ? `/lookout?q=${encodeURIComponent(q)}` : "/lookout"}
          className={`rounded border px-3 py-1.5 ${!severity ? "border-ink text-ink" : "border-edge text-muted hover:text-ink"}`}
        >
          all
        </Link>
        <Link
          href={q ? `/lookout?q=${encodeURIComponent(q)}&severity=high` : "/lookout?severity=high"}
          className={`rounded border px-3 py-1.5 ${severity === "high" ? "border-alarm text-alarm" : "border-edge text-muted hover:text-ink"}`}
        >
          high only
        </Link>
        <Link href="/lookout/feed.xml" className="rounded border border-edge px-3 py-1.5 text-muted hover:text-ink">
          feed (RSS)
        </Link>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title={q || severity ? "No subdomains match." : "No subdomains recorded yet."}
          hint="Run the Lookout backfill (crt.sh) to populate cert history for the watched apexes."
        />
      ) : (
        <Panel>
          <ul className="divide-y divide-edge">
            {rows.map((r) => (
              <li key={r.fqdn} className="flex items-start gap-3 px-4 py-3">
                <SeverityBadge severity={r.flag_severity ?? "info"} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-mono text-sm text-ink">{r.fqdn}</span>
                    {labelsOf(r).map((l) => (
                      <span key={l} className="font-mono text-[10px] text-faint">
                        {l}
                      </span>
                    ))}
                  </div>
                  {r.flag_reason ? <p className="mt-0.5 text-xs text-muted">{r.flag_reason}</p> : null}
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 text-xs text-faint">
                    <Link href={`/domain/${encodeURIComponent(r.apex)}`} className="link">
                      {r.apex}
                    </Link>
                    {r.apex_owner_org ? <span>{r.apex_owner_org}</span> : null}
                    <Timestamp iso={r.first_seen} prefix="first seen" />
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
