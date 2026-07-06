import type { Metadata } from "next";
import Link from "next/link";
import { synthesizeTitle } from "@daylight/feeds";
import {
  domainFirstSeen,
  domainHistoryRows,
  domainRow,
  scorecardsForHost,
  subdomainRow,
  subdomainsForApex,
  type ScorecardRow,
  type SubdomainRow,
} from "@/lib/data";
import { composite, domainFlag } from "@/lib/ledger";
import { flags } from "@/lib/flags";
import { watchlist } from "@/lib/watchlist";
import {
  EmptyState,
  Eyebrow,
  fmtInstant,
  InternalLink,
  Panel,
  SeverityBadge,
  SourceLink,
  SourceRef,
  Timestamp,
} from "@/components/ui";

export const dynamic = "force-dynamic";

const CISA_SOURCE = "https://github.com/cisagov/dotgov-data/blob/main/current-federal.csv";
const crtsh = (q: string): string => `https://crt.sh/?q=${encodeURIComponent(q)}`;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ name: string }>;
}): Promise<Metadata> {
  const { name } = await params;
  // The App Router already URL-decodes the param; decoding again throws URIError on a bare '%'.
  // safeDecode is idempotent for real domains and never throws.
  return { title: safeDecode(name) };
}

/** Resolve which legit/shadow domain to compare this one against, from watchlist.comparators. */
function comparatorFor(domain: string): string | null {
  const comparators = watchlist()?.comparators ?? {};
  if (comparators[domain]) return comparators[domain];
  for (const [k, v] of Object.entries(comparators)) if (v === domain) return k;
  return null;
}

export default async function DomainPage({ params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const domain = safeDecode(name).trim().toLowerCase();
  const f = flags();
  const row = safe(() => domainRow(domain), null);

  // Not an apex in the registry — but it may be a subdomain Lookout has seen (item 14). Resolve it
  // regardless of the Lookout module flag: the data exists (it's in the subdomains table + the API),
  // so "not in the registry" would be a false negative for a name Daylight demonstrably tracks.
  if (!row) {
    const sub = safe(() => subdomainRow(domain), null);
    if (sub) return <SubdomainView sub={sub} />;
    return (
      <div className="space-y-4">
        <h1 className="font-mono text-xl text-ink">{domain}</h1>
        <EmptyState
          title="Not in the federal .gov registry."
          hint="Daylight's Ledger watches apex federal .gov domains from CISA's public registry, and Lookout records subdomains seen in Certificate Transparency logs. This name matches neither yet."
        />
        <p className="text-sm">
          <InternalLink href={`/registry?q=${encodeURIComponent(domain)}`}>
            Search the registry for “{domain}” →
          </InternalLink>
        </p>
      </div>
    );
  }

  const flag = safe(() => domainFlag(row), null);
  const firstSeen = safe(() => domainFirstSeen(domain), { kind: "seeded" as const, date: row.first_seen });
  const subdomains = f.lookout ? safe(() => subdomainsForApex(domain), []) : [];
  const history = safe(() => domainHistoryRows(domain), []);
  const comp = safe(() => composite(domain), null);
  const watched = (watchlist()?.apexDomains ?? []).includes(domain);
  const counterpart = comparatorFor(domain);
  const flaggedSubs = subdomains.filter((s) => s.flag_severity === "high" || s.flag_severity === "notable").length;
  const sc = comp?.scorecards[0] ?? null;
  const gap = comp?.gaps[0] ?? null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="font-mono text-2xl text-ink">{row.domain}</h1>
          {watched ? (
            <span
              className="rounded-sm border border-alarm/50 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-alarm"
              title="This domain is on the Daylight watchlist — flags on it are raised to the highest severity."
            >
              on the watchlist
            </span>
          ) : null}
        </div>
        <Timestamp iso={row.last_seen} prefix="last checked" />
      </div>

      {/* Answer strip — the four questions above the fold, each anchoring to its section. */}
      <div className="flex flex-wrap gap-2 text-xs">
        <AnswerChip href="#ownership" label="owner" value={row.org || "—"} />
        <AnswerChip href="#history" label="changes" value={String(history.length)} />
        {f.lookout ? (
          <AnswerChip
            href="#subdomains"
            label="subdomains"
            value={`${subdomains.length}${flaggedSubs ? ` · ${flaggedSubs} flagged` : ""}`}
            alarm={flaggedSubs > 0}
          />
        ) : null}
        {f.floodlight ? (
          <AnswerChip
            href="#trackers"
            label="tracking"
            value={
              sc
                ? `${sc.tracker_count ?? 0} tracker${(sc.tracker_count ?? 0) === 1 ? "" : "s"}${sc.session_replay ? " · replay" : ""}${sc.first_party_proxied ? " · proxied" : ""}`
                : "not scanned"
            }
            alarm={!!(sc && (sc.session_replay || sc.first_party_proxied))}
          />
        ) : null}
        {f.redtape ? (
          <AnswerChip
            href="#filings"
            label="filing"
            value={
              gap
                ? gap.gap_assessment === "no_filing"
                  ? "no PIA/SORN"
                  : gap.gap_assessment === "incomplete_filing"
                    ? "incomplete"
                    : "on file"
                : "—"
            }
            alarm={gap?.gap_assessment === "no_filing"}
          />
        ) : null}
      </div>

      {counterpart ? (
        <Panel className="px-4 py-3">
          <p className="text-sm text-muted">
            Daylight tracks <span className="font-mono text-ink">{domain}</span> alongside its
            comparator <span className="font-mono text-ink">{counterpart}</span>.{" "}
            <Link
              href={`/compare?a=${encodeURIComponent(domain)}&b=${encodeURIComponent(counterpart)}`}
              className="link"
            >
              Compare them side by side →
            </Link>
          </p>
        </Panel>
      ) : null}

      {flag ? (
        <Panel className={`px-4 py-3 ${flag.severity === "high" ? "border-alarm/50" : ""}`}>
          <div className="flex items-center gap-2">
            <SeverityBadge severity={flag.severity} />
            <span className="text-sm text-ink">Contact-domain mismatch</span>
          </div>
          <p className="mt-1 text-sm text-muted">
            The published {row.domain} security contact is{" "}
            <span className="font-mono text-ink">{row.security_contact_email}</span> — an address at{" "}
            <span className="font-mono text-ink">{flag.contactDomain}</span>, which is not{" "}
            {row.domain} and not a recognized central security mailbox. Stated as observed; see the
            source row below.
          </p>
        </Panel>
      ) : null}

      <section id="ownership" className="scroll-mt-4">
        <Eyebrow>ledger · ownership</Eyebrow>
        <Panel className="px-4 py-4">
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
            <Field label="Organization" value={row.org} />
            <Field label="Suborganization" value={row.suborg} />
            <Field label="Domain type" value={row.domain_type} />
            <Field label="Location" value={[row.city, row.state].filter(Boolean).join(", ") || null} />
            <Field label="Security contact" value={row.security_contact_email} mono />
            <FirstSeenField provenance={firstSeen} fallbackIso={row.first_seen} />
          </dl>
          <p className="mt-4 border-t border-edge pt-3 text-xs text-faint">
            Source: <SourceLink href={CISA_SOURCE}>cisagov/dotgov-data · current-federal.csv</SourceLink>
          </p>
        </Panel>
      </section>

      <section id="history" className="scroll-mt-4 space-y-3">
        <Eyebrow>ledger · history</Eyebrow>
        {history.length === 0 ? (
          <EmptyState
            title="No recorded changes yet."
            hint="Ownership and contact changes will appear here as the daily Ledger pass detects them."
          />
        ) : (
          <Panel>
            <ul className="divide-y divide-edge">
              {history
                .slice()
                .reverse()
                .map((c) => (
                  <li key={c.id} className="flex items-start gap-3 px-4 py-3">
                    <SeverityBadge severity={c.severity} />
                    <div className="min-w-0 flex-1">
                      <p className="break-words text-sm text-ink">{synthesizeTitle(c)}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5">
                        <Timestamp iso={c.detected_at} />
                        <SourceRef href={c.source_url} />
                        <Link
                          href={`/change/${c.id}`}
                          className="font-mono text-xs text-faint underline decoration-edgeStrong underline-offset-2 hover:text-ink"
                        >
                          cite →
                        </Link>
                      </div>
                    </div>
                  </li>
                ))}
            </ul>
          </Panel>
        )}
      </section>

      {f.lookout ? (
        <section id="subdomains" className="scroll-mt-4 space-y-3">
          <div className="flex items-baseline justify-between">
            <Eyebrow>lookout · subdomains (from Certificate Transparency logs)</Eyebrow>
            <span className="font-mono text-xs text-faint">{subdomains.length}</span>
          </div>
          {subdomains.length === 0 ? (
            <EmptyState
              title="No subdomains recorded for this apex yet."
              hint="Lookout records subdomains it sees in public Certificate Transparency logs. Existence-only."
            />
          ) : (
            <Panel>
              <ul className="divide-y divide-edge">
                {subdomains.map((s: SubdomainRow) => (
                  <li key={s.fqdn} className="flex items-start gap-3 px-4 py-2.5">
                    <SeverityBadge severity={s.flag_severity ?? "info"} />
                    <div className="flex min-w-0 flex-1 flex-col gap-y-1 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
                      <div className="min-w-0">
                        <Link
                          href={`/domain/${encodeURIComponent(s.fqdn)}`}
                          className="break-all font-mono text-sm text-ink underline decoration-transparent underline-offset-2 hover:decoration-alarm"
                        >
                          {s.fqdn}
                        </Link>
                        {s.flag_reason ? <p className="mt-0.5 break-words text-xs text-muted">{s.flag_reason}</p> : null}
                      </div>
                      <Timestamp iso={s.first_seen} />
                    </div>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
          <p className="text-xs text-faint">
            <Link href="/lookout" className="link">
              All new subdomains →
            </Link>
          </p>
        </section>
      ) : null}

      {f.floodlight ? (
        <section id="trackers" className="scroll-mt-4 space-y-3">
          <Eyebrow>floodlight · tracker scorecard</Eyebrow>
          {comp && comp.scorecards.length > 0 ? (
            <Panel>
              <ul className="divide-y divide-edge">
                {comp.scorecards.map((s) => (
                  <li key={s.url} className="flex items-start gap-3 px-4 py-2.5">
                    <SeverityBadge severity={s.severity ?? "info"} />
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/floodlight/${encodeURIComponent(s.url)}`}
                        className="truncate font-mono text-sm text-ink underline decoration-transparent underline-offset-2 hover:decoration-alarm"
                      >
                        {s.url}
                      </Link>
                      <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted">
                        <span>{s.tracker_count ?? 0} tracker{(s.tracker_count ?? 0) === 1 ? "" : "s"}</span>
                        <span>session replay {s.session_replay ? "on" : "off"}</span>
                        <span>reverse-proxy {s.first_party_proxied ? "detected" : "no"}</span>
                        <span>privacy notice {s.privacy_notice_url ? "present" : "absent"}</span>
                      </div>
                    </div>
                    <Timestamp iso={s.scanned_at} />
                  </li>
                ))}
              </ul>
            </Panel>
          ) : (
            <EmptyState title="Not yet scanned by Floodlight." />
          )}
        </section>
      ) : null}

      {f.receipts ? (
        <section id="snapshots" className="scroll-mt-4 space-y-3">
          <Eyebrow>receipts · snapshots &amp; removals</Eyebrow>
          {comp && comp.removals.length > 0 ? (
            <Panel>
              <ul className="divide-y divide-edge">
                {comp.removals.map((c) => (
                  <li key={c.id} className="flex items-start gap-3 px-4 py-2.5">
                    <SeverityBadge severity={c.severity} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-ink">{c.reason ?? `${c.field ?? "item"} removed`}</p>
                      <SourceRef href={c.source_url} />
                    </div>
                    <Timestamp iso={c.detected_at} />
                  </li>
                ))}
              </ul>
            </Panel>
          ) : (
            <EmptyState
              title={comp && comp.snapshots.length > 0 ? "Snapshots on file; no removals detected." : "Not yet snapshotted by Receipts."}
            />
          )}
          {comp && comp.snapshots.length > 0 ? (
            <Link href={`/receipts/${encodeURIComponent(comp.snapshots[0]!.url)}`} className="link text-xs">
              View snapshot history →
            </Link>
          ) : null}
        </section>
      ) : null}

      {f.redtape ? (
        <section id="filings" className="scroll-mt-4 space-y-3">
          <Eyebrow>redtape · privacy filings</Eyebrow>
          {comp && comp.gaps.length > 0 ? (
            <Panel>
              <ul className="divide-y divide-edge">
                {comp.gaps.map((g) => (
                  <li key={g.id} className="px-4 py-2.5">
                    <p className="text-sm text-ink">
                      {g.gap_assessment === "no_filing"
                        ? "No published PIA/SORN found"
                        : g.gap_assessment === "incomplete_filing"
                          ? "Filing appears incomplete"
                          : "Filing found"}{" "}
                      <span className="text-faint">as of {g.created_at.slice(0, 10)}</span>
                    </p>
                    {g.fact_vs_inference_notes ? (
                      <p className="mt-0.5 text-xs text-muted">{g.fact_vs_inference_notes}</p>
                    ) : null}
                    <Link href="/redtape" className="text-xs link">
                      evidence + search trail →
                    </Link>
                  </li>
                ))}
              </ul>
            </Panel>
          ) : (
            <EmptyState title="No reviewed privacy-filing gaps for this domain." />
          )}
        </section>
      ) : null}
    </div>
  );
}

/** A subdomain (non-apex) view — the investigation's key artifacts are subdomains (item 14). */
function SubdomainView({ sub }: { sub: SubdomainRow }) {
  const labels = safeParse(sub.labels);
  const scorecards = safe(() => scorecardsForHost(sub.fqdn), [] as ScorecardRow[]);
  return (
    <div className="space-y-6">
      <div>
        <nav aria-label="Breadcrumb" className="mb-1 font-mono text-xs text-faint">
          <Link href={`/domain/${encodeURIComponent(sub.apex)}`} className="link">
            {sub.apex}
          </Link>{" "}
          / {sub.fqdn}
        </nav>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="break-all font-mono text-2xl text-ink">{sub.fqdn}</h1>
          <SeverityBadge severity={sub.flag_severity ?? "info"} />
        </div>
        <p className="mt-1 text-sm text-muted">
          Seen in public Certificate Transparency logs under{" "}
          <Link href={`/domain/${encodeURIComponent(sub.apex)}`} className="link">
            {sub.apex}
          </Link>
          {sub.apex_owner_org ? ` (${sub.apex_owner_org})` : ""}. Existence-only — Daylight records
          that a certificate exists; it never connects to this host.
        </p>
      </div>

      {sub.flag_reason ? (
        <Panel className={`px-4 py-3 ${sub.flag_severity === "high" ? "border-alarm/50" : ""}`}>
          <p className="text-sm text-ink">{sub.flag_reason}</p>
        </Panel>
      ) : null}

      <Panel className="px-4 py-4">
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
          <Field label="Apex" value={sub.apex} mono />
          <Field label="Apex owner" value={sub.apex_owner_org} />
          <Field label="Labels" value={labels.length ? labels.join(", ") : null} mono />
          <Field label="First seen (UTC)" value={fmtInstant(sub.first_seen)} mono />
          <Field label="Last seen (UTC)" value={fmtInstant(sub.last_seen)} mono />
        </dl>
        <p className="mt-4 border-t border-edge pt-3 text-xs text-faint">
          Source: <SourceLink href={crtsh(sub.fqdn)}>crt.sh · {sub.fqdn}</SourceLink>
        </p>
      </Panel>

      {scorecards.length > 0 ? (
        <section className="space-y-3">
          <Eyebrow>floodlight · scorecards on this host</Eyebrow>
          <Panel>
            <ul className="divide-y divide-edge">
              {scorecards.map((s) => (
                <li key={s.url} className="flex items-start gap-3 px-4 py-2.5">
                  <SeverityBadge severity={s.severity ?? "info"} />
                  <Link
                    href={`/floodlight/${encodeURIComponent(s.url)}`}
                    className="min-w-0 flex-1 truncate font-mono text-sm text-ink hover:text-alarm"
                  >
                    {s.url}
                  </Link>
                  <Timestamp iso={s.scanned_at} />
                </li>
              ))}
            </ul>
          </Panel>
        </section>
      ) : null}
    </div>
  );
}

function Field({
  label,
  value,
  mono,
  hint,
}: {
  label: string;
  value: string | null;
  mono?: boolean;
  hint?: string;
}) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-faint">{label}</dt>
      <dd className={`mt-0.5 text-sm text-ink ${mono ? "font-mono" : ""}`}>
        {value && value.trim() ? value : <span className="text-faint">—</span>}
      </dd>
      {hint ? <dd className="mt-0.5 text-xs leading-snug text-faint">{hint}</dd> : null}
    </div>
  );
}

/** The "first seen" field, told honestly: a real registry-appearance date when we have one, a
 *  "Longstanding" badge for domains on the record since it began (2019), else "on our record since".
 *  Never labels a seed date as if it were a registration date. */
function FirstSeenField({
  provenance,
  fallbackIso,
}: {
  provenance: { kind: "registered" | "longstanding" | "seeded"; date: string };
  fallbackIso: string;
}) {
  if (provenance.kind === "registered") {
    return <Field label="First appeared" value={fmtInstant(provenance.date)} mono hint="in the public .gov registry" />;
  }
  if (provenance.kind === "longstanding") {
    return <Field label="First seen" value="Longstanding" hint="on the public .gov record since it began · Feb 2019" />;
  }
  return <Field label="On our record since" value={fmtInstant(fallbackIso)} mono />;
}

function AnswerChip({
  href,
  label,
  value,
  alarm,
}: {
  href: string;
  label: string;
  value: string;
  alarm?: boolean;
}) {
  return (
    <a
      href={href}
      className={`inline-flex min-h-6 items-center gap-1.5 rounded-sm border px-2 py-1 ${
        alarm ? "border-alarm/50 text-alarm" : "border-edge text-muted hover:border-ink hover:text-ink"
      }`}
    >
      <span className="font-mono text-[10px] uppercase tracking-wide text-faint">{label}</span>
      <span className="font-mono">{value}</span>
    </a>
  );
}

function safeParse(json: string | null): string[] {
  try {
    return JSON.parse(json ?? "[]") as string[];
  } catch {
    return [];
  }
}

/** The App Router already decodes route params; a second decode throws on a bare '%'. Decode
 *  defensively so a malformed value can't 500 the page. */
function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}
