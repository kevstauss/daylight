import Link from "next/link";
import { changeCount, domainCount, globalChanges } from "@/lib/data";
import { flags } from "@/lib/flags";
import { EmptyState, Eyebrow, InternalLink, Panel, SeverityBadge, Timestamp } from "@/components/ui";

export const dynamic = "force-dynamic";

const MODULES = [
  { key: "registry", href: "/registry", name: "Ledger", blurb: "Who owns each federal .gov, and every change to the record." },
  { key: "lookout", href: "/lookout", name: "Lookout", blurb: "New subdomains the day their certificate is issued." },
  { key: "floodlight", href: "/floodlight", name: "Floodlight", blurb: "Is this .gov tracking you? Trackers, session replay, the reverse-proxy trick." },
  { key: "receipts", href: "/receipts", name: "Receipts", blurb: "What quietly disappeared — a dated, archived removal ledger." },
  { key: "redtape", href: "/redtape", name: "Redtape", blurb: "Sites collecting personal data with no published privacy filing." },
] as const;

export default function Home() {
  const f = flags();
  const recent = safe(() => globalChanges(9), []);
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

      {live.length > 0 ? (
        <section>
          <Eyebrow>daylight · what it watches</Eyebrow>
          <Panel className="divide-y divide-edge">
            {live.map((m) => (
              <Link
                key={m.key}
                href={m.href}
                className="group flex items-baseline justify-between gap-4 px-4 py-3.5 transition-colors hover:bg-raised"
              >
                <div className="min-w-0">
                  <span className="text-[15px] font-semibold text-ink">{m.name}</span>
                  <span className="ml-2.5 text-sm text-muted">{m.blurb}</span>
                </div>
                <span className="shrink-0 font-mono text-xs text-faint transition-colors group-hover:text-alarm">→</span>
              </Link>
            ))}
          </Panel>
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
