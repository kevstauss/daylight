import { afterEach, describe, expect, it } from "vitest";
import {
  assertScannableUrl,
  isAllowedByRobots,
  isBlockedIp,
  isGatedNavigation,
  looksGated,
  robotsAllows,
} from "./guards.js";

describe("SSRF guard — only public http(s) is scannable", () => {
  it("blocks loopback / private / link-local / metadata addresses", () => {
    for (const ip of ["127.0.0.1", "0.0.0.0", "10.1.2.3", "172.16.5.5", "192.168.0.10", "169.254.169.254", "100.64.0.1", "::1", "fe80::1", "fd00::1"]) {
      expect(isBlockedIp(ip)).toBe(true);
    }
    for (const ip of ["8.8.8.8", "1.1.1.1", "93.184.216.34", "2606:2800:220:1:248:1893:25c8:1946"]) {
      expect(isBlockedIp(ip)).toBe(false);
    }
  });

  it("rejects non-http(s) schemes and private-IP hosts", async () => {
    await expect(assertScannableUrl("file:///etc/passwd")).rejects.toThrow(/http/i);
    await expect(assertScannableUrl("ftp://example.gov/")).rejects.toThrow();
    await expect(assertScannableUrl("http://127.0.0.1/")).rejects.toThrow(/non-public/i);
    await expect(assertScannableUrl("http://169.254.169.254/latest/meta-data/")).rejects.toThrow();
  });
});

describe("robots.txt evaluation", () => {
  it("honors Disallow prefixes for our bot / the wildcard group", () => {
    const r = "User-agent: *\nDisallow: /private\nDisallow: /staging\n";
    expect(robotsAllows(r, "/private/x")).toBe(false);
    expect(robotsAllows(r, "/staging")).toBe(false);
    expect(robotsAllows(r, "/public")).toBe(true);
    expect(robotsAllows("", "/anything")).toBe(true);
  });
});

describe("access-gate detection", () => {
  it("flags a Cloudflare Access / SSO wall (existence-only, never followed)", () => {
    expect(looksGated("https://loveisaskill.cloudflareaccess.com/")).toBe(true);
    expect(looksGated("https://login.microsoftonline.com/oauth2/authorize")).toBe(true);
    expect(looksGated("https://ndstudio.gov/")).toBe(false);
  });

  it("flags the broader IdP set (Auth0 / Okta / login.gov)", () => {
    expect(looksGated("https://example.auth0.com/authorize")).toBe(true);
    expect(looksGated("https://agency.okta.com/app/x")).toBe(true);
    expect(looksGated("https://secure.login.gov/")).toBe(true);
  });

  it("isGatedNavigation catches a 401 / password field even when the URL looks benign", () => {
    expect(isGatedNavigation({ finalUrl: "https://example.gov/portal", status: 401 })).toBe(true);
    expect(isGatedNavigation({ finalUrl: "https://example.gov/portal", hasPasswordField: true })).toBe(true);
    expect(isGatedNavigation({ finalUrl: "https://example.gov/about" })).toBe(false);
  });
});

describe("robots.txt fetch — SSRF-safe (never follows a redirect to a private host)", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("does not follow a cross-origin redirect to the cloud-metadata address", async () => {
    const calls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      calls.push(String(input));
      // The origin's /robots.txt 302s to the metadata service — the classic redirect-SSRF.
      return new Response(null, {
        status: 302,
        headers: { location: "http://169.254.169.254/latest/meta-data/" },
      });
    }) as typeof fetch;

    // Use a literal public IP as the host so hostAllowed resolves without a real DNS query.
    const allowed = await isAllowedByRobots("https://8.8.8.8/page", "DaylightBot");
    expect(allowed).toBe(true); // courtesy-allow — but WITHOUT ever hitting the private target
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("8.8.8.8");
    expect(calls.some((u) => u.includes("169.254.169.254"))).toBe(false);
  });
});
