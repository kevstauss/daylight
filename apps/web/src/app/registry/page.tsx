import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import type { DomainRow } from "@daylight/db";
import { flags } from "@/lib/flags";
import { domainCount, searchRegistry } from "@/lib/data";
import { domainFlag, orgResolver } from "@/lib/ledger";
import { EmptyState, Panel } from "@/components/ui";

export const metadata: Metadata = { title: "Registry" };
export const dynamic = "force-dynamic";

const str = (v: string | string[] | undefined): string =>
  (Array.isArray(v) ? v[0] : v)?.trim() ?? "";

export default async function RegistryPage({
  searchParams,
}: {
  searchParams: Promise<{ [k: string]: string | string[] | undefined }>;
}) {
  if (!flags().registry) notFound();
  const sp = await searchParams;
  const q = str(sp.q);
  const hasQuery = q.length > 0;

  const rows = safe(
    () => searchRegistry(hasQuery ? { q, limit: 200 } : { limit: 100 }),
    [] as DomainRow[],
  );
  const total = safe(() => domainCount(), 0);
  let orgOf: ReturnType<typeof orgResolver> | undefined;
  try {
    orgOf = orgResolver();
  } catch {
    orgOf = undefined;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Registry</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Who owns each federal <code className="font-mono text-ink">.gov</code> apex domain, and
          the published security contact. Searching {total.toLocaleString()} domains from CISA&rsquo;s
          public registry.
        </p>
      </div>

      <form action="/registry" method="get" className="flex gap-2">
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Search domain, organization, or contact…"
          className="w-full rounded border border-edge bg-panel px-3 py-2 text-sm text-ink placeholder:text-faint focus:border-accent focus:outline-none"
        />
        <button
          type="submit"
          className="rounded border border-edge bg-panel px-4 py-2 font-mono text-xs text-ink hover:border-ink"
        >
          Search
        </button>
      </form>

      {rows.length === 0 ? (
        <EmptyState
          title={hasQuery ? `No domains match “${q}”.` : "The registry is empty."}
          hint={hasQuery ? "Try a domain, organization, or contact fragment." : "Run the Ledger seed to populate it."}
        />
      ) : (
        <Panel className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-edge text-left font-mono text-[11px] uppercase tracking-wide text-faint">
                  <th className="px-4 py-2 font-normal">Domain</th>
                  <th className="px-4 py-2 font-normal">Organization</th>
                  <th className="px-4 py-2 font-normal">Security contact</th>
                  <th className="px-4 py-2 font-normal">Flag</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-edge">
                {rows.map((r) => {
                  const flag = domainFlag(r, orgOf);
                  return (
                    <tr key={r.domain} className="align-top">
                      <td className="px-4 py-2.5">
                        <Link
                          href={`/domain/${encodeURIComponent(r.domain)}`}
                          className="font-mono text-ink underline underline-offset-2 hover:text-alarm"
                        >
                          {r.domain}
                        </Link>
                      </td>
                      <td className="px-4 py-2.5 text-muted">
                        {r.org ?? "—"}
                        {r.suborg ? <span className="text-faint"> · {r.suborg}</span> : null}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-xs text-muted">
                        {r.security_contact_email ?? <span className="text-faint">(none)</span>}
                      </td>
                      <td className="px-4 py-2.5">
                        {flag && flag.severity === "high" ? (
                          <span className="rounded border border-alarm/50 px-1.5 py-0.5 font-mono text-[10px] uppercase text-alarm">
                            contact mismatch
                          </span>
                        ) : flag ? (
                          <span className="font-mono text-[10px] text-faint" title={flag.reason}>
                            foreign contact
                          </span>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
      {!hasQuery && rows.length > 0 ? (
        <p className="text-xs text-faint">Showing {rows.length} of {total.toLocaleString()}. Search to narrow.</p>
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
