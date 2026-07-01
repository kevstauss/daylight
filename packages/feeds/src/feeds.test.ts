import { describe, expect, it } from "vitest";
import { changeToEntry, type ChangeLike, type FeedMeta } from "./entry.js";
import { renderRss } from "./rss.js";
import { renderJsonFeed } from "./jsonfeed.js";

const meta: FeedMeta = {
  title: "Daylight — changes",
  description: "Ownership + contact changes across the federal .gov registry.",
  siteUrl: "https://daylight.example/",
  feedUrl: "https://daylight.example/ledger/feed.xml",
};

const change: ChangeLike = {
  id: 42,
  domain: "usadf.gov",
  detected_at: "2026-07-01T08:00:00.000Z",
  kind: "added",
  field: null,
  old_value: null,
  new_value: "akash@ndstudio.gov",
  severity: "high",
  reason: "security contact is @ndstudio.gov, foreign to usadf.gov (United States African Development Foundation)",
};

describe("feeds", () => {
  it("renders valid-looking RSS with a working deep link and escaped content", () => {
    const xml = renderRss([changeToEntry(change)], meta);
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain("<link>https://daylight.example/domain/usadf.gov</link>");
    expect(xml).toContain("<category>high</category>");
    expect(xml).toContain("daylight-change-42");
    // ampersand-free reason here, but ensure escaping path is active
    expect(xml).not.toContain("<script>");
  });

  it("escapes XML-significant characters", () => {
    const xml = renderRss(
      [changeToEntry({ ...change, reason: "org changed to A & B <Corp>" })],
      meta,
    );
    expect(xml).toContain("A &amp; B &lt;Corp&gt;");
  });

  it("renders JSON Feed 1.1 with tags", () => {
    const feed = renderJsonFeed([changeToEntry(change)], meta);
    expect(feed.version).toBe("https://jsonfeed.org/version/1.1");
    expect(feed.items[0]?.url).toBe("https://daylight.example/domain/usadf.gov");
    expect(feed.items[0]?.tags).toContain("high");
  });
});
