import { describe, expect, it } from "vitest";
import { assertScannableUrl, isBlockedIp, looksGated, robotsAllows } from "./guards.js";

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
});
