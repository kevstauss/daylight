import { notFound } from "next/navigation";
import Link from "next/link";
import type { ChangeRow, SubdomainRow } from "@/lib/data";
import { githubActivity, githubRepoStats, searchSubdomains, subdomainCount } from "@/lib/data";
import { flags } from "@/lib/flags";
import { EmptyState, Eyebrow, JumpRow, Panel, SeverityBadge, Timestamp } from "@/components/ui";
import { ModuleIcon } from "@/components/module-icon";
import { pageMetadata, PAGE_DESCRIPTIONS } from "@/lib/seo";
import { JsonLd } from "@/components/json-ld";
import { breadcrumbLd, webPageLd } from "@/lib/structured-data";

export const metadata = pageMetadata({
  title: "Lookout",
  description: PAGE_DESCRIPTIONS.lookout,
  path: "/lookout",
  feeds: { rss: "/lookout/feed.xml", json: "/lookout/feed.json" },
});
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
  const f = flags();
  if (!f.lookout) notFound();
  const sp = await searchParams;
  const q = str(sp.q);
  const severity = ["high", "notable", "info"].includes(str(sp.severity)) ? str(sp.severity) : undefined;

  const rows = safe(() => searchSubdomains({ q: q || undefined, severity, limit: 200 }), []);
  const total = safe(() => subdomainCount(), 0);
  const ghEvents = f.github ? safe(() => githubActivity(30), [] as ChangeRow[]) : [];
  const ghStats = f.github ? safe(() => githubRepoStats(), { repos: 0, orgs: 0 }) : { repos: 0, orgs: 0 };

  return (
    <div className="space-y-6">
      <JsonLd data={webPageLd({ type: "CollectionPage", name: "Lookout", description: PAGE_DESCRIPTIONS.lookout, path: "/lookout" })} />
      <JsonLd data={breadcrumbLd([{ name: "Daylight", path: "/" }, { name: "Lookout", path: "/lookout" }])} />
      <div>
        <div className="flex items-center gap-2.5"><ModuleIcon name="lookout" className="h-6 w-6 shrink-0 text-ink" /><h1 className="text-2xl font-semibold tracking-tight">Lookout</h1></div>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          New <code className="font-mono text-ink">.gov</code> subdomains as they appear in public
          Certificate Transparency logs — flagged when a name looks like a preview/staging/infra
          host or mimics another agency&rsquo;s function. Existence-only: we note that a cert exists;
          we never connect to the host. Watching {total.toLocaleString()} known subdomains
          {f.github ? ", plus new public repositories under watched federal GitHub orgs" : ""}.
        </p>
      </div>

      {f.github ? (
        <JumpRow
          links={[
            { href: "#subdomains", label: "new subdomains" },
            { href: "#github", label: "federal GitHub activity" },
          ]}
        />
      ) : null}

      <section id="subdomains" className="scroll-mt-4 space-y-4">
      {f.github ? <Eyebrow>lookout · new subdomains (certificate transparency)</Eyebrow> : null}
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
      </section>

      {/* ── Federal GitHub activity — the same "existence, never access" watch, aimed at code ── */}
      {f.github ? (
        <section id="github" className="scroll-mt-4 space-y-3">
          <Eyebrow>lookout · federal GitHub activity</Eyebrow>
          <p className="max-w-2xl text-sm text-muted">
            New public repositories and first commits under watched federal GitHub organizations,
            from the public GitHub API. A repo appearing here is often the first public trace of a
            project — sometimes before its <code className="font-mono text-ink">.gov</code> exists.
            {ghStats.repos > 0
              ? ` Tracking ${ghStats.repos.toLocaleString()} public repos across ${ghStats.orgs} org${ghStats.orgs === 1 ? "" : "s"}.`
              : ""}
          </p>
          {ghEvents.length === 0 ? (
            <EmptyState
              title="No new repos observed yet."
              hint="The watched orgs' existing repositories were baselined silently; an event lands here the first time a new repo or a first commit appears after that baseline."
            />
          ) : (
            <Panel>
              <ul className="divide-y divide-edge">
                {ghEvents.map((c) => (
                  <li key={c.id} className="flex items-start gap-3 px-4 py-3">
                    <SeverityBadge severity={c.severity} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-ink">{c.reason}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 text-xs text-faint">
                        <Link href={`/domain/${encodeURIComponent(c.domain)}`} className="link">
                          {c.domain}
                        </Link>
                        <Timestamp iso={c.detected_at} prefix="observed" />
                        {c.source_url ? (
                          <a href={c.source_url} className="link" rel="nofollow noopener">
                            source →
                          </a>
                        ) : null}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </section>
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
