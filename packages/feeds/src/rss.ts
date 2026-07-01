import { domainLink, type FeedEntry, type FeedMeta } from "./entry.js";

/** Minimal, correct XML text escaping for element content + attributes. */
export function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

const rfc822 = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? new Date(0).toUTCString() : d.toUTCString();
};

/** Render changes as an RSS 2.0 document (with an atom:link self reference). */
export function renderRss(entries: FeedEntry[], meta: FeedMeta): string {
  const site = meta.siteUrl.replace(/\/+$/, "");
  const lastBuild =
    entries.length && entries[0] ? rfc822(entries[0].detectedAt) : new Date(0).toUTCString();

  const items = entries
    .map((e) => {
      const link = domainLink(site, e.domain);
      const desc = e.summary && e.summary.trim() ? e.summary.trim() : e.title;
      return [
        "    <item>",
        `      <title>${xmlEscape(e.title)}</title>`,
        `      <link>${xmlEscape(link)}</link>`,
        `      <guid isPermaLink="false">daylight-change-${xmlEscape(String(e.id))}</guid>`,
        `      <pubDate>${rfc822(e.detectedAt)}</pubDate>`,
        `      <category>${xmlEscape(e.severity)}</category>`,
        `      <description>${xmlEscape(desc)}</description>`,
        "    </item>",
      ].join("\n");
    })
    .join("\n");

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    "  <channel>",
    `    <title>${xmlEscape(meta.title)}</title>`,
    `    <link>${xmlEscape(site)}</link>`,
    `    <description>${xmlEscape(meta.description)}</description>`,
    `    <atom:link href="${xmlEscape(meta.feedUrl)}" rel="self" type="application/rss+xml" />`,
    `    <lastBuildDate>${lastBuild}</lastBuildDate>`,
    "    <generator>Daylight</generator>",
    items ? items : "",
    "  </channel>",
    "</rss>",
    "",
  ]
    .filter((line) => line !== "")
    .join("\n");
}
