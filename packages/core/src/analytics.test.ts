import { describe, expect, it } from "vitest";
import { classifyHit, classifyReferer, normalizePath } from "./analytics.js";

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
