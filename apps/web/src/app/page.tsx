import Link from "next/link";
import { changeCount, domainCount, globalChanges } from "@/lib/data";
import { flags } from "@/lib/flags";
import { SITE_TAGLINE } from "@/lib/site";
import { EmptyState, InternalLink, Panel, SeverityBadge, Timestamp } from "@/components/ui";

export const dynamic = "force-dynamic";

export default function Home() {
  const f = flags();
  const recent = safe(() => globalChanges(8), []);
  const domains = safe(() => domainCount(), 0);
  const changes = safe(() => changeCount(), 0);
  const feedHref = f.feed ? "/ledger/feed.xml" : "/feed.xml";

  return (
    <div className="space-y-10">
      <section className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          The ledger is always watching.
        </h1>
        <p className="max-w-2xl text-muted">{SITE_TAGLINE}</p>
        <p className="max-w-2xl text-sm text-muted">
          Daylight reads the public federal <code className="font-mono text-ink">.gov</code>{" "}
          ownership registry every day and keeps a timestamped record of who owns what — and of
          every change. Reporters can subscribe to a name; citizens can ask &ldquo;who owns this{" "}
          .gov?&rdquo; Everything is observational, on public data.
        </p>
        <div className="flex flex-wrap gap-3 pt-1 font-mono text-xs">
          {f.registry ? (
            <Link
              href="/registry"
              className="rounded border border-edge bg-panel px-3 py-1.5 text-ink hover:border-signal"
            >
              Search the registry →
            </Link>
          ) : null}
          <Link
            href={feedHref}
            className="rounded border border-edge bg-panel px-3 py-1.5 text-muted hover:text-ink"
          >
            Change feed (RSS)
          </Link>
          <Link
            href="/methods"
            className="rounded border border-edge bg-panel px-3 py-1.5 text-muted hover:text-ink"
          >
            Methods &amp; sources
          </Link>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat label="Domains watched" value={domains} />
        <Stat label="Changes recorded" value={changes} />
        <Stat label="Scope" value="apex .gov" />
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Explore</h2>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {[
            f.registry && { href: "/registry", title: "Ledger", blurb: "Who owns each federal .gov, and every ownership change." },
            f.lookout && { href: "/lookout", title: "Lookout", blurb: "New subdomains from certificate transparency logs." },
            f.floodlight && { href: "/floodlight", title: "Floodlight", blurb: "Is this gov site tracking you? Tracker scorecards." },
            f.receipts && { href: "/receipts", title: "Receipts", blurb: "The removal ledger — what quietly disappeared." },
            f.redtape && { href: "/redtape", title: "Redtape", blurb: "Reviewed PIA/SORN filing gaps, with evidence." },
          ]
            .filter((m): m is { href: string; title: string; blurb: string } => Boolean(m))
            .map((m) => (
              <Link
                key={m.href}
                href={m.href}
                className="rounded-lg border border-edge bg-panel px-4 py-3 hover:border-signal"
              >
                <div className="text-sm font-semibold text-ink">{m.title}</div>
                <div className="mt-0.5 text-xs text-muted">{m.blurb}</div>
              </Link>
            ))}
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
            Recent activity
          </h2>
          <InternalLink href="/status">system status →</InternalLink>
        </div>
        {recent.length === 0 ? (
          <EmptyState
            title="No changes recorded yet."
            hint="Once the daily Ledger pass runs, ownership and contact changes appear here."
          />
        ) : (
          <Panel>
            <ul className="divide-y divide-edge">
              {recent.map((c) => (
                <li key={c.id} className="flex items-start gap-3 px-4 py-3">
                  <SeverityBadge severity={c.severity} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-ink">
                      {c.reason ?? `${c.field ?? "record"} ${c.kind} on ${c.domain}`}
                    </p>
                    <div className="mt-0.5 flex items-center gap-3">
                      {f.registry ? (
                        <InternalLink href={`/domain/${encodeURIComponent(c.domain)}`}>
                          {c.domain}
                        </InternalLink>
                      ) : (
                        <span className="font-mono text-xs text-muted">{c.domain}</span>
                      )}
                      <Timestamp iso={c.detected_at} />
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </Panel>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg border border-edge bg-panel px-4 py-3">
      <div className="font-mono text-xl text-ink">{typeof value === "number" ? value.toLocaleString() : value}</div>
      <div className="mt-0.5 text-xs text-faint">{label}</div>
    </div>
  );
}

/** Render gracefully even before the DB/migrations exist (walking skeleton). */
function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}
