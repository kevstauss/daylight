// Central SEO/metadata helpers. One place builds canonical URLs, OpenGraph, Twitter cards, and
// feed alternates so every page is consistent and every absolute URL derives from the configured
// site origin (DAYLIGHT_SITE_URL) — NEVER a request header (cache-poisoning; same rule feeds obey
// via originFromRequest). Per-page opengraph-image.tsx files attach the image tags automatically,
// so this module deliberately does not set openGraph.images — the file convention cascades.

import type { Metadata } from "next";
import { configuredSiteUrl, SITE_NAME, SITE_TAGLINE } from "./site";

/** The public origin (no trailing slash). In prod this is https://daylight.watch. */
export const SITE_URL = configuredSiteUrl();

/** metadataBase for Next — makes canonical/OG/image relative URLs resolve to absolutes. */
export const metadataBase = new URL(SITE_URL);

/** Absolute URL for a site path. Always rooted at the configured origin. */
export function absolute(path: string): string {
  return new URL(path, metadataBase).toString();
}

export interface FeedAlternates {
  /** RSS feed path, e.g. "/ledger/feed.xml". */
  rss?: string;
  /** JSON Feed path, e.g. "/ledger/feed.json". */
  json?: string;
}

export interface PageMetaInput {
  /** Page title, WITHOUT the site suffix — the layout's title.template adds " · Daylight".
   *  Omit for the home page (uses the default title). */
  title?: string;
  /** One honest, specific factual sentence. Google and LLMs both reward specificity over stuffing. */
  description: string;
  /** Canonical path, e.g. "/faq" or "/domain/vote.gov". Leading slash required. */
  path: string;
  /** Override the social-card title (defaults to `${title} · Daylight`). */
  ogTitle?: string;
  /** Mark the page non-indexable (still crawlable) — for thin/empty resolutions. */
  noindex?: boolean;
  /** Advertise a page's RSS/JSON feeds as <link rel="alternate"> in <head>. */
  feeds?: FeedAlternates;
  /** OG image: a site path (e.g. "/opengraph-image"), or `false` to defer to a same-segment
   *  opengraph-image.tsx file (which Next injects automatically). Defaults to the site card.
   *  A file-convention image only auto-attaches to ITS OWN segment, so any page that sets its own
   *  openGraph (all pages here do) must name the image explicitly — otherwise it gets none. */
  ogImage?: string | false;
}

/** Build a complete, self-contained Metadata object for a page. Returning the full openGraph/twitter
 *  objects (rather than partial fields) avoids cross-segment merge surprises in the App Router. */
export function pageMetadata(input: PageMetaInput): Metadata {
  const { title, description, path, ogTitle, noindex, feeds, ogImage } = input;
  const canonical = absolute(path);
  const socialTitle = ogTitle ?? (title ? `${title} · ${SITE_NAME}` : `${SITE_NAME} — federal .gov watch`);
  // `false` → a same-segment opengraph-image.tsx supplies the image; don't also name one here.
  const image = ogImage === false ? undefined : absolute(ogImage ?? "/opengraph-image");

  const types: Record<string, { url: string; title: string }[]> = {};
  if (feeds?.rss) types["application/rss+xml"] = [{ url: absolute(feeds.rss), title: `${title ?? SITE_NAME} — RSS` }];
  if (feeds?.json) types["application/feed+json"] = [{ url: absolute(feeds.json), title: `${title ?? SITE_NAME} — JSON Feed` }];

  return {
    // Plain string → the layout's title.template ("%s · Daylight") applies. Undefined → default title.
    ...(title ? { title } : {}),
    description,
    alternates: {
      canonical,
      ...(Object.keys(types).length > 0 ? { types } : {}),
    },
    ...(noindex ? { robots: { index: false, follow: true } } : {}),
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      locale: "en_US",
      url: canonical,
      title: socialTitle,
      description,
      ...(image ? { images: [{ url: image, width: 1200, height: 630, alt: socialTitle }] } : {}),
    },
    twitter: {
      card: "summary_large_image",
      title: socialTitle,
      description,
      ...(image ? { images: [image] } : {}),
    },
  };
}

/** Canonical, factual one-line descriptions for the static public pages. Kept here so the copy is
 *  reviewable in one place and stays neutral/observational (states what is observed, never a verdict). */
export const PAGE_DESCRIPTIONS = {
  home: SITE_TAGLINE,
  registry:
    "Search the federal .gov registry by domain, agency, or security contact. Every owner record is sourced from CISA's public dotgov-data and timestamped.",
  ledger:
    "A timestamped, source-linked record of every change to who owns each federal .gov domain and who its security contact is — diffed daily from CISA's public registry.",
  lookout:
    "New federal .gov subdomains the day their TLS certificate first appears in public Certificate Transparency logs — existence only, never probed.",
  floodlight:
    "Which trackers, session-replay tools, and analytics run on federal .gov pages — observed by loading each public page once, the way a browser would.",
  receipts:
    "A dated, archived removal ledger for federal .gov pages: what privacy notice, seal, tracker, or form field was present and then quietly vanished.",
  redtape:
    "Federal .gov collections of personal data with no published Privacy Impact Assessment or SORN found — human-reviewed, with the exact searches shown.",
  foundry:
    "Which build vendors quietly serve many federal agencies at once, and what is staged but not yet launched — a CT-and-registry build graph.",
  broadside:
    "What the federal government pays to advertise to Americans — new ads, estimated spend by category (as ranges), and the loop where an agency's site tracker meets its ad buy.",
  methods:
    "How Daylight works: every public data source it reads, its bot's identity and politeness, and its observational-only scope and guardrails.",
  faq:
    "Answers to common questions about federal .gov domains — who owns them, whether they track you, what a PIA or SORN is — and a glossary of the terms Daylight uses.",
  watchlist:
    "The hand-picked priority domains, comparators, and person/org watches that drive Daylight's modules, published in full.",
  compare:
    "Compare two federal .gov domains side by side — ownership, security contact, certificates, and tracking observations.",
  corrections:
    "Daylight's public retraction ledger: every correction or removal, dated, so the record of what changed is itself on the record.",
  changelog: "What shipped in Daylight, by release — the running build log.",
  privacy:
    "Daylight's privacy practices and its first-party, aggregate-only analytics — no IP, user-agent, or cookie is ever stored.",
  status:
    "Live health of Daylight's watchers: when each module last ran and whether any scheduler is overdue.",
  scan: "Scan a public federal .gov URL on demand for trackers, session replay, and analytics disguised as first-party traffic.",
} as const;
