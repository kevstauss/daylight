import { describe, expect, it } from "vitest";
import robots from "@/app/robots";
import { absolute, metadataBase, pageMetadata, SITE_URL } from "@/lib/seo";
import {
  breadcrumbLd,
  datasetLd,
  faqLd,
  reportLd,
  siteGraphLd,
  webPageLd,
} from "@/lib/structured-data";

// Every absolute URL must derive from SITE_URL (the configured origin), never a request header —
// the cache-poisoning guard that feeds already follow. In tests DAYLIGHT_SITE_URL is unset, so
// SITE_URL is the localhost fallback; asserting relative to SITE_URL keeps these env-agnostic.

describe("pageMetadata", () => {
  it("sets an absolute canonical rooted at SITE_URL", () => {
    const m = pageMetadata({ title: "Methods", description: "d", path: "/methods" });
    expect(m.alternates?.canonical).toBe(`${SITE_URL}/methods`);
    expect(String(m.alternates?.canonical)).toMatch(/^https?:\/\//);
    expect(metadataBase.origin).toBe(SITE_URL);
  });

  it("mirrors title/description into OpenGraph + a large Twitter card", () => {
    const m = pageMetadata({ title: "Ledger", description: "changes", path: "/ledger" });
    expect(m.openGraph?.url).toBe(`${SITE_URL}/ledger`);
    expect(m.openGraph?.title).toBe("Ledger · Daylight");
    expect((m.openGraph as { description?: string }).description).toBe("changes");
    expect((m.twitter as { card?: string }).card).toBe("summary_large_image");
  });

  // Regression: a page that sets its own openGraph loses the file-convention default image, so
  // pageMetadata must attach the default card explicitly.
  it("attaches the default OG image by default", () => {
    const m = pageMetadata({ title: "FAQ", description: "d", path: "/faq" });
    const imgs = (m.openGraph as { images?: { url: string }[] }).images;
    expect(imgs?.[0]?.url).toBe(`${SITE_URL}/opengraph-image`);
    expect((m.twitter as { images?: string[] }).images?.[0]).toBe(`${SITE_URL}/opengraph-image`);
  });

  // Regression: segments with their own opengraph-image.tsx must NOT also name an image (would
  // duplicate the og:image tag).
  it("omits images when ogImage is false (defers to a same-segment file)", () => {
    const m = pageMetadata({ title: "vote.gov", description: "d", path: "/domain/vote.gov", ogImage: false });
    expect((m.openGraph as { images?: unknown }).images).toBeUndefined();
    expect((m.twitter as { images?: unknown }).images).toBeUndefined();
  });

  it("advertises feeds as absolute alternates and honors noindex", () => {
    const m = pageMetadata({
      title: "Ledger",
      description: "d",
      path: "/ledger",
      feeds: { rss: "/ledger/feed.xml", json: "/ledger/feed.json" },
      noindex: true,
    });
    const types = m.alternates?.types as Record<string, { url: string }[]>;
    expect(types["application/rss+xml"]?.[0]?.url).toBe(`${SITE_URL}/ledger/feed.xml`);
    expect(types["application/feed+json"]?.[0]?.url).toBe(`${SITE_URL}/ledger/feed.json`);
    expect((m.robots as { index?: boolean }).index).toBe(false);
  });
});

describe("robots", () => {
  const r = robots();

  it("allows all and disallows only /review", () => {
    const rules = Array.isArray(r.rules) ? r.rules : [r.rules];
    const star = rules.find((x) => x.userAgent === "*");
    expect(star?.allow).toBe("/");
    expect(star?.disallow).toContain("/review");
  });

  it("names the major AI crawlers with an allow rule", () => {
    const rules = Array.isArray(r.rules) ? r.rules : [r.rules];
    const uas = rules.map((x) => x.userAgent);
    for (const ua of ["GPTBot", "ClaudeBot", "PerplexityBot", "Google-Extended", "OAI-SearchBot"]) {
      expect(uas).toContain(ua);
    }
  });

  it("points at an absolute sitemap and host", () => {
    expect(r.sitemap).toBe(`${SITE_URL}/sitemap.xml`);
    expect(r.host).toBe(SITE_URL);
  });
});

describe("structured-data", () => {
  it("site graph carries Organization + WebSite with a valid SearchAction template", () => {
    const g = siteGraphLd() as { "@graph": Record<string, unknown>[] };
    const types = g["@graph"].map((n) => n["@type"]);
    expect(types).toContain("Organization");
    expect(types).toContain("WebSite");
    const site = g["@graph"].find((n) => n["@type"] === "WebSite") as {
      potentialAction: { target: { urlTemplate: string } };
    };
    // The placeholder must be literal — NOT percent-encoded — or Google rejects the SearchAction.
    expect(site.potentialAction.target.urlTemplate).toBe(`${SITE_URL}/registry?q={search_term_string}`);
    expect(site.potentialAction.target.urlTemplate).toContain("{search_term_string}");
  });

  it("datasetLd is a Dataset with absolute url + distributions", () => {
    const d = datasetLd({
      name: "n",
      description: "d",
      path: "/domain/vote.gov",
      distributions: [{ format: "application/json", path: "/api/v1/domain/vote.gov" }],
      dateModified: "2026-01-01T00:00:00Z",
    }) as { "@type": string; url: string; distribution: { contentUrl: string }[] };
    expect(d["@type"]).toBe("Dataset");
    expect(d.url).toBe(`${SITE_URL}/domain/vote.gov`);
    expect(d.distribution[0]?.contentUrl).toBe(`${SITE_URL}/api/v1/domain/vote.gov`);
  });

  it("reportLd carries the fingerprint identifier + source", () => {
    const r = reportLd({
      id: 5,
      headline: "h",
      datePublished: "2026-01-01",
      domain: "acus.gov",
      sourceUrl: "https://example.gov/x",
      fingerprint: "abc123",
    }) as { "@type": string; identifier: string; isBasedOn: string; url: string };
    expect(r["@type"]).toBe("Report");
    expect(r.identifier).toBe("sha256:abc123");
    expect(r.isBasedOn).toBe("https://example.gov/x");
    expect(r.url).toBe(`${SITE_URL}/change/5`);
  });

  it("faqLd yields a FAQPage of Question/Answer pairs", () => {
    const f = faqLd([{ question: "q?", answer: "a." }]) as {
      "@type": string;
      mainEntity: { "@type": string; acceptedAnswer: { "@type": string; text: string } }[];
    };
    expect(f["@type"]).toBe("FAQPage");
    expect(f.mainEntity[0]?.["@type"]).toBe("Question");
    expect(f.mainEntity[0]?.acceptedAnswer.text).toBe("a.");
  });

  it("breadcrumbLd numbers items from 1 with absolute item URLs", () => {
    const b = breadcrumbLd([
      { name: "Daylight", path: "/" },
      { name: "FAQ", path: "/faq" },
    ]) as { itemListElement: { position: number; item: string }[] };
    expect(b.itemListElement[0]?.position).toBe(1);
    expect(b.itemListElement[1]?.item).toBe(`${SITE_URL}/faq`);
  });

  it("webPageLd builds the requested page type", () => {
    const w = webPageLd({ type: "CollectionPage", name: "Ledger", description: "d", path: "/ledger" }) as {
      "@type": string;
      url: string;
    };
    expect(w["@type"]).toBe("CollectionPage");
    expect(w.url).toBe(`${SITE_URL}/ledger`);
  });

  it("absolute() resolves site paths against SITE_URL", () => {
    expect(absolute("/x")).toBe(`${SITE_URL}/x`);
  });
});
