/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Workspace packages are consumed as raw TypeScript source. @daylight/ledger is
  // included so the in-process daily scheduler (instrumentation.ts) can invoke it.
  transpilePackages: [
    "@daylight/core",
    "@daylight/db",
    "@daylight/feeds",
    "@daylight/redact",
    "@daylight/ledger",
    "@daylight/enrich",
    "@daylight/lookout",
    "@daylight/fingerprints",
    "@daylight/floodlight",
    "@daylight/receipts",
  ],
  // Native / heavy server-only packages — never bundle; require at runtime.
  serverExternalPackages: ["better-sqlite3", "playwright", "playwright-core"],
  // The internal review queue handles the one non-public surface. Never leak its URL
  // as a Referer, never let a proxy cache it, and keep it out of search indexes —
  // defense in depth on top of the HttpOnly cookie gate in review/page.tsx.
  async headers() {
    return [
      {
        // Zero-downside defense-in-depth on every route. (No CSP yet: the no-flash theme
        // script is inline, so a strict CSP needs a nonce via middleware — deferred.)
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
      {
        source: "/review",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
          { key: "Cache-Control", value: "no-store, max-age=0" },
        ],
      },
    ];
  },
  // Workspace packages use ESM-correct ".js" import specifiers that point at ".ts"
  // source. Teach webpack to resolve them (tsc/vitest/tsx already do).
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
      ".mjs": [".mts", ".mjs"],
    };
    return config;
  },
};

export default nextConfig;
