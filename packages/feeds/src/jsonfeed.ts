import { domainLink, type FeedEntry, type FeedMeta } from "./entry.js";

export interface JsonFeedItem {
  id: string;
  url: string;
  title: string;
  content_text: string;
  date_published: string;
  tags: string[];
}

export interface JsonFeed {
  version: string;
  title: string;
  home_page_url: string;
  feed_url: string;
  description: string;
  items: JsonFeedItem[];
}

/** Render changes as a JSON Feed 1.1 object (JSON Feed spec). */
export function renderJsonFeed(entries: FeedEntry[], meta: FeedMeta): JsonFeed {
  const site = meta.siteUrl.replace(/\/+$/, "");
  return {
    version: "https://jsonfeed.org/version/1.1",
    title: meta.title,
    home_page_url: site,
    feed_url: meta.feedUrl,
    description: meta.description,
    items: entries.map((e) => ({
      id: `daylight-change-${e.id}`,
      url: domainLink(site, e.domain),
      title: e.title,
      content_text: e.summary && e.summary.trim() ? e.summary.trim() : e.title,
      date_published: e.detectedAt,
      tags: [e.severity, e.domain],
    })),
  };
}
