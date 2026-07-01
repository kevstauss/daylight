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
