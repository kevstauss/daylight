import type { ReactNode } from "react";
import Link from "next/link";
import { watchlist } from "@/lib/watchlist";
import { TIPS_EMAIL } from "@/lib/site";
import { Eyebrow, InternalLink, Panel } from "@/components/ui";
import { pageMetadata, PAGE_DESCRIPTIONS } from "@/lib/seo";

export const metadata = pageMetadata({
  title: "Watchlist",
  description: PAGE_DESCRIPTIONS.watchlist,
  path: "/watchlist",
});
export const dynamic = "force-dynamic";

const submitHref = `mailto:${TIPS_EMAIL}?subject=${encodeURIComponent(
  "Watchlist submission",
)}&body=${encodeURIComponent(
  "Domain or organization to watch:\n\nWhy it matters:\n\nPublic source (link):\n",
)}`;

export default function WatchlistPage() {
  const wl = watchlist();

  return (
    <div className="space-y-8">
      <div>
        <Eyebrow>daylight · watchlist</Eyebrow>
        <h1 className="text-2xl font-semibold tracking-tight">Watchlist</h1>
        <p className="mt-1 max-w-measure text-sm text-muted">
          The identities Daylight watches most closely. When a <strong className="text-ink">watched
          organization</strong> gains or changes a domain, or a <strong className="text-ink">watched
          email</strong> appears as any security contact, the change is flagged high-severity in{" "}
          <InternalLink href="/ledger?flag=watchlist">Activity</InternalLink>. Everything Daylight
          records is public regardless — the watchlist just decides what gets the loudest flag. It&rsquo;s
          a curated list, seeded from public reporting.
        </p>
        <a
          href={submitHref}
          className="mt-3 inline-flex items-center gap-1.5 rounded border border-edgeStrong px-3 py-1.5 font-mono text-xs text-ink transition-colors hover:border-ink"
        >
          Suggest a domain or organization to watch →
        </a>
      </div>

      {!wl ? (
        <Panel className="px-4 py-6">
          <p className="text-sm text-muted">Watchlist configuration is unavailable.</p>
        </Panel>
      ) : (
        <>
          <Group title="Watched organizations" note="Flagged when they gain or change a .gov.">
            {[...wl.orgWatch, ...wl.suborgWatch].map((o) => (
              <Tag key={o}>{o}</Tag>
            ))}
          </Group>

          <Group title="Watched contacts" note="Flagged when this email appears as any security contact.">
            {wl.personWatch.map((p) => (
              <Tag key={p} mono>
                {p}
              </Tag>
            ))}
          </Group>

          <Group title="Watched domains" note="Ownership + certificates tracked closely.">
            {wl.apexDomains.map((d) => (
              <DomainTag key={d} domain={d} />
            ))}
          </Group>

          {wl.subdomainApexes.length > 0 ? (
            <Group title="Watched subdomain hosts" note="Enumerated for subdomain-hosted programs.">
              {wl.subdomainApexes.map((d) => (
                <DomainTag key={d} domain={d} />
              ))}
            </Group>
          ) : null}

          {Object.keys(wl.comparators).length > 0 ? (
            <Group
              title="Known shadow references"
              note="A name we compare against its real counterpart (shadow-vs-real)."
            >
              {Object.entries(wl.comparators).map(([shadow, real]) => (
                <Tag key={shadow} mono>
                  {shadow} → {real}
                </Tag>
              ))}
            </Group>
          ) : null}
        </>
      )}

      <p className="max-w-measure text-xs text-faint">
        Seeing something Daylight should watch — a `.gov` collecting data quietly, an org spinning up
        new domains, a contact that doesn&rsquo;t belong?{" "}
        <a href={submitHref} className="link">
          Send it in
        </a>
        . Public sources only.
      </p>
    </div>
  );
}

function Group({ title, note, children }: { title: string; note: string; children: React.ReactNode }) {
  const arr = Array.isArray(children) ? children : [children];
  return (
    <section>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink">{title}</h2>
        <span className="text-xs text-faint">{note}</span>
      </div>
      {arr.filter(Boolean).length === 0 ? (
        <p className="mt-2 text-sm text-muted">None.</p>
      ) : (
        <div className="mt-2 flex flex-wrap gap-1.5">{children}</div>
      )}
    </section>
  );
}

function Tag({ children, mono }: { children: React.ReactNode; mono?: boolean }) {
  return (
    <span
      className={`rounded-sm border border-edgeStrong bg-panel px-2 py-1 text-xs text-ink ${mono ? "font-mono" : ""}`}
    >
      {children}
    </span>
  );
}

function DomainTag({ domain }: { domain: string }) {
  return (
    <Link
      href={`/domain/${encodeURIComponent(domain)}`}
      className="rounded-sm border border-edgeStrong bg-panel px-2 py-1 font-mono text-xs text-ink transition-colors hover:border-ink"
    >
      {domain}
    </Link>
  );
}
