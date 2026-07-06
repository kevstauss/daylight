import Link from "next/link";
import { InternalLink } from "@/components/ui";
import { JsonLd } from "@/components/json-ld";
import { breadcrumbLd, faqLd } from "@/lib/structured-data";
import { pageMetadata, PAGE_DESCRIPTIONS } from "@/lib/seo";

export const metadata = pageMetadata({
  title: "FAQ & glossary",
  description: PAGE_DESCRIPTIONS.faq,
  path: "/faq",
});
export const dynamic = "force-dynamic";

// All copy lives as plain strings so the visible page and the FAQPage JSON-LD share one source, and
// so no apostrophe trips react/no-unescaped-entities. Voice is neutral and observational — it states
// what Daylight does and defines terms, never a verdict. `related` links stay out of the schema text.
interface Faq {
  q: string;
  a: string;
  related?: { label: string; href: string }[];
}

const FAQS: Faq[] = [
  {
    q: "How do I find out who owns a .gov domain?",
    a: "Every U.S. federal .gov domain has a public owner record in CISA's dotgov-data repository. Daylight mirrors it: search the registry, or open a domain's page, to see the owning agency, its sub-agency, and the email listed as the domain's security contact — each entry timestamped and linked to the exact public source it was read from.",
    related: [
      { label: "Search the registry", href: "/registry" },
      { label: "Example: vote.gov", href: "/domain/vote.gov" },
    ],
  },
  {
    q: "Is a .gov website tracking me?",
    a: "Daylight loads each watched public .gov page once, the way a browser would, and writes down what the page loaded on its own: third-party trackers, session-replay tools that record your clicks and scrolling, and analytics — including analytics disguised as the site's own first-party traffic. It never fills in or submits anything. Open Floodlight, or a specific domain's page, to see what was observed and when.",
    related: [{ label: "Floodlight", href: "/floodlight" }],
  },
  {
    q: "What is session replay?",
    a: "Session replay is a technique that records an individual visitor's actions on a page — mouse movement, scrolling, clicks, and sometimes keystrokes — and reconstructs the session for later playback. Daylight notes when a session-replay tool is present on a public .gov page; Daylight itself records no one and stores no visitor data.",
    related: [{ label: "Floodlight", href: "/floodlight" }],
  },
  {
    q: "What is a PIA, and what is a SORN?",
    a: "A Privacy Impact Assessment (PIA) is a public document a federal agency is generally expected to publish when an information system collects personal data, describing what it collects and how it is protected. A System of Records Notice (SORN) is a notice published in the Federal Register when the government maintains a 'system of records' that can be retrieved by a personal identifier. Daylight searches the public record for these filings and shows the exact searches it ran, reporting only what was found or not found as of a given date — never a legal conclusion.",
    related: [{ label: "Redtape", href: "/redtape" }],
  },
  {
    q: "What is a Certificate Transparency log?",
    a: "Certificate Transparency (CT) logs are public, append-only records of the TLS/SSL certificates that certificate authorities issue. Because a new subdomain usually gets its own certificate, these logs reveal when a name such as previews.example.gov first appears. Daylight reads CT logs to notice new federal subdomains — recording only that a certificate exists. It never connects to, probes, or authenticates to the host.",
    related: [{ label: "Lookout", href: "/lookout" }],
  },
  {
    q: "What is reverse-proxied (disguised) analytics?",
    a: "Normally an analytics script loads from a third-party domain, which ad and tracker blockers can recognize and block. A reverse proxy can route that same analytics through a first-party path on the site's own domain, so it looks like the site's own traffic and evades blockers. Daylight flags a first-party endpoint whose path or request-body shape matches a known analytics tool — and only when a real analytics beacon is actually present.",
    related: [{ label: "Floodlight", href: "/floodlight" }],
  },
  {
    q: "Where does Daylight's data come from — is it official?",
    a: "Every source is already public: CISA's dotgov-data repository, Certificate Transparency logs, live public page source, the Internet Archive, and the Federal Register. Daylight is an independent project. It is not a government site and is not affiliated with any agency. The Methods page lists every source and describes exactly how the watcher behaves.",
    related: [{ label: "Methods & sources", href: "/methods" }],
  },
  {
    q: "Can I cite Daylight in an article?",
    a: "Yes. Every observed change has a permanent, timestamped permalink with a one-click citation that includes a content fingerprint, and the underlying records are published as RSS and JSON feeds and a public JSON API. Point readers at the permalink and the linked public source so the claim is independently re-verifiable.",
    related: [
      { label: "Global feed", href: "/feed.xml" },
      { label: "Methods", href: "/methods" },
    ],
  },
  {
    q: "How often does Daylight update?",
    a: "The ownership registry is diffed daily; new subdomains are reconciled nightly from CT logs; live pages are swept weekly; page snapshots are taken twice weekly. The Status page shows when each watcher last ran and flags any scheduler that has gone overdue.",
    related: [{ label: "Status", href: "/status" }],
  },
];

const GLOSSARY: { term: string; def: string }[] = [
  { term: "Apex domain", def: "The registrable base of a domain — e.g. example.gov. CISA's public registry lists an owner for each federal apex .gov domain." },
  { term: "Subdomain", def: "A name under an apex, e.g. previews.example.gov. Daylight learns of subdomains passively, from the certificates that appear in public Certificate Transparency logs." },
  { term: "Security contact", def: "The email address published in the .gov registry as the point of contact for a domain's security issues. A contact on a domain foreign to the owning organization is one of Daylight's signals." },
  { term: "PIA (Privacy Impact Assessment)", def: "A public assessment an agency generally publishes when a system collects personal information, describing the data and its safeguards." },
  { term: "SORN (System of Records Notice)", def: "A Federal Register notice for a government system of records retrievable by a personal identifier." },
  { term: "Certificate Transparency (CT) log", def: "A public, append-only log of issued TLS certificates. Reading it reveals new subdomains without ever contacting the host." },
  { term: "Session replay", def: "Recording and reconstructing an individual visitor's on-page actions (movement, clicks, scrolling, sometimes keystrokes) for later playback." },
  { term: "Reverse-proxied analytics", def: "Analytics served through a first-party path on the site's own domain so it resembles the site's own traffic and evades tracker blockers." },
  { term: "Removal ledger", def: "Daylight's dated record of things that were present on a page and then vanished — a privacy notice, an agency seal, a tracker, or a form field — with the before/after preserved." },
];

export default function FaqPage() {
  return (
    <div className="prose-daylight max-w-2xl">
      <JsonLd data={faqLd(FAQS.map((f) => ({ question: f.q, answer: f.a })))} />
      <JsonLd data={breadcrumbLd([{ name: "Daylight", path: "/" }, { name: "FAQ & glossary", path: "/faq" }])} />

      <h1 className="text-2xl font-semibold tracking-tight">Questions &amp; glossary</h1>
      <p className="text-muted">
        What Daylight watches on the federal <span className="font-mono">.gov</span> web, how to read it,
        and what the terms mean. Everything here is observational and built on already-public data — see{" "}
        <InternalLink href="/methods">Methods</InternalLink> for the sources and scope.
      </p>

      <section aria-labelledby="faq-heading" className="mt-8">
        <h2 id="faq-heading" className="sr-only">
          Frequently asked questions
        </h2>
        <div className="space-y-7">
          {FAQS.map((f) => (
            <div key={f.q}>
              <h3 className="text-base font-semibold text-ink">{f.q}</h3>
              <p className="mt-1.5 text-[15px] leading-relaxed text-muted">{f.a}</p>
              {f.related ? (
                <p className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                  {f.related.map((r) => (
                    <InternalLink key={r.href} href={r.href}>
                      {r.label} →
                    </InternalLink>
                  ))}
                </p>
              ) : null}
            </div>
          ))}
        </div>
      </section>

      <section aria-labelledby="glossary-heading" className="mt-12">
        <h2 id="glossary-heading" className="text-xl font-semibold tracking-tight">
          Glossary
        </h2>
        <dl className="mt-4 space-y-4">
          {GLOSSARY.map((g) => (
            <div key={g.term}>
              <dt className="font-semibold text-ink">{g.term}</dt>
              <dd className="mt-0.5 text-[15px] leading-relaxed text-muted">{g.def}</dd>
            </div>
          ))}
        </dl>
      </section>

      <p className="mt-10 text-sm text-faint">
        Still have a question, or spot something wrong? See{" "}
        <Link href="/methods" className="link">
          Methods
        </Link>{" "}
        for how to reach us and dispute a record.
      </p>
    </div>
  );
}
