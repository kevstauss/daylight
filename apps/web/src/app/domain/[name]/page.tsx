import type { Metadata } from "next";
import Link from "next/link";
import { synthesizeTitle } from "@daylight/feeds";
import { domainHistoryRows, domainRow, subdomainsForApex, type SubdomainRow } from "@/lib/data";
import { composite, domainFlag } from "@/lib/ledger";
import { flags } from "@/lib/flags";
import { EmptyState, Panel, SeverityBadge, SourceLink, Timestamp } from "@/components/ui";

export const dynamic = "force-dynamic";

const CISA_SOURCE =
  "https://github.com/cisagov/dotgov-data/blob/main/current-federal.csv";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ name: string }>;
}): Promise<Metadata> {
  const { name } = await params;
  return { title: decodeURIComponent(name) };
}

export default async function DomainPage({ params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const domain = decodeURIComponent(name).trim().toLowerCase();
  const row = safe(() => domainRow(domain), null);
  const history = safe(() => domainHistoryRows(domain), []);

  if (!row) {
    return (
      <div className="space-y-4">
        <h1 className="font-mono text-xl text-ink">{domain}</h1>
        <EmptyState
          title="Not in the federal .gov registry."
          hint="Daylight's Ledger watches apex federal .gov domains from CISA's public registry. Subdomains are Lookout's beat (coming in a later phase)."
        />
      </div>
    );
  }

  const flag = safe(() => domainFlag(row), null);
  const f = flags();
  const subdomains = f.lookout ? safe(() => subdomainsForApex(domain), []) : [];
  const comp = safe(() => composite(domain), null);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="font-mono text-2xl text-ink">{row.domain}</h1>
        <Timestamp iso={row.last_seen} prefix="last checked" />
      </div>

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

      <Panel className="px-4 py-4">
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
          <Field label="Organization" value={row.org} />
          <Field label="Suborganization" value={row.suborg} />
          <Field label="Domain type" value={row.domain_type} />
          <Field label="Location" value={[row.city, row.state].filter(Boolean).join(", ") || null} />
          <Field label="Security contact" value={row.security_contact_email} mono />
          <Field label="First seen" value={row.first_seen} mono />
        </dl>
        <p className="mt-4 border-t border-edge pt-3 text-xs text-faint">
          Source: <SourceLink href={CISA_SOURCE}>cisagov/dotgov-data · current-federal.csv</SourceLink>
        </p>
      </Panel>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">History</h2>
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
                      <p className="text-sm text-ink">{synthesizeTitle(c)}</p>
                      <Timestamp iso={c.detected_at} />
                    </div>
                  </li>
                ))}
            </ul>
          </Panel>
        )}
      </section>

      {f.lookout ? (
        <section className="space-y-3">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
              Subdomains (from CT logs)
            </h2>
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
                    <div className="min-w-0 flex-1">
                      <span className="font-mono text-sm text-ink">{s.fqdn}</span>
                      {s.flag_reason ? (
                        <p className="mt-0.5 text-xs text-muted">{s.flag_reason}</p>
                      ) : null}
                    </div>
                    <Timestamp iso={s.first_seen} />
                  </li>
                ))}
              </ul>
            </Panel>
          )}
          <p className="text-xs text-faint">
            <Link href="/lookout" className="text-signal hover:text-ink">
              All new subdomains →
            </Link>
          </p>
        </section>
      ) : null}

      {f.floodlight ? (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Tracker scorecard</h2>
          {comp && comp.scorecards.length > 0 ? (
            <Panel>
              <ul className="divide-y divide-edge">
                {comp.scorecards.map((s) => (
                  <li key={s.url} className="flex items-start gap-3 px-4 py-2.5">
                    <SeverityBadge severity={s.severity ?? "info"} />
                    <div className="min-w-0 flex-1">
                      <span className="truncate font-mono text-sm text-ink">{s.url}</span>
                      <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted">
                        <span>{s.tracker_count ?? 0} trackers</span>
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
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Snapshots &amp; removals</h2>
          {comp && comp.removals.length > 0 ? (
            <Panel>
              <ul className="divide-y divide-edge">
                {comp.removals.map((c) => (
                  <li key={c.id} className="flex items-start gap-3 px-4 py-2.5">
                    <SeverityBadge severity={c.severity} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-ink">{c.reason ?? `${c.field ?? "item"} removed`}</p>
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
        </section>
      ) : null}

      {f.redtape ? (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Privacy filings</h2>
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
                    <Link href="/redtape" className="text-xs text-signal hover:text-ink">
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

function Field({ label, value, mono }: { label: string; value: string | null; mono?: boolean }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-faint">{label}</dt>
      <dd className={`mt-0.5 text-sm text-ink ${mono ? "font-mono" : ""}`}>
        {value && value.trim() ? value : <span className="text-faint">—</span>}
      </dd>
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
