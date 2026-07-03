import type { Metadata } from "next";
import { analyticsSummary, type AnalyticsSummary } from "@/lib/data";
import { EmptyState, Eyebrow, InternalLink, Panel } from "@/components/ui";
import { FUNDING_URL } from "@/lib/site";

export const metadata: Metadata = { title: "Privacy" };
export const dynamic = "force-dynamic";

// The pledge — each is checked against the code, not aspirational.
const PLEDGE: { lead: string; body: string }[] = [
  {
    lead: "No cookies.",
    body: "Daylight sets none. There is no consent banner because there is nothing to consent to.",
  },
  {
    lead: "No third parties.",
    body: "No Google Analytics, no Meta pixel, no external fonts or CDNs phoning home. The page's own Content-Security-Policy (connect-src 'self') forbids it from talking to anyone but this server — the disguised-first-party trick Floodlight flags on .gov pages, switched off here.",
  },
  {
    lead: "No IP addresses or user-agents.",
    body: "They are never written to a log or a database. The table below has no column that could hold one.",
  },
  {
    lead: "No fingerprint, no cross-site id.",
    body: "Nothing here can follow you to another site — or even recognize you between two visits to this one.",
  },
  {
    lead: "Do Not Track is honored.",
    body: "If your browser sends the DNT signal, this page records nothing at all — not even the aggregate count.",
  },
];

// Daylight measured against the same checks Floodlight runs on federal pages. Static + structural,
// not a live scan — each line is verifiable in devtools or the response's CSP header.
const SELF_SCORECARD: { label: string; value: string }[] = [
  { label: "Third-party trackers", value: "0" },
  { label: "Session replay", value: "none" },
  { label: "Analytics disguised as first-party", value: "none" },
  { label: "Cookies set", value: "0" },
  { label: "Third-party network requests", value: "0" },
  { label: "External fonts / CDNs", value: "self-hosted" },
  { label: "Published privacy notice", value: "this page" },
];

const REF_KINDS: { key: string; label: string }[] = [
  { key: "direct", label: "Direct / bookmarks" },
  { key: "gov", label: "Referred by .gov" },
  { key: "search", label: "Search engines" },
  { key: "other", label: "Other sites" },
];

const EMPTY: AnalyticsSummary = {
  firstDay: null,
  totalVisits: 0,
  govVisits: 0,
  feedPulls: 0,
  apiPulls: 0,
  topPaths: [],
  refKinds: [],
  govReferrers: [],
};

export default function PrivacyPage() {
  const a = safe(() => analyticsSummary(), EMPTY);
  const pulls = a.feedPulls + a.apiPulls;

  return (
    <div className="space-y-10">
      <div>
        <Eyebrow>daylight · privacy</Eyebrow>
        <h1 className="text-2xl font-semibold tracking-tight">Privacy, and what we count</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Daylight measures federal sites for how they watch the public. It would be incoherent to
          quietly do the same thing here. So this is the entire account of what Daylight records
          about your visit — stated as a commitment, then shown live from the actual data below.
        </p>
      </div>

      <section className="space-y-3">
        <Eyebrow>the pledge</Eyebrow>
        <Panel>
          <ul className="divide-y divide-edge">
            {PLEDGE.map((p) => (
              <li key={p.lead} className="flex items-start gap-3 px-4 py-3">
                <span className="mt-[3px] inline-block h-[7px] w-[7px] shrink-0 rounded-full border border-calm bg-calm/50" />
                <p className="text-sm leading-snug text-muted">
                  <strong className="font-semibold text-ink">{p.lead}</strong> {p.body}
                </p>
              </li>
            ))}
          </ul>
        </Panel>
      </section>

      <SelfScorecard />

      <section className="space-y-4">
        <div className="flex items-baseline justify-between gap-3">
          <Eyebrow>what we count · live</Eyebrow>
          <InternalLink href="/floodlight">The same lens, on .gov →</InternalLink>
        </div>

        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-y border-edge py-3">
          <Figure n={a.totalVisits.toLocaleString()} label="visits · all time" />
          <Figure n={a.govVisits.toLocaleString()} label="referred by .gov" />
          <Figure n={pulls.toLocaleString()} label="feed / API pulls" />
          <span className="font-mono text-xs text-faint">
            counting since {a.firstDay ?? "—"} · aggregate only
          </span>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <TopPaths paths={a.topPaths} />
          <RefMix refKinds={a.refKinds} total={a.totalVisits} />
        </div>

        <GovReferrers referrers={a.govReferrers} />
      </section>

      <section className="space-y-3">
        <Eyebrow>what we retain</Eyebrow>
        <p className="max-w-2xl text-sm text-muted">
          This is the whole table. Every count above — page views, feed pulls, and API reads alike —
          is a sum over rows shaped exactly like this: a date, which page, a coarse referrer class,
          and a tally.
        </p>
        <Panel className="overflow-x-auto p-4">
          <pre className="font-mono text-xs leading-relaxed text-muted">
{`analytics_hits
  day        2026-07-03      UTC date
  path       /floodlight     which page — a route pattern, never a raw value
  ref_kind   gov             direct · gov · search · other
  ref_host   epa.gov         the .gov apex — kept only for federal referrers
  count      14              how many times`}
          </pre>
        </Panel>
        <p className="max-w-2xl text-sm text-muted">
          There is no row anywhere else that records your visit, and no column here — or in any
          other table — for an IP address, a user-agent, a cookie, or a session id. They are not
          dropped from this page; they were never collected. The referrer host is stored only when
          it is a public federal <span className="font-mono text-ink">.gov</span> domain, so a
          reporter can see which agencies link here — never a private or personal referrer.
        </p>
        {FUNDING_URL ? (
          <p className="max-w-2xl text-sm text-muted">
            Daylight runs on one small always-on server. If you want to help keep it lit,{" "}
            <a href={FUNDING_URL} target="_blank" rel="noopener noreferrer" className="link">
              you can support it
            </a>{" "}
            — no tracking attached to that, either.
          </p>
        ) : null}
      </section>
    </div>
  );
}

function SelfScorecard() {
  return (
    <section className="space-y-3">
      <Eyebrow>daylight, by its own measure</Eyebrow>
      <Panel className="p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-2.5 border-b border-edge pb-3">
          <span className="inline-flex items-center rounded-sm border border-calm/55 bg-calm/[0.08] px-2 py-[3px] font-mono text-[11px] uppercase leading-none tracking-[0.12em] text-calm">
            clean
          </span>
          <span className="font-mono text-xs text-muted">
            daylight.watch, against Floodlight&rsquo;s own checks
          </span>
        </div>
        <ul className="divide-y divide-edge">
          {SELF_SCORECARD.map((row) => (
            <li key={row.label} className="flex items-center justify-between gap-3 py-2.5">
              <span className="text-sm text-muted">{row.label}</span>
              <span className="font-mono text-xs text-calm tabular-nums">{row.value}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 max-w-2xl text-xs leading-relaxed text-faint">
          Verify it yourself: open dev tools › Network on any Daylight page, or read the response&rsquo;s{" "}
          <span className="font-mono">content-security-policy</span> header. These are structural
          facts, not promises — the same checks Floodlight runs on federal pages, pointed at us.
        </p>
      </Panel>
    </section>
  );
}

function TopPaths({ paths }: { paths: AnalyticsSummary["topPaths"] }) {
  const max = Math.max(1, ...paths.map((p) => p.count));
  return (
    <Panel className="p-4">
      <div className="mb-3">
        <span className="kicker">most-visited pages</span>
      </div>
      {paths.length === 0 ? (
        <p className="text-sm text-faint">Nothing yet.</p>
      ) : (
        <ul className="space-y-2.5">
          {paths.map((p) => (
            <li key={p.path} className="space-y-1">
              <div className="flex items-baseline justify-between gap-3">
                <span className="truncate font-mono text-xs text-ink">{p.path}</span>
                <span className="shrink-0 font-mono text-xs text-faint tabular-nums">
                  {p.count.toLocaleString()}
                </span>
              </div>
              <Bar value={p.count} max={max} />
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function RefMix({ refKinds, total }: { refKinds: AnalyticsSummary["refKinds"]; total: number }) {
  const counts = new Map(refKinds.map((r) => [r.kind, r.count]));
  const max = Math.max(1, ...refKinds.map((r) => r.count));
  return (
    <Panel className="p-4">
      <div className="mb-3">
        <span className="kicker">where visitors come from</span>
      </div>
      <ul className="space-y-2.5">
        {REF_KINDS.map((k) => {
          const n = counts.get(k.key) ?? 0;
          const pct = total > 0 ? Math.round((n / total) * 100) : 0;
          return (
            <li key={k.key} className="space-y-1">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-xs text-ink">{k.label}</span>
                <span className="shrink-0 font-mono text-xs text-faint tabular-nums">
                  {n.toLocaleString()} · {pct}%
                </span>
              </div>
              <Bar value={n} max={max} tone={k.key === "gov" ? "signal" : "accent"} />
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

function GovReferrers({ referrers }: { referrers: AnalyticsSummary["govReferrers"] }) {
  const max = Math.max(1, ...referrers.map((r) => r.count));
  return (
    <div className="space-y-2">
      <Eyebrow>federal .gov referrers</Eyebrow>
      <p className="max-w-2xl text-xs leading-relaxed text-faint">
        Which government <em>pages link here and send a click</em> — read from the referrer, never
        from anyone&rsquo;s IP or network. This cannot and does not tell us where a visitor is, or
        whether they browse from a government network; only which public <span className="font-mono">.gov</span>{" "}
        pages point to Daylight. A <span className="font-mono">.gov</span> with a strict referrer
        policy sends nothing, so this undercounts rather than over-claims.
      </p>
      {referrers.length === 0 ? (
        <EmptyState
          title="No federal .gov page has linked to Daylight yet."
          hint="When one does — say an agency's privacy page cites a Floodlight scorecard — the referring domain appears here, by public apex. It is the one host we keep, because it is already public and newsworthy."
        />
      ) : (
        <Panel>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-edge text-left font-mono text-[11px] uppercase tracking-wide text-faint">
                <th className="px-4 py-2.5 font-normal">Referring .gov</th>
                <th className="px-4 py-2.5 font-normal">Visits sent</th>
                <th className="hidden px-4 py-2.5 font-normal sm:table-cell">Share</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-edge">
              {referrers.map((r) => (
                <tr key={r.host}>
                  <td className="px-4 py-2.5 font-mono text-xs text-ink">{r.host}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-muted tabular-nums">
                    {r.count.toLocaleString()}
                  </td>
                  <td className="hidden px-4 py-2.5 sm:table-cell">
                    <Bar value={r.count} max={max} tone="signal" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}
    </div>
  );
}

function Bar({ value, max, tone = "accent" }: { value: number; max: number; tone?: "accent" | "signal" }) {
  const pct = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
  const bg = tone === "signal" ? "bg-signal/70" : "bg-accent/70";
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-sm bg-raised">
      <div className={`h-full ${bg}`} style={{ width: `${pct}%` }} />
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
