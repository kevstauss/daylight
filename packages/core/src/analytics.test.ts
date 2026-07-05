import { describe, expect, it } from "vitest";
import {
  classifyHit,
  classifyReferer,
  isCountableFetchDest,
  isExcludedClientIp,
  isExcludedUserAgent,
  normalizePath,
} from "./analytics.js";

describe("normalizePath", () => {
  it("keeps root and known static routes (case/slash normalized)", () => {
    expect(normalizePath("/")).toBe("/");
    expect(normalizePath("/registry")).toBe("/registry");
    expect(normalizePath("/methods/")).toBe("/methods");
    expect(normalizePath("/PRIVACY")).toBe("/privacy");
  });

  it("collapses dynamic routes to patterns so no raw value is stored", () => {
    expect(normalizePath("/domain/whitehouse.gov")).toBe("/domain/:name");
    expect(normalizePath("/change/12345")).toBe("/change/:id");
    expect(normalizePath("/receipts/https%3A%2F%2Fepa.gov")).toBe("/receipts/:url");
    expect(normalizePath("/floodlight/https%3A%2F%2Firs.gov")).toBe("/floodlight/:url");
  });

  it("keeps the floodlight index and scan box distinct", () => {
    expect(normalizePath("/floodlight")).toBe("/floodlight");
    expect(normalizePath("/floodlight/scan")).toBe("/floodlight/scan");
    expect(normalizePath("/receipts")).toBe("/receipts");
  });

  it("buckets unknown/probe paths so cardinality stays bounded", () => {
    expect(normalizePath("/wp-login.php")).toBe("/other");
    expect(normalizePath("/.env")).toBe("/other");
    expect(normalizePath("/api/v1/changes")).toBe("/api");
  });

  it("collapses every feed (global + per-module) into one consumption bucket", () => {
    expect(normalizePath("/feed.xml")).toBe("/feed");
    expect(normalizePath("/feed.json")).toBe("/feed");
    expect(normalizePath("/ledger/feed.xml")).toBe("/feed");
    expect(normalizePath("/floodlight/feed.json")).toBe("/feed");
  });

  it("excludes health + internal endpoints from analytics entirely", () => {
    expect(normalizePath("/status")).toBeNull();
    expect(normalizePath("/status.json")).toBeNull(); // Fly health check, every 30s
    expect(normalizePath("/review")).toBeNull();
  });
});

describe("classifyReferer", () => {
  it("treats a missing referer as direct", () => {
    expect(classifyReferer(null)).toEqual({ kind: "direct", host: "" });
    expect(classifyReferer("")).toEqual({ kind: "direct", host: "" });
  });

  it("classifies federal .gov referrers and retains only the public apex", () => {
    expect(classifyReferer("https://www.epa.gov/some/page")).toEqual({ kind: "gov", host: "epa.gov" });
    expect(classifyReferer("https://login.gov/")).toEqual({ kind: "gov", host: "login.gov" });
    expect(classifyReferer("https://a.b.irs.gov/x")).toEqual({ kind: "gov", host: "irs.gov" });
  });

  it("does not treat the bare 'gov' label as federal", () => {
    expect(classifyReferer("https://gov/").kind).not.toBe("gov");
  });

  it("buckets search engines coarsely, storing no host", () => {
    expect(classifyReferer("https://www.google.com/search?q=x")).toEqual({ kind: "search", host: "" });
    expect(classifyReferer("https://duckduckgo.com/")).toEqual({ kind: "search", host: "" });
  });

  it("folds same-origin referrers into direct (internal navigation)", () => {
    expect(classifyReferer("https://daylight.watch/registry", "daylight.watch")).toEqual({
      kind: "direct",
      host: "",
    });
    expect(classifyReferer("http://localhost:3000/methods", "localhost:3000")).toEqual({
      kind: "direct",
      host: "",
    });
  });

  it("keeps everything else as 'other' with no host retained", () => {
    expect(classifyReferer("https://news.ycombinator.com/")).toEqual({ kind: "other", host: "" });
    expect(classifyReferer("::: not a url :::")).toEqual({ kind: "other", host: "" });
  });
});

describe("classifyHit", () => {
  it("returns null for excluded paths (nothing recorded)", () => {
    expect(classifyHit("/status", null, "daylight.watch")).toBeNull();
  });

  it("combines a normalized path with the referrer class", () => {
    expect(classifyHit("/floodlight", "https://irs.gov/privacy", "daylight.watch")).toEqual({
      path: "/floodlight",
      refKind: "gov",
      refHost: "irs.gov",
    });
  });
});

describe("isCountableFetchDest", () => {
  it("counts a real browser navigation (document) on any human page route", () => {
    expect(isCountableFetchDest("document", "/lookout")).toBe(true);
    expect(isCountableFetchDest("document", "/")).toBe(true);
    expect(isCountableFetchDest("document", "/domain/:name")).toBe(true);
  });

  it("does NOT count a header-less client on a human page route (the AI-agent/proxy leak)", () => {
    // No Sec-Fetch-Dest ⇒ non-browser client. On a page route this is a script/crawler/AI agent —
    // including one whose UA was rewritten by a proxy past the allowlist — never a visit.
    expect(isCountableFetchDest(null, "/lookout")).toBe(false);
    expect(isCountableFetchDest(undefined, "/registry")).toBe(false);
    expect(isCountableFetchDest("", "/")).toBe(false);
  });

  it("still counts header-less clients for the feed + API consumption buckets", () => {
    // RSS readers and API clients legitimately send no Sec-Fetch metadata — /privacy reports these
    // as feed/API pulls, so they must keep counting.
    expect(isCountableFetchDest(null, "/feed")).toBe(true);
    expect(isCountableFetchDest(undefined, "/api")).toBe(true);
    expect(isCountableFetchDest("", "/feed")).toBe(true);
  });

  it("never counts a subresource / soft-nav / prefetch dest", () => {
    expect(isCountableFetchDest("empty", "/lookout")).toBe(false); // Next soft-nav & link prefetch
    expect(isCountableFetchDest("empty", "/feed")).toBe(false);
    expect(isCountableFetchDest("image", "/")).toBe(false);
    expect(isCountableFetchDest("script", "/")).toBe(false);
  });
});

describe("isExcludedClientIp", () => {
  it("excludes nobody when the IP or allowlist is empty/unset", () => {
    expect(isExcludedClientIp("203.0.113.7", undefined)).toBe(false);
    expect(isExcludedClientIp("203.0.113.7", "")).toBe(false);
    expect(isExcludedClientIp("203.0.113.7", "   ")).toBe(false);
    expect(isExcludedClientIp(null, "203.0.113.7")).toBe(false);
    expect(isExcludedClientIp("", "203.0.113.7")).toBe(false);
  });

  it("matches an exact IPv4, but not a different address", () => {
    expect(isExcludedClientIp("203.0.113.7", "203.0.113.7")).toBe(true);
    expect(isExcludedClientIp("203.0.113.8", "203.0.113.7")).toBe(false);
    // an exact entry is a full match — not a prefix of a longer address
    expect(isExcludedClientIp("203.0.113.70", "203.0.113.7")).toBe(false);
  });

  it("supports a trailing-dot IPv4 prefix as a range", () => {
    expect(isExcludedClientIp("203.0.113.42", "203.0.113.")).toBe(true);
    expect(isExcludedClientIp("203.0.114.42", "203.0.113.")).toBe(false);
  });

  it("supports a trailing-colon IPv6 prefix, case-insensitively", () => {
    expect(isExcludedClientIp("2001:DB8:abcd::1", "2001:db8:")).toBe(true);
    expect(isExcludedClientIp("2001:dead::1", "2001:db8:")).toBe(false);
  });

  it("accepts a comma/space-separated list and trims entries", () => {
    const list = "203.0.113.7, 198.51.100. ,  2001:db8:";
    expect(isExcludedClientIp("203.0.113.7", list)).toBe(true);
    expect(isExcludedClientIp("198.51.100.9", list)).toBe(true);
    expect(isExcludedClientIp("2001:db8::5", list)).toBe(true);
    expect(isExcludedClientIp("8.8.8.8", list)).toBe(false);
  });
});

describe("isExcludedUserAgent", () => {
  const CHROME =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

  it("excludes Claude Code's real fetcher UA (the reported inflation source)", () => {
    // Captured verbatim from httpbin.org/user-agent via Claude Code's WebFetch.
    expect(
      isExcludedUserAgent("Claude-User (claude-code/2.1.199; +https://support.anthropic.com/)"),
    ).toBe(true);
    expect(isExcludedUserAgent("ClaudeBot/1.0 (+https://www.anthropic.com/claudebot)")).toBe(true);
    expect(isExcludedUserAgent("anthropic-ai")).toBe(true);
  });

  it("excludes other AI, search, and SEO crawlers (case-insensitively)", () => {
    expect(isExcludedUserAgent("Mozilla/5.0 (compatible; GPTBot/1.2; +https://openai.com/gptbot)")).toBe(true);
    expect(isExcludedUserAgent("Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)")).toBe(true);
    expect(isExcludedUserAgent("Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)")).toBe(true);
    expect(isExcludedUserAgent("CCBot/2.0 (https://commoncrawl.org/faq/)")).toBe(true);
    expect(isExcludedUserAgent("SomethingUnknown Spider/1.0")).toBe(true); // generic "spider" marker
    expect(isExcludedUserAgent("MysteryCrawler/9")).toBe(true); // generic "crawler" marker
  });

  it("counts real human browsers — no false positives", () => {
    expect(isExcludedUserAgent(CHROME)).toBe(false); // 'AppleWebKit' must not trip 'applebot'
    expect(
      isExcludedUserAgent(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
      ),
    ).toBe(false);
    // The "CUBOT" phone brand contains the substring "bot" — must NOT be excluded (why we avoid bare "bot").
    expect(
      isExcludedUserAgent("Mozilla/5.0 (Linux; Android 12; CUBOT_KingKong ...) AppleWebKit/537.36"),
    ).toBe(false);
  });

  it("still counts legit programmatic consumers by default (feed/API pulls metric)", () => {
    // Generic HTTP tools are intentionally NOT in the built-in list — a real API/feed consumer.
    expect(isExcludedUserAgent("curl/8.4.0")).toBe(false);
    expect(isExcludedUserAgent("python-requests/2.31.0")).toBe(false);
    expect(isExcludedUserAgent("NetNewsWire/6.1.4")).toBe(false); // RSS reader
  });

  it("does not exclude a missing or blank UA (header-less RSS readers still count)", () => {
    expect(isExcludedUserAgent(null)).toBe(false);
    expect(isExcludedUserAgent(undefined)).toBe(false);
    expect(isExcludedUserAgent("")).toBe(false);
    expect(isExcludedUserAgent("   ")).toBe(false);
  });

  it("extends the built-ins with DAYLIGHT_ANALYTICS_EXCLUDE_UA (comma/space-separated, additive)", () => {
    // Built-ins still apply even when extras are supplied.
    expect(isExcludedUserAgent("ClaudeBot/1.0", "curl/, myscript")).toBe(true);
    // Extra tokens opt additional clients out.
    expect(isExcludedUserAgent("curl/8.4.0", "curl/, myscript")).toBe(true);
    expect(isExcludedUserAgent("MyScript/1.0", "curl/, myscript")).toBe(true);
    // A normal browser is untouched by the extras.
    expect(isExcludedUserAgent(CHROME, "curl/, myscript")).toBe(false);
  });
});
