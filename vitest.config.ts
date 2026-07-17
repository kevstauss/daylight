import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Tests run against package *source* (no build step) via these aliases.
const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@daylight/core": r("./packages/core/src/index.ts"),
      "@daylight/db": r("./packages/db/src/index.ts"),
      "@daylight/feeds": r("./packages/feeds/src/index.ts"),
      "@daylight/redact": r("./packages/redact/src/index.ts"),
      "@daylight/enrich": r("./packages/enrich/src/index.ts"),
      "@daylight/lookout": r("./workers/lookout/src/index.ts"),
      "@daylight/fingerprints": r("./packages/fingerprints/src/index.ts"),
      "@daylight/floodlight/guards": r("./workers/floodlight/src/guards.ts"),
      "@daylight/floodlight": r("./workers/floodlight/src/index.ts"),
      "@daylight/receipts": r("./workers/receipts/src/index.ts"),
      "@daylight/redtape": r("./workers/redtape/src/index.ts"),
      "@daylight/sitescanning": r("./workers/sitescanning/src/index.ts"),
      "@daylight/github": r("./workers/github/src/index.ts"),
      // apps/web's "@/..." path alias. Only matches "@/…" (not "@daylight/…"), so it composes with
      // the package aliases above and lets web unit tests import server helpers by their real path.
      "@": r("./apps/web/src"),
    },
  },
  test: {
    globals: true,
    environment: "node",
    include: ["packages/**/*.test.ts", "workers/**/*.test.ts", "apps/web/**/*.test.ts"],
    // better-sqlite3 is a native module; keep tests single-threaded-friendly.
    pool: "forks",
  },
});
