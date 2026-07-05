import Link from "next/link";
import { describeFinding } from "@daylight/feeds";
import { changeCount, domainCount, featuredFindings, globalChanges } from "@/lib/data";
import { flags, type Flags } from "@/lib/flags";
import { EmptyState, Eyebrow, InternalLink, Panel, SeverityBadge, SourceRef, Timestamp } from "@/components/ui";
import { GlobalSearch } from "@/components/global-search";
import { ModuleIcon } from "@/components/module-icon";

export const dynamic = "force-dynamic";

const MODULES = [
  { key: "registry", href: "/registry", name: "Ledger", blurb: "Who owns each federal .gov, and every change to the record." },
  { key: "lookout", href: "/lookout", name: "Lookout", blurb: "New subdomains the day their certificate is issued." },
  { key: "foundry", href: "/foundry", name: "Foundry", blurb: "Which build vendors quietly serve many agencies at once — and what's staged but not yet launched." },
  { key: "floodlight", href: "/floodlight", name: "Floodlight", blurb: "Is this .gov tracking you? Trackers, session replay, and tracking disguised as the site's own traffic." },
  { key: "receipts", href: "/receipts", name: "Receipts", blurb: "What quietly disappeared — a dated, archived removal ledger." },
  { key: "redtape", href: "/redtape", name: "Redtape", blurb: "Sites collecting personal data with no published privacy filing." },
] as const;

/** Display metadata for the module that emitted a change — keyed by the `module` value stored on the
 *  change (note: a Ledger change's module is "ledger", which links to /ledger, not the /registry
 *  search). `flagKey` gates whether the module name links to its (possibly still-flagged-off) page.
 *  The per-card headline + "why it matters" come from describeFinding(), not from here. */
const CHANGE_MODULE_META: Record<
  string,
  { name: string; href: string; iconKey: string; flagKey: keyof Flags }
> = {
  ledger: { name: "Ledger", href: "/ledger", iconKey: "registry", flagKey: "registry" },
  lookout: { name: "Lookout", href: "/lookout", iconKey: "lookout", flagKey: "lookout" },
  floodlight: { name: "Floodlight", href: "/floodlight", iconKey: "floodlight", flagKey: "floodlight" },
  receipts: { name: "Receipts", href: "/receipts", iconKey: "receipts", flagKey: "receipts" },
  foundry: { name: "Foundry", href: "/foundry", iconKey: "foundry", flagKey: "foundry" },
};

export default function Home() {
  const f = flags();
  const featured = safe(() => featuredFindings(3), []);
  const featuredIds = new Set(featured.map((c) => c.id));
  // The dense log below is the raw ledger; drop anything already surfaced above so the two sections
  // don't echo each other.
  const recent = safe(() => globalChanges(12), []).filter((c) => !featuredIds.has(c.id)).slice(0, 9);
  const domains = safe(() => domainCount(), 0);
  const changes = safe(() => changeCount(), 0);
  const live = MODULES.filter((m) => f[m.key as keyof typeof f]);

  return (
    <div className="space-y-14">
      <section className="space-y-6">
        <h1 className="max-w-3xl text-[30px] font-extrabold leading-[1.06] tracking-[-0.02em] text-ink sm:text-[42px]">
          A public record of who runs the federal web — and what quietly changes when no one is looking.
        </h1>
        <p className="max-w-measure text-[15px] leading-relaxed text-muted">
          Daylight reads already-public data — the federal <span className="font-mono text-ink">.gov</span>{" "}
          ownership registry, certificate transparency logs, live page source — and keeps a
          timestamped, source-linked record of it. Reporters can subscribe to a name; anyone can ask
          who owns a <span className="font-mono text-ink">.gov</span> and whether it&rsquo;s watching them.
        </p>

        <GlobalSearch variant="hero" />

        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-y border-edge py-3">
          <Figure n={domains.toLocaleString()} label="domains watched" />
          <Figure n={changes.toLocaleString()} label="changes recorded" />
          <Figure n={String(live.length)} label="modules live" />
          <span className="font-mono text-xs text-faint">scope: apex .gov</span>
        </div>

        <div className="flex flex-wrap gap-x-5 gap-y-2 pt-1 text-sm">
          {f.registry ? <InternalLink href="/registry">Search the registry →</InternalLink> : null}
          <InternalLink href={f.feed ? "/ledger/feed.xml" : "/feed.xml"}>Subscribe (RSS)</InternalLink>
          <InternalLink href="/methods">How this works</InternalLink>
        </div>
      </section>

      {featured.length > 0 ? (
        <section>
          <Eyebrow>daylight · what we&rsquo;re seeing</Eyebrow>
          <p className="mb-4 max-w-measure text-sm leading-relaxed text-muted">
            A rotating look at what Daylight has noticed lately, in plain language — each observation
            drawn straight from public data, with a link to the full, timestamped finding.
          </p>
          <div className="grid gap-3">
            {featured.map((c) => {
              const m = CHANGE_MODULE_META[c.module];
              const moduleLive = m ? f[m.flagKey] : false;
              const { headline, why } = describeFinding(c);
              return (
                <article key={c.id} className="rounded-lg border border-edge bg-panel p-4 sm:p-5">
                  <div className="flex items-center gap-2.5">
                    <SeverityBadge severity={c.severity} />
                    {m ? (
                      <span className="flex items-center gap-1.5">
                        <ModuleIcon name={m.iconKey} className="h-4 w-4 shrink-0 text-muted" />
                        {moduleLive ? (
                          <InternalLink href={m.href}>{m.name}</InternalLink>
                        ) : (
                          <span className="text-sm font-medium text-muted">{m.name}</span>
                        )}
                      </span>
                    ) : (
                      <span className="font-mono text-xs uppercase tracking-wide text-faint">
                        {c.module}
                      </span>
                    )}
                  </div>
                  <Link
                    href={`/change/${c.id}`}
                    className="group mt-2.5 block text-[16px] font-semibold leading-snug tracking-tight text-ink hover:text-alarm"
                  >
                    {headline}
                    <span className="ml-1 font-mono text-sm text-faint transition-colors group-hover:text-alarm">
                      →
                    </span>
                  </Link>
                  {why ? (
                    <p className="mt-1.5 max-w-measure text-sm leading-relaxed text-muted">{why}</p>
                  ) : null}
                  <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-edge pt-3">
                    {f.registry ? (
                      <InternalLink href={`/domain/${encodeURIComponent(c.domain)}`}>
                        <span className="font-mono text-xs">{c.domain}</span>
                      </InternalLink>
                    ) : (
                      <span className="font-mono text-xs text-muted">{c.domain}</span>
                    )}
                    <Timestamp iso={c.detected_at} prefix="detected" />
                    <SourceRef href={c.source_url} />
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ) : null}

      {live.length > 0 ? (
        <section>
          <Eyebrow>daylight · what it watches</Eyebrow>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {live.map((m) => (
              <Link
                key={m.key}
                href={m.href}
                className="group flex items-start gap-3.5 rounded-lg border border-edge bg-panel p-4 transition-colors hover:border-edgeStrong hover:bg-raised sm:gap-4 sm:p-5"
              >
                <ModuleIcon
                  name={m.key}
                  className="mt-0.5 h-6 w-6 shrink-0 text-muted transition-colors group-hover:text-ink sm:h-7 sm:w-7"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[17px] font-bold tracking-tight text-ink">{m.name}</span>
                    <span className="shrink-0 font-mono text-xs text-faint transition-colors group-hover:text-alarm">
                      →
                    </span>
                  </div>
                  <p className="mt-1 text-sm leading-snug text-muted">{m.blurb}</p>
                </div>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      <section>
        <div className="mb-2 flex items-baseline justify-between">
          <Eyebrow>changes · most recent</Eyebrow>
          <InternalLink href="/status">System status →</InternalLink>
        </div>
        {recent.length === 0 ? (
          <EmptyState
            title="No changes recorded yet."
            hint="Once the daily passes run, every ownership or contact change lands here — timestamped and linked to its public source."
          />
        ) : (
          <Panel className="divide-y divide-edge">
            {recent.map((c) => (
              <div key={c.id} className="flex items-start gap-3 px-4 py-3">
                <SeverityBadge severity={c.severity} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm leading-snug text-ink">
                    {c.reason ?? `${c.field ?? "record"} ${c.kind} on ${c.domain}`}
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5">
                    {f.registry ? (
                      <InternalLink href={`/domain/${encodeURIComponent(c.domain)}`}>
                        <span className="font-mono text-xs">{c.domain}</span>
                      </InternalLink>
                    ) : (
                      <span className="font-mono text-xs text-muted">{c.domain}</span>
                    )}
                    <Timestamp iso={c.detected_at} />
                    <SourceRef href={c.source_url} />
                  </div>
                </div>
              </div>
            ))}
          </Panel>
        )}
      </section>
    </div>
  );
}

function Figure({ n, label }: { n: string; label: string }) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="font-mono text-base font-semibold tabular-nums text-ink">{n}</span>
      <span className="text-xs text-faint">{label}</span>
    </span>
  );
}

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}
