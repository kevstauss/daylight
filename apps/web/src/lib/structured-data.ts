// schema.org JSON-LD builders. Every graph is factual and cross-links the site Organization/WebSite
// by @id. Undefined fields are dropped by JSON.stringify, so optional args stay clean. This is the
// single biggest AIO lever: it makes Daylight's corpus legible to search engines and LLMs as a
// citable Dataset of timestamped, source-linked observations.

import { absolute, SITE_URL } from "./seo";
import { SITE_NAME, SITE_TAGLINE } from "./site";

const GITHUB = "https://github.com/kevstauss/daylight";
const ORG_ID = absolute("/#organization");
const WEBSITE_ID = absolute("/#website");

/** The Organization node — referenced by @id from every other graph. */
function organization(): Record<string, unknown> {
  return {
    "@type": "Organization",
    "@id": ORG_ID,
    name: SITE_NAME,
    url: SITE_URL,
    logo: absolute("/icon.svg"),
    description: SITE_TAGLINE,
    sameAs: [GITHUB],
  };
}

/** The WebSite node, with a SearchAction that points at the registry search. */
function website(): Record<string, unknown> {
  return {
    "@type": "WebSite",
    "@id": WEBSITE_ID,
    url: SITE_URL,
    name: SITE_NAME,
    description: SITE_TAGLINE,
    inLanguage: "en-US",
    publisher: { "@id": ORG_ID },
    potentialAction: {
      "@type": "SearchAction",
      target: {
        // Built as a raw string, NOT via absolute()/new URL — that would percent-encode the
        // {search_term_string} placeholder Google requires literally.
        "@type": "EntryPoint",
        urlTemplate: `${SITE_URL}/registry?q={search_term_string}`,
      },
      "query-input": "required name=search_term_string",
    },
  };
}

/** Site-wide graph (Organization + WebSite) — rendered once in the root layout. */
export function siteGraphLd(): Record<string, unknown> {
  return { "@context": "https://schema.org", "@graph": [organization(), website()] };
}

interface DatasetInput {
  name: string;
  description: string;
  /** Canonical page path, e.g. "/" or "/domain/vote.gov". */
  path: string;
  /** DataDownload endpoints (JSON API, feeds) as absolute-or-relative paths. */
  distributions?: { format: string; path: string }[];
  /** ISO timestamp of the newest observation — the freshness signal. */
  dateModified?: string;
  /** e.g. "2016/.." (open-ended) — schema.org temporal coverage syntax. */
  temporalCoverage?: string;
  keywords?: string[];
}

/** A schema.org/Dataset — the corpus (home), a module slice, or one domain's observations. */
export function datasetLd(input: DatasetInput): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "Dataset",
    name: input.name,
    description: input.description,
    url: absolute(input.path),
    isAccessibleForFree: true,
    creator: { "@id": ORG_ID },
    publisher: { "@id": ORG_ID },
    dateModified: input.dateModified,
    temporalCoverage: input.temporalCoverage,
    keywords: input.keywords,
    distribution: input.distributions?.map((d) => ({
      "@type": "DataDownload",
      encodingFormat: d.format,
      contentUrl: absolute(d.path),
    })),
  };
}

/** BreadcrumbList from an ordered list of {name, path}. */
export function breadcrumbLd(items: { name: string; path: string }[]): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: it.name,
      item: absolute(it.path),
    })),
  };
}

interface ReportInput {
  id: number;
  headline: string;
  datePublished: string;
  domain: string;
  /** The exact public artifact the change was read from. */
  sourceUrl?: string | null;
  /** The content fingerprint (sha256) from the cite block. */
  fingerprint: string;
}

/** A schema.org/Report — one observed change, as a first-class citable record. */
export function reportLd(input: ReportInput): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "Report",
    "@id": absolute(`/change/${input.id}`),
    url: absolute(`/change/${input.id}`),
    headline: input.headline,
    name: input.headline,
    datePublished: input.datePublished,
    dateModified: input.datePublished,
    identifier: `sha256:${input.fingerprint}`,
    isAccessibleForFree: true,
    isBasedOn: input.sourceUrl ?? undefined,
    about: {
      "@type": "Thing",
      name: input.domain,
      url: absolute(`/domain/${input.domain}`),
    },
    author: { "@id": ORG_ID },
    publisher: { "@id": ORG_ID },
  };
}

/** A schema.org/FAQPage from question/answer pairs. `answer` is plain text. */
export function faqLd(items: { question: string; answer: string }[]): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((qa) => ({
      "@type": "Question",
      name: qa.question,
      acceptedAnswer: { "@type": "Answer", text: qa.answer },
    })),
  };
}

/** A CollectionPage (module landing) or AboutPage (/methods), cross-linked to the WebSite. */
export function webPageLd(input: {
  type: "CollectionPage" | "AboutPage";
  name: string;
  description: string;
  path: string;
}): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": input.type,
    name: input.name,
    description: input.description,
    url: absolute(input.path),
    isPartOf: { "@id": WEBSITE_ID },
    publisher: { "@id": ORG_ID },
  };
}
