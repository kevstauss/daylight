import type { Metadata } from "next";
import { CONTACT, CREDIT_LINE, DATA_SOURCES, USER_AGENT } from "@/lib/site";
import { Panel, SourceLink } from "@/components/ui";

export const metadata: Metadata = { title: "Methods" };

export default function MethodsPage() {
  return (
    <div className="prose-daylight max-w-2xl">
      <h1 className="text-2xl font-semibold tracking-tight">Methods &amp; sources</h1>
      <p>
        Daylight is a public, observational watchdog for federal <code>.gov</code> infrastructure.
        We practice on ourselves the transparency we ask of the sites we watch: every source is
        named here, our bot identifies itself honestly, and our own uptime is public on{" "}
        <a href="/status">/status</a>.
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
        <li>
          <strong>Rate-limit &amp; ToS respect.</strong> Honest User-Agent, caching, backoff. We
          never hammer a source.
        </li>
      </ul>

      <h2>Our bot</h2>
      <p>
        Requests Daylight makes to public sources carry this User-Agent, so anyone can see it is us
        and reach a contact:
      </p>
      <p>
        <code>{USER_AGENT}</code>
      </p>
      <p>
        Contact: <a href={CONTACT.startsWith("http") ? CONTACT : `mailto:${CONTACT}`}>{CONTACT}</a>
      </p>

      <h2>Data sources</h2>
      <div className="not-prose mt-2 space-y-2">
        {DATA_SOURCES.map((s) => (
          <Panel key={s.name} className="px-4 py-3">
            <div className="flex items-baseline justify-between gap-3">
              <SourceLink href={s.url}>{s.name}</SourceLink>
              <span className="font-mono text-[11px] text-faint">{s.phase}</span>
            </div>
            <p className="mt-1 text-sm text-muted">{s.use}</p>
          </Panel>
        ))}
      </div>

      <h2>PII restraint</h2>
      <p>
        We surface <em>official public registrant records</em> — which name agency security contacts
        by design — and public officials acting in an official capacity. We do not enrich,
        cross-reference, or aggregate personal data about individuals beyond that official capacity.
        A redaction pass runs on ingest; anything flagged is withheld pending human review.
      </p>

      <h2>Credit</h2>
      <p>{CREDIT_LINE}</p>
    </div>
  );
}
