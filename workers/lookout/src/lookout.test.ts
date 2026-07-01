import { fileURLToPath } from "node:url";
import type { Watchlist } from "@daylight/core";
import { loadWatchlist } from "@daylight/core";
import { createDb, type DaylightDb } from "@daylight/db";
import { beforeEach, describe, expect, it } from "vitest";
import {
  type CertRecord,
  certsFromFqdns,
  fetchCrtShCerts,
  registrableApex,
  runLookoutBackfill,
  scoreSubdomain,
  splitLabels,
} from "./index.js";

const NOW = "2026-07-01T09:00:00.000Z";
const wl: Watchlist = loadWatchlist(
  fileURLToPath(new URL("../../../config/watchlist.yaml", import.meta.url)),
);

// Real subdomains pulled from CT logs for ndstudio.gov (spec §8 — existence-only).
const REAL_FQDNS = [
  "cms.ndstudio.gov",
  "previews.ndstudio.gov",
  "passports.staging.ndstudio.gov",
  "freedom.previews.ndstudio.gov",
  "analytics.infra.ndstudio.gov",
  "cdn.infra.ndstudio.gov",
  "inference.ndstudio.gov",
  "genesis.assets.ndstudio.gov",
  "admin.ndstudio.gov",
  "vote-gov.previews.ndstudio.gov",
];

/** Seed the Ledger owner for ndstudio.gov so enrichment has something to resolve. */
function seedLedgerOwner(db: DaylightDb): void {
  db.upsertDomain(
    {
      domain: "ndstudio.gov",
      domainType: "Federal - Executive",
      org: "Executive Office of the President",
      suborg: "White House Office",
      city: "Washington",
      state: "DC",
      securityContactEmail: "dl.eop.cloudadmin@eop.gov",
    },
    NOW,
  );
}

let db: DaylightDb;
beforeEach(() => {
  db = createDb(":memory:");
  seedLedgerOwner(db);
});

describe("label parsing", () => {
  it("extracts the registrable apex (last two labels)", () => {
    expect(registrableApex("passports.staging.ndstudio.gov")).toBe("ndstudio.gov");
    expect(registrableApex("ndstudio.gov")).toBe("ndstudio.gov");
    expect(registrableApex("genesis.energy.gov")).toBe("energy.gov");
  });
  it("splits the labels left of the apex", () => {
    expect(splitLabels("passports.staging.ndstudio.gov", "ndstudio.gov")).toEqual([
      "passports",
      "staging",
    ]);
    expect(splitLabels("vote-gov.previews.ndstudio.gov", "ndstudio.gov")).toEqual([
      "vote-gov",
      "previews",
    ]);
  });
});

describe("§8.2 H1 — high-signal label", () => {
  it("passports.staging.ndstudio.gov trips `staging` → high", () => {
    const s = scoreSubdomain("passports.staging.ndstudio.gov", wl);
    expect(s.onWatchlist).toBe(true);
    expect(s.severity).toBe("high");
    expect(s.labels).toContain("staging");
  });
});

describe("§8.3 H2 flagship — function-mimic", () => {
  it("vote-gov.previews.ndstudio.gov looks like vote.gov under a non-owning apex → high", () => {
    const owner = "Executive Office of the President / White House Office";
    const s = scoreSubdomain("vote-gov.previews.ndstudio.gov", wl, owner);
    expect(s.severity).toBe("high");
    expect(s.reason.toLowerCase()).toContain("vote.gov");
    expect(s.reason).toContain("ndstudio.gov");
    expect(s.reason).toContain(owner);
  });
});

describe("§8.3 H2 — legit-owner suppression + correct impersonation naming", () => {
  it("does NOT flag a function hosted under its comparator-designated legit owner", () => {
    // The watchlist records EAC as vote.gov's legitimate owner, so vote.eac.gov is not mimicry.
    const s = scoreSubdomain("vote.eac.gov", wl);
    expect(s.reason.toLowerCase()).not.toContain("looks like");
    expect(s.severity).not.toBe("high");
  });

  it("names the REAL service for a watched shadow apex (passports.gov → travel.state.gov)", () => {
    const s = scoreSubdomain("passport.staging.ndstudio.gov", wl);
    expect(s.reason.toLowerCase()).toContain("travel.state.gov");
    expect(s.reason.toLowerCase()).not.toContain("looks like passports.gov");
  });
});

describe("§8.4 H3 — collection/inference infra", () => {
  it("analytics.infra.ndstudio.gov flags as analytics/infra", () => {
    const s = scoreSubdomain("analytics.infra.ndstudio.gov", wl);
    expect(s.severity).toBe("high");
    expect(s.reason.toLowerCase()).toMatch(/analytics|infra|inference|metrics/);
  });
});

describe("§8.1 + §8.5 backfill — detection, idempotency, enrichment", () => {
  it("each never-seen FQDN emits one added change; re-running emits zero; owner enriched", async () => {
    const certs = certsFromFqdns(REAL_FQDNS);
    const r1 = await runLookoutBackfill({ db, watchlist: wl, certs, now: NOW });
    expect(r1.subdomainsAdded).toBe(REAL_FQDNS.length);
    expect(db.listChanges({ module: "lookout" }).length).toBe(REAL_FQDNS.length);

    // §8.5 enrichment: owner attached from Ledger domains for ndstudio.gov.
    const sub = db.getSubdomain("vote-gov.previews.ndstudio.gov");
    expect(sub?.apex).toBe("ndstudio.gov");
    expect(sub?.apex_owner_org).toBe("Executive Office of the President");
    expect(sub?.apex_owner_suborg).toBe("White House Office");
    expect(sub?.flag_severity).toBe("high");

    // §8.1 idempotency: re-running the same batch adds nothing.
    const r2 = await runLookoutBackfill({ db, watchlist: wl, certs, now: NOW });
    expect(r2.subdomainsAdded).toBe(0);
    expect(db.listChanges({ module: "lookout" }).length).toBe(REAL_FQDNS.length);
  });
});

describe("§8.6 crt.sh resilience", () => {
  it("falls back to HTML scrape on a 502 JSON response, and never crashes", async () => {
    const fetchImpl = async (url: string): Promise<Response> => {
      if (url.includes("output=json")) {
        return new Response("Bad Gateway", { status: 502 });
      }
      // HTML page listing SANs
      const html = `<TD>passports.staging.ndstudio.gov</TD><TD>vote-gov.previews.ndstudio.gov</TD>`;
      return new Response(html, { status: 200 });
    };
    const certs = await fetchCrtShCerts("ndstudio.gov", { fetchImpl, retries: 0 });
    const sans = certs.flatMap((c) => c.sans);
    expect(sans).toContain("passports.staging.ndstudio.gov");
    expect(sans).toContain("vote-gov.previews.ndstudio.gov");
  });

  it("returns [] (no throw) when every request fails", async () => {
    const fetchImpl = async (): Promise<Response> => {
      throw new Error("network down");
    };
    await expect(fetchCrtShCerts("ndstudio.gov", { fetchImpl, retries: 0 })).resolves.toEqual([]);
  });
});
