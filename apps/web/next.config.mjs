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
  ],
  // better-sqlite3 is a native addon — never bundle it; require at runtime.
  serverExternalPackages: ["better-sqlite3"],
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
