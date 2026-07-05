import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchPublicPage } from "./fetchpage.js";

// A permissive robots.txt for the (global) robots fetch that guards.ts makes. The PAGE fetch uses
// the injected fetchImpl; only the robots probe hits global fetch, so stubbing it keeps tests
// hermetic (no real network) while letting the request proceed past the robots gate.
const allowRobots = () => vi.stubGlobal("fetch", async () => new Response("User-agent: *\nAllow: /", { status: 200 }));

afterEach(() => vi.unstubAllGlobals());

describe("fetchPublicPage — guarded, existence-only page reader", () => {
  it("refuses a non-.gov host in prod mode, without any page fetch", async () => {
    const spy = vi.fn();
    const r = await fetchPublicPage("https://example.com/privacy", { fetchImpl: spy });
    expect(r.ok).toBe(false);
    expect(r.note).toMatch(/only accepts federal \.gov/i);
    expect(spy).not.toHaveBeenCalled(); // rejected before any network
  });

  it("refuses a non-http(s) scheme (no file:/ftp: SSRF)", async () => {
    const spy = vi.fn();
    const r = await fetchPublicPage("file:///etc/passwd", { fetchImpl: spy });
    expect(r.ok).toBe(false);
    expect(r.note).toMatch(/refused/i);
    expect(spy).not.toHaveBeenCalled();
  });

  it("returns visible text with PII redacted and scripts/styles stripped", async () => {
    allowRobots();
    const html = `<html><head><style>.x{color:red}</style></head><body>
      <h1>Privacy Policy</h1>
      <p>Contact privacy@example.gov or call 202-555-0134. SSN 123-45-6789.</p>
      <script>sendToTracker()</script></body></html>`;
    const fetchImpl = async () => new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
    const r = await fetchPublicPage("http://fixture.test/privacy", { fetchImpl, allowPrivate: true });
    expect(r.ok).toBe(true);
    expect(r.gated).toBe(false);
    expect(r.text).toContain("Privacy Policy");
    expect(r.text).toContain("[redacted:email]");
    expect(r.text).toContain("[redacted:phone]");
    expect(r.text).toContain("[redacted:ssn]");
    expect(r.text).not.toContain("privacy@example.gov"); // PII never leaves the function
    expect(r.text).not.toContain("sendToTracker"); // scripts stripped
    expect(r.text).not.toContain(".x{color"); // styles stripped
  });

  it("records existence but NEVER returns the body of a gated page (HTTP 401)", async () => {
    allowRobots();
    const fetchImpl = async () =>
      new Response("<html>SECRET STAGING CONTENT</html>", { status: 401, headers: { "content-type": "text/html" } });
    const r = await fetchPublicPage("http://staging.fixture.test/", { fetchImpl, allowPrivate: true });
    expect(r.ok).toBe(true);
    expect(r.gated).toBe(true);
    expect(r.text).toBeUndefined(); // the bright line: exists, never entered
    expect(r.note).toMatch(/access wall|existence-only/i);
  });

  it("treats a redirect that lands on an access wall as existence-only", async () => {
    allowRobots();
    let n = 0;
    const fetchImpl = async () => {
      n++;
      if (n === 1) {
        return new Response("", { status: 302, headers: { location: "https://fixture.cloudflareaccess.com/login" } });
      }
      return new Response("<html>login form</html>", { status: 200, headers: { "content-type": "text/html" } });
    };
    const r = await fetchPublicPage("http://app.fixture.test/", { fetchImpl, allowPrivate: true });
    expect(r.gated).toBe(true);
    expect(r.text).toBeUndefined();
    expect(r.finalUrl).toMatch(/cloudflareaccess/);
  });

  it("does not return non-HTML content (e.g. a PDF)", async () => {
    allowRobots();
    const fetchImpl = async () =>
      new Response("%PDF-1.4 binary...", { status: 200, headers: { "content-type": "application/pdf" } });
    const r = await fetchPublicPage("http://fixture.test/pia.pdf", { fetchImpl, allowPrivate: true });
    expect(r.ok).toBe(false);
    expect(r.text).toBeUndefined();
    expect(r.note).toMatch(/not a readable/i);
  });
});
