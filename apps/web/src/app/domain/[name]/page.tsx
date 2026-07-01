import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { synthesizeTitle } from "@daylight/feeds";
import { domainHistoryRows, domainRow } from "@/lib/data";
import { domainFlag } from "@/lib/ledger";
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
  if (!flags().registry) notFound();
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
