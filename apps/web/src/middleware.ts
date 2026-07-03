import { type NextRequest, NextResponse } from "next/server";
import { flag, isExcludedClientIp } from "@daylight/core";

// Per-request nonce-based Content-Security-Policy. This is the one place a strict CSP can live
// with Next's inline hydration scripts + our inline no-flash theme script: each request gets a
// fresh nonce, the layout stamps it on our inline <script>, and Next stamps it on its own
// scripts (it reads the nonce from the CSP header we set on the request). `strict-dynamic` lets
// those nonce'd scripts load their chunks without allowlisting every path. Defense in depth —
// there's no known XSS sink, but this makes injected script un-executable if one ever appears.
export async function middleware(request: NextRequest): Promise<NextResponse> {
  const nonce = btoa(crypto.randomUUID());
  const csp = [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    `style-src 'self' 'unsafe-inline'`, // Tailwind/Next inject inline styles; low-risk to allow
    `img-src 'self' data: blob:`,
    `font-src 'self' data:`,
    `connect-src 'self'`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
    `upgrade-insecure-requests`,
  ].join("; ");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  // Next reads the nonce off the request-side CSP header to stamp its own scripts.
  requestHeaders.set("content-security-policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("content-security-policy", csp);

  // First-party, aggregate-only analytics for /privacy. Best-effort + privacy-preserving. The
  // ingest module (dynamically imported so better-sqlite3 stays out of the middleware graph)
  // stores no IP/UA/cookie — see ./lib/analytics-ingest + the analytics_hits schema. Any failure
  // here is swallowed: analytics must never delay or break a response.
  //
  // A "visit" = a full page load. Next strips its own RSC/prefetch headers before middleware
  // (verified: `next-router-prefetch`/`rsc` arrive null), so the reliable signal is the browser-
  // set Sec-Fetch metadata: a top-level navigation is `sec-fetch-dest: document`, whereas every
  // Next fetch — client-side soft-nav AND link prefetch alike — is `sec-fetch-dest: empty`.
  // Counting only document loads (plus header-less non-browser clients like RSS readers) means
  // link prefetches can't inflate the numbers. `Sec-Purpose` additionally excludes a browser
  // prerender (which *is* document-dest). DNT is honored outright.
  const dest = request.headers.get("sec-fetch-dest");
  const isPrefetch =
    (request.headers.get("sec-purpose") ?? "").includes("prefetch") ||
    (request.headers.get("purpose") ?? request.headers.get("x-purpose")) === "prefetch";
  // Leave the operator's own visits out of the counts (they'd swamp a low-traffic launch). The
  // client IP is read transiently ONLY for this decision and never stored/logged — /privacy's
  // "no IP is ever written" pledge holds. Fly-Client-IP is the real client on Fly; fall back to
  // the first X-Forwarded-For hop. DAYLIGHT_ANALYTICS_EXCLUDE_IPS unset ⇒ excludes nobody.
  const clientIp =
    request.headers.get("fly-client-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    null;
  if (
    flag("FLAG_ANALYTICS") &&
    request.method === "GET" &&
    request.headers.get("dnt") !== "1" &&
    !isPrefetch &&
    !isExcludedClientIp(clientIp, process.env.DAYLIGHT_ANALYTICS_EXCLUDE_IPS) &&
    (dest === "document" || dest === null)
  ) {
    try {
      const { recordRequestHit } = await import("./lib/analytics-ingest");
      const url = new URL(request.url);
      recordRequestHit(url.pathname, request.headers.get("referer"), url.host);
    } catch {
      /* best-effort; ignore */
    }
  }

  return response;
}

export const config = {
  // Node.js runtime: this app has no edge runtime (its schedulers + SQLite are node-only), so
  // running middleware in node avoids Next compiling that node-only graph for edge.
  runtime: "nodejs",
  // Everything except Next's static assets and images. Note `.xml`/`.json` are intentionally NOT
  // excluded: feeds (feed.xml/feed.json) and the API must pass through so their consumption is
  // counted for /privacy, and so the strict CSP covers them too (purely additive — safe). The
  // health-check /status.json still runs middleware but is dropped in normalizePath, not recorded.
  matcher: [
    {
      source: "/((?!_next/static|_next/image|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt)$).*)",
    },
  ],
};
