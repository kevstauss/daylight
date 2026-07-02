import Link from "next/link";
import type { Metadata } from "next";
import {
  CONTACT,
  CONTACT_LABEL,
  CREDIT_LINE,
  DATA_SOURCES,
  FUNDING_URL,
  USER_AGENT,
} from "@/lib/site";
import { Panel, SourceLink } from "@/components/ui";
import { PlainTechnical } from "@/components/plain-technical";

export const metadata: Metadata = { title: "Methods" };
// Render at request time so the runtime origin (User-Agent/contact) and flag-gated nav
// are correct in production, not baked from build-time env.
export const dynamic = "force-dynamic";

/** Each detection heuristic, described twice: a plain lead + the exact mechanism, plus what it
 *  deliberately CLEARS (so it reads as documented editorial judgment, not a black box). */
const HEURISTICS: { name: string; plain: string; technical: string; clears: string }[] = [
  {
    name: "H1 · Contact-domain mismatch (Ledger)",
    plain:
      "We flag when the security contact listed for one agency's site is an email at a different, unrelated agency's domain — a sign that control may have quietly moved.",
    technical:
      "For each registry row, we take the registrable apex of the security-contact email and compare it to the row's own apex. A cross-apex contact is a candidate; it escalates to HIGH when the contact apex is itself a watchlisted product .gov (this reproduced the akash@ndstudio.gov → usadf.gov finding structurally, with no name hard-coded).",
    clears:
      "A contact at the domain's own apex, a recognized central mailbox (an allowlist of shared SOC addresses like eop.gov/gsa.gov/cisa.gov), and — when resolvable — a contact at another domain owned by the SAME organization (e.g. vote.gov → @eac.gov, both the Election Assistance Commission).",
  },
  {
    name: "H9 · Contact concentration (Ledger)",
    plain:
      "We flag when one small office becomes the listed security contact across three or more unrelated agencies — the pattern of quietly consolidating control.",
    technical:
      "A cross-record pass groups the whole registry by contact apex and flags a foreign, non-allowlisted apex that is the security contact of record for ≥3 distinct owning organizations. Idempotent: a stable concentration is reported once, not every run.",
    clears:
      "Same-apex self-contacts, allowlisted central mailboxes, and any apex serving fewer than three distinct organizations (a normal shared-services contact).",
  },
  {
    name: "Reverse-proxy disguise (Floodlight, flagship)",
    plain:
      "Some sites route their tracking through their own web address so ad-blockers don't recognize it. We catch that by the shape of the data being sent, not the brand name — so it still fires if the tracker is renamed.",
    technical:
      "We flag a FIRST-party endpoint whose request shape matches a known analytics SDK: a beacon (POST/xhr/fetch) carrying a PostHog/Amplitude/Segment/Plausible/GA4/Matomo/rrweb body, or an AutoMonitor-style {session_id, events[]} POST to a collect/ingest/metrics/events/track path. Beacon-gated so ordinary content pages never trip it.",
    clears:
      "Plain GET content navigations (even to a path like /decide or /s/…), and any request without a corroborating analytics payload shape.",
  },
  {
    name: "Session replay & privacy-notice gap (Floodlight)",
    plain:
      "We note when a page records your actual clicks, scrolls, and keystrokes (\"session replay\"), and whether it even links a privacy notice.",
    technical:
      "Session replay is detected via vendor fingerprint category or a tightened replay-path signal. A page that collects PII or loads trackers but links no privacy notice — after an in-page probe of canonical /privacy paths to avoid false negatives — is flagged. The bare `/s/` third-party path no longer mints a false 'high'.",
    clears:
      "A page that links (or serves at a canonical path) a genuine privacy notice, and third parties whose only signal is an ambiguous single-letter path.",
  },
  {
    name: "PII form fields (Floodlight → Redtape)",
    plain:
      "We record the KINDS of personal information a form asks for — a name, an SSN, a date of birth, a passport number, a photo — without ever filling it in or capturing what you'd type.",
    technical:
      "We classify inputs by type, autocomplete token, and name/id/placeholder pattern into normalized kinds (never raw values). A form collecting SENSITIVE PII (ssn/dob/passport/photo), or ordinary PII with no linked privacy notice, becomes a strong Redtape candidate — the canonical E-Gov Act §208 gap.",
    clears:
      "Generic text/search/submit inputs that name no specific PII category.",
  },
  {
    name: "New & mimicking subdomains (Lookout)",
    plain:
      "When a new subdomain like previews.example.gov or photo.example.gov first appears in the public certificate logs, we surface it — especially names that look like staging, internal infrastructure, or an imitation of another agency.",
    technical:
      "We score never-before-seen SANs under watched apexes against a label list (previews/staging/auth/photo/analytics/infra…) and mimic tokens. Existence-only from the public log; we never connect to the host. Each row links its crt.sh query.",
    clears:
      "Ordinary product subdomains without a flagged label; existence in a Certificate Transparency log is never treated as access.",
  },
  {
    name: "Removal ledger (Receipts)",
    plain:
      "We keep dated snapshots of watched pages so that if a tracker, a privacy clause, an official seal, or a form is quietly deleted, there's a permanent before-and-after record — plus an independent copy at the Internet Archive.",
    technical:
      "Two snapshots are diffed; a present-then-gone tracker/privacy-clause/seal/form-field emits a dated `removed` change (HIGH), with the raw artifact kept out of the public read path and a Wayback URL stored beside it.",
    clears:
      "Cosmetic churn that doesn't change any tracked dimension; nothing from behind an access gate is ever snapshotted.",
  },
  {
    name: "Filing-gap findings (Redtape)",
    plain:
      "When a site appears to collect personal information, we check the government's own public record for the privacy filing the law generally requires — and a human reviews every finding before it's published. We show the exact searches, and we never say anyone broke the law.",
    technical:
      "An AI research agent searches the Federal Register and returns references or a documented negative with the queries run. A hard human-approval gate (enforced in the data layer) means nothing publishes without review AND a non-empty query/source trail. Findings are phrased as observation, dated, and retractable via /corrections.",
    clears:
      "Collections with a covering SORN/PIA on file (found = no gap), and anything a reviewer holds or rejects.",
  },
];

export default function MethodsPage() {
  return (
    <div className="prose-daylight max-w-2xl">
      <h1 className="text-2xl font-semibold tracking-tight">Methods &amp; sources</h1>
      <p>
        Daylight is a public, observational watchdog for federal <code>.gov</code> infrastructure.
        We practice on ourselves the transparency we ask of the sites we watch: every source is
        named here, our bot identifies itself honestly, our own uptime is public on{" "}
        <a href="/status">/status</a>, and every correction we make is public on{" "}
        <a href="/corrections">/corrections</a>. Each section below is written twice — a plain lead
        anyone can read, and an expandable <em>technical version</em> with the exact mechanism.
      </p>

      <h2>The one line we never cross</h2>
      <p>
        Noting that a certificate, subdomain, or login page <strong>exists</strong> is fine. We{" "}
        <strong>never</strong> authenticate past any access wall, guess credentials, probe,
        port-scan, fuzz, or brute-force. We observe the front door; we never try the handle. This
        keeps the project legally clean and press-credible — that is the whole strategy.
      </p>
      <ul>
        <li>
          <strong>Public data only.</strong> Every source is reachable without authentication.
        </li>
        <li>
          <strong>Observational only.</strong> We record that things exist and how they change; we
          never interact past any access control.
        </li>
        <li>
          <strong>Reproducible &amp; timestamped.</strong> Every observation stores its timestamp,
          source URL, and content hash. Every claim is independently checkable by a stranger.
        </li>
        <li>
          <strong>Neutral presentation.</strong> We state what was observed, linked to its source —
          never an accusation the data does not support.
        </li>
      </ul>

      <h2>Data sources</h2>
      <div className="not-prose mt-2 space-y-3">
        {DATA_SOURCES.map((s) => (
          <Panel key={s.name} className="px-4 py-3">
            <div className="mb-1.5 flex items-baseline justify-between gap-3">
              <SourceLink href={s.url}>{s.name}</SourceLink>
              <span className="font-mono text-[11px] text-faint">{s.phase}</span>
            </div>
            <PlainTechnical plain={s.use} technical={s.technical} />
          </Panel>
        ))}
      </div>

      <h2>How our detections work</h2>
      <p>
        Every flag is derived from public data by one of the heuristics below. Each says what it
        flags <em>and</em> what it deliberately clears — a flag is documented editorial judgment,
        not a black box.
      </p>
      <div className="not-prose mt-2 space-y-3">
        {HEURISTICS.map((h) => (
          <Panel key={h.name} className="px-4 py-3">
            <div className="mb-1.5 font-mono text-[13px] font-medium text-ink">{h.name}</div>
            <PlainTechnical
              plain={h.plain}
              technical={
                <>
                  <p className="mt-0">{h.technical}</p>
                  <p className="mt-2">
                    <span className="font-mono text-[11px] uppercase tracking-wide text-faint">
                      Deliberately clears:{" "}
                    </span>
                    {h.clears}
                  </p>
                </>
              }
            />
          </Panel>
        ))}
      </div>

      <h2>Responsible disclosure</h2>
      <p>
        If a scan ever incidentally surfaces an exposed secret, credential, or a real vulnerability,
        we <strong>stop, do not publish, and route it privately to the affected agency and CISA</strong>{" "}
        through proper channels. That is not our mission and not ours to weaponize. The public
        read-path serves only reviewed, redacted data; a redaction pass runs on ingest and anything
        flagged is withheld pending human review. Home addresses, personal accounts, and family are{" "}
        <strong>never</strong> surfaced.
      </p>

      <h2>How our bot behaves</h2>
      <p>
        Requests Daylight makes to public sources carry an honest, self-identifying User-Agent, so
        anyone can see it is us and reach a contact:
      </p>
      <p>
        <code>{USER_AGENT}</code>
      </p>
      <p>
        We honor <code>robots.txt</code>, cache aggressively, back off exponentially on errors, and
        never hammer a source. How often we read each source:
      </p>
      <div className="not-prose mt-2">
        <Panel className="overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-edge text-left font-mono text-[11px] uppercase tracking-wide text-faint">
                <th scope="col" className="px-4 py-2 font-normal">Source</th>
                <th scope="col" className="px-4 py-2 font-normal">Cadence</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-edge">
              {DATA_SOURCES.map((s) => (
                <tr key={s.name} className="align-top">
                  <td className="px-4 py-2 text-muted">{s.name}</td>
                  <td className="px-4 py-2 text-muted">{s.cadence}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>

      <h2>Where AI is used</h2>
      <p>
        One module uses an AI model: <strong>Redtape</strong>, the privacy-filing gap-finder. An
        automated researcher drafts an assessment by searching the public Federal Register and
        records the exact queries it ran. <strong>Nothing it produces is published automatically.</strong>{" "}
        A human reviews every finding behind a gate enforced in the data layer, and only human-approved
        items with a re-runnable search trail ever appear on <Link href="/redtape">/redtape</Link>.
        Everywhere AI-drafted text appears, it is labeled as such, and fact is distinguished from
        inference. The rest of Daylight — Ledger, Lookout, Floodlight, Receipts — is deterministic
        code with no model in the loop.
      </p>

      <h2>Corrections &amp; disputes</h2>
      <p>
        A watchdog&rsquo;s strongest credential is a visible record of its own mistakes. When we
        retract or amend a finding, it is logged, dated, and public on{" "}
        <a href="/corrections">/corrections</a> in the same feed format as everything else. If you
        believe a specific observation is wrong,{" "}
        <a href={CONTACT}>dispute it</a> — resolved disputes are logged as public corrections.
      </p>

      <h2>What we watch closely</h2>
      <p>
        Everything Daylight records is public regardless, but a curated{" "}
        <Link href="/watchlist">watchlist</Link> decides which identities — organizations, domains,
        and security contacts — get the loudest, highest-severity flag. It&rsquo;s open to
        suggestions; the watchlist page has a submission link.
      </p>

      <h2>PII restraint</h2>
      <p>
        We surface <em>official public registrant records</em> — which name agency security contacts
        by design — and public officials acting in an official capacity. We do not enrich,
        cross-reference, or aggregate personal data about individuals beyond that official capacity.
      </p>

      <h2>Contact</h2>
      <p>
        Tips, disputes, and watchlist submissions: <a href={CONTACT}>{CONTACT_LABEL}</a>.
      </p>

      {FUNDING_URL ? (
        <>
          <h2>Support this work</h2>
          <p>
            Daylight is independent and runs on a shoestring — a small always-on machine, a browser
            image, and an archive push. If it&rsquo;s useful to you, you can{" "}
            <a href={FUNDING_URL} target="_blank" rel="noopener noreferrer">
              chip in to keep the lights on
            </a>
            . Funding only pays for infrastructure; it never buys a flag or a finding.
          </p>
        </>
      ) : null}

      <h2>Credit</h2>
      <p>{CREDIT_LINE}</p>
    </div>
  );
}
