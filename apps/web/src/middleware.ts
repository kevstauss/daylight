import { type NextRequest, NextResponse } from "next/server";

// Per-request nonce-based Content-Security-Policy. This is the one place a strict CSP can live
// with Next's inline hydration scripts + our inline no-flash theme script: each request gets a
// fresh nonce, the layout stamps it on our inline <script>, and Next stamps it on its own
// scripts (it reads the nonce from the CSP header we set on the request). `strict-dynamic` lets
// those nonce'd scripts load their chunks without allowlisting every path. Defense in depth —
// there's no known XSS sink, but this makes injected script un-executable if one ever appears.
export function middleware(request: NextRequest): NextResponse {
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
  return response;
}

export const config = {
  // Node.js runtime: this app has no edge runtime (its schedulers + SQLite are node-only), so
  // running middleware in node avoids Next compiling that node-only graph for edge.
  runtime: "nodejs",
  // Everything except Next's static assets, images, and static files (favicon/icons/etc.).
  matcher: [
    {
      source: "/((?!_next/static|_next/image|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml|json)$).*)",
    },
  ],
};
