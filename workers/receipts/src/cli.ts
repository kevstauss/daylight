// Receipts snapshot CLI — snapshot the watched apex homepages live (DOM + screenshot),
// diff vs the last snapshot, and emit removals. Public pages, load-only (same guardrails as
// Floodlight). Wayback archiving is opt-in via DAYLIGHT_WAYBACK=1.
//
// Usage: pnpm --filter @daylight/receipts snapshot

import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { loadWatchlist } from "@daylight/core";
import { createDb, resolveDbPath } from "@daylight/db";
import { CURATED_GOV } from "@daylight/floodlight";
import { makeArchiver } from "./archive.js";
import { runReceiptsSweep } from "./sweep.js";

function findWatchlist(): string {
  const env = process.env.DAYLIGHT_WATCHLIST?.trim();
  if (env && existsSync(env)) return env;
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    const p = resolve(dir, "config", "watchlist.yaml");
    if (existsSync(p)) return p;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("config/watchlist.yaml not found (set DAYLIGHT_WATCHLIST)");
}

/** `--hosts a.gov,b.gov` narrows the sweep to specific hosts. The full sweep takes about an
 *  hour, which is the wrong tool when a single newly-registered domain has no archive anywhere
 *  and wants one now. Hosts still pass the sweep's own .gov + SSRF guards. */
function hostsArg(): string[] | null {
  const i = process.argv.indexOf("--hosts");
  const raw = i !== -1 ? process.argv[i + 1] : undefined;
  if (!raw) return null;
  const hosts = raw
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  return hosts.length ? hosts : null;
}

async function main(): Promise<void> {
  const db = createDb(resolveDbPath());
  const failureByUrl = new Map<string, string>();
  const wayback = process.env.DAYLIGHT_WAYBACK === "1" ? makeArchiver({
    onFailure: (url, reason) => {
      failureByUrl.set(url, reason);
      console.warn(`[receipts] archive failed — ${url}: ${reason}`);
    },
    onAdopt: (url, archiveUrl, drift) =>
      console.log(`[receipts] adopted existing IA capture — ${url} -> ${archiveUrl} (${drift}m drift)`),
  }) : undefined;
  const channel = process.env.DAYLIGHT_BROWSER_CHANNEL;
  const only = hostsArg();
  const hosts = only ?? (() => {
    const wl = loadWatchlist(findWatchlist());
    return [...CURATED_GOV, ...wl.apexDomains, ...wl.subdomainApexes];
  })();
  try {
    if (only) console.log(`[receipts] targeted sweep — ${hosts.join(", ")}`);
    // eslint-disable-next-line no-console
    const r = await runReceiptsSweep(db, hosts, {
      channel,
      waybackSave: wayback,
      log: (m) => console.log(m),
      archiveFailureFor: (host) => failureByUrl.get(`https://${host}/`),
    });
    // eslint-disable-next-line no-console
    console.log(
      `[receipts] sweep complete — ${r.captured} captured, ${r.gated} gated, ${r.removals} removals, ` +
        `${r.archived} archived, ${r.archiveFailed} archive failures, ` +
        `${r.policyChanges} policy changes, ${r.archiverRefusals} archiver refusals`,
    );
  } finally {
    db.close();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[receipts] fatal", err);
  process.exit(1);
});
