import http from "node:http";
import type { AddressInfo } from "node:net";
import { createDb } from "@daylight/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { captureAndScore, capturePage } from "./capture.js";

// A fixture page that, on load, fires a first-party analytics POST (reverse-proxy shape),
// links a privacy notice, shows an agency seal, and collects an email — everything the
// capture adapter must surface. Served on localhost so no gov host is touched.
const FIXTURE = `<!doctype html><html><head><title>capture fixture</title></head><body>
  <img src="/great-seal.svg" alt="Great Seal of the United States">
  <form><input type="email" name="email"></form>
  <a href="/privacy">Privacy Policy</a>
  <script>
    fetch('/metrics', { method:'POST', headers:{'content-type':'application/json'},
      body: JSON.stringify({ event:'$pageview', properties:{ $session_id:'s1' }, distinct_id:'u1', api_key:'phc_x' }) });
  </script>
</body></html>`;

let server: http.Server;
let port = 0;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.url === "/metrics") {
      res.writeHead(200);
      res.end("ok");
      return;
    }
    res.writeHead(200, { "content-type": "text/html" });
    res.end(FIXTURE);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as AddressInfo).port;
});

afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe("live capture (Playwright, local fixture — no gov hosts)", () => {
  it("captures every request + DOM facts from a passively-loaded page", async () => {
    const res = await capturePage(`http://127.0.0.1:${port}/`, {
      allowPrivate: true,
      channel: "chrome",
      respectRobots: false,
    });

    expect(res.gated).toBe(false);
    const metrics = res.capture.requests.find(
      (r) => r.url.endsWith("/metrics") && r.method === "POST",
    );
    expect(metrics).toBeTruthy();
    expect(metrics!.postBody).toContain("distinct_id");
    expect(res.capture.dom.privacyNoticeUrl).toContain("/privacy");
    expect(res.capture.dom.hasSeal).toBe(true);
    expect(res.capture.dom.formFields).toContain("email");
    expect(res.screenshotPng).toBeTruthy();
  }, 45000);

  it("captureAndScore persists a scorecard and flags the first-party reverse-proxy shape", async () => {
    const db = createDb(":memory:");
    const r = await captureAndScore(db, `http://127.0.0.1:${port}/`, {
      allowPrivate: true,
      channel: "chrome",
      respectRobots: false,
    });
    expect(r.ok).toBe(true);
    expect(r.gated).toBe(false);
    const cards = db.listScorecards();
    expect(cards).toHaveLength(1);
    expect(cards[0]!.first_party_proxied).toBe(1);
    expect(cards[0]!.severity).toBe("high");
  }, 45000);
});
