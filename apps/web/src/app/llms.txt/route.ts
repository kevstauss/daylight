import { absolute, SITE_URL } from "@/lib/seo";
import { changeCount, domainCount } from "@/lib/data";
import { flags } from "@/lib/flags";
import { CONTACT_LABEL } from "@/lib/site";

// llms.txt (llmstxt.org) — a compact, Markdown map of the site for LLMs and IDE/agent tooling.
// Generated from live data so the counts stay fresh. Kept small (well under ~5KB). Its direct crawl
// benefit is contested, but it's squarely on-mission (machine-readable public accountability) and
// cheap. Everything here is already public and linked from the site.
export const dynamic = "force-dynamic";

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

export function GET(): Response {
  const f = flags();
  const domains = safe(() => domainCount(), 0).toLocaleString("en-US");
  const changes = safe(() => changeCount(), 0).toLocaleString("en-US");
  const today = new Date().toISOString().slice(0, 10);
  const u = (p: string): string => absolute(p);

  // Only advertise module pages whose flag is on (an off module 404s).
  const modules: string[] = [];
  if (f.registry) {
    modules.push(`- [Registry](${u("/registry")}): Search who owns each federal .gov domain, from CISA's public dotgov-data.`);
    modules.push(`- [Domain dashboard](${u("/domain/vote.gov")}): Composite per-domain record — ownership, certificates, trackers, and filing status. Replace \`vote.gov\` in the path with any federal .gov domain.`);
    modules.push(`- [Ledger](${u("/ledger")}): Every change to .gov ownership and security contacts, diffed daily from the registry.`);
  }
  if (f.lookout) modules.push(`- [Lookout](${u("/lookout")}): New federal .gov subdomains the day their TLS certificate first appears in public Certificate Transparency logs.`);
  if (f.floodlight) modules.push(`- [Floodlight](${u("/floodlight")}): Trackers, session replay, and analytics disguised as first-party traffic on public .gov pages.`);
  if (f.receipts) modules.push(`- [Receipts](${u("/receipts")}): A dated, archived removal ledger — what privacy notice, seal, tracker, or form field was present and then vanished.`);
  if (f.redtape) modules.push(`- [Redtape](${u("/redtape")}): Federal .gov collections of personal data with no published Privacy Impact Assessment or SORN found (human-reviewed).`);
  if (f.foundry) modules.push(`- [Foundry](${u("/foundry")}): Which build vendors quietly serve many federal agencies at once, and what is staged but not yet launched.`);
  if (f.broadside) modules.push(`- [Broadside](${u("/broadside")}): What the federal government pays to advertise to Americans — new ads, estimated spend by category (as ranges), and the loop where an agency's site tracker meets its ad buy.`);

  const body = `# Daylight — a public watchdog for federal .gov infrastructure

> Daylight is a public, observational watchdog for United States federal .gov infrastructure. It reads only already-public data — CISA's official .gov ownership registry, Certificate Transparency logs, and live public page source — and keeps a timestamped, source-linked record of who owns each federal domain, what certificates and subdomains appear, what trackers run on public pages, and what quietly changed or was removed. Every claim links the exact public artifact it was read from. As of ${today} it tracks ${domains} federal .gov domains with ${changes} recorded changes.

Daylight is observational and built entirely on public data. It never authenticates past an access wall, guesses credentials, probes, port-scans, or crawls — it records that things exist and how they change. Copy stays neutral and factual ("no published privacy filing was found as of {date}; searches shown"), never accusatory. It is not a government site and is not affiliated with any agency.

## Core pages
- [Home](${u("/")}): Front door and recent activity across all modules.
${modules.join("\n")}

## Reference
- [Methods & sources](${u("/methods")}): Every public data source Daylight reads, its bot's identity and politeness, and its observational-only scope and guardrails.
- [FAQ & glossary](${u("/faq")}): Common questions (who owns a .gov, is it tracking me) and definitions — PIA, SORN, Certificate Transparency, session replay, reverse-proxied analytics.
- [Watchlist](${u("/watchlist")}): The priority domains, comparators, and watches that drive the modules.
- [Corrections](${u("/corrections")}): Public retraction ledger — every correction, dated.
- [Status](${u("/status")}): Live health of the watchers.
- [Privacy](${u("/privacy")}): First-party, aggregate-only analytics; no IP, user-agent, or cookie is ever stored.

## Data & feeds
- [JSON API](${u("/api/v1/changes")}): Public read API — changes, domains, subdomains, scorecards, and gaps under /api/v1.
- [Global RSS feed](${u("/feed.xml")}): Every observed change as RSS. Per-module feeds exist at /{module}/feed.xml.
- [Global JSON Feed](${u("/feed.json")}): Every observed change as JSON Feed.

## About & contact
- Source code and issues: https://github.com/kevstauss/daylight
- Contact: ${CONTACT_LABEL}
- Canonical site: ${SITE_URL}
`;

  return new Response(body, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
}
