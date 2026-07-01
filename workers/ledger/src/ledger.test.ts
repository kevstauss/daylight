import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { DomainRecord, Watchlist } from "@daylight/core";
import { loadWatchlist } from "@daylight/core";
import { createDb } from "@daylight/db";
import { changeToEntry, renderRss } from "@daylight/feeds";
import { beforeEach, describe, expect, it } from "vitest";
import {
  contactDomainMismatch,
  diff,
  normalizeCsv,
  recordsToMap,
  runLedger,
} from "./index.js";

const NOW = "2026-07-01T08:00:00.000Z";
const read = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)), "utf8");
const wl: Watchlist = loadWatchlist(
  fileURLToPath(new URL("../../../config/watchlist.yaml", import.meta.url)),
);

const usadfHighAlerts = (db: ReturnType<typeof createDb>) =>
  db.sql
    .prepare(
      `SELECT a.* FROM alerts a JOIN changes c ON a.change_id = c.id
       WHERE c.domain = ? AND c.severity = 'high'`,
    )
    .all("usadf.gov");

const obsCount = (db: ReturnType<typeof createDb>): number =>
  (db.sql.prepare(`SELECT COUNT(*) AS n FROM observations`).get() as { n: number }).n;

// ---------------------------------------------------------------------------
// §5.10 acceptance tests — grounded in real CISA rows.
// ---------------------------------------------------------------------------

describe("§5.10.1 diff — exact added/modified set, no city/state noise", () => {
  it("before → after yields exactly {added: usadf, modified: trumprx contact}", () => {
    const before = normalizeCsv(read("before.csv"));
    const after = normalizeCsv(read("after.csv"));
    const changes = diff(recordsToMap(before.records), recordsToMap(after.records), NOW);

    expect(changes.filter((c) => c.kind === "added").map((c) => c.domain)).toEqual(["usadf.gov"]);
    expect(changes.filter((c) => c.kind === "modified").map((c) => `${c.domain}:${c.field}`)).toEqual(
      ["trumprx.gov:securityContactEmail"],
    );
    // passports.gov changed only city/state → NOT a change event.
    expect(changes.find((c) => c.domain === "passports.gov")).toBeUndefined();
    expect(changes).toHaveLength(2);
  });
});

describe("§5.10.2 H1 flagship — usadf flagged high, no person-watch needed", () => {
  it("contact-domain-mismatch flags usadf structurally (pure function)", () => {
    const after = normalizeCsv(read("after.csv"));
    const usadf = after.records.find((r) => r.domain === "usadf.gov");
    const flag = contactDomainMismatch(usadf!, wl);
    expect(flag).not.toBeNull();
    expect(flag!.contactDomain).toBe("ndstudio.gov");
    expect(flag!.severity).toBe("high"); // ndstudio.gov is a watchlisted product .gov
    expect(flag!.reason).toContain("ndstudio.gov");
    expect(flag!.reason).toContain("usadf.gov");
  });

  it("runLedger flags usadf high with NO subscriptions configured", async () => {
    const noWatch: Watchlist = { ...wl, personWatch: [], orgWatch: [], suborgWatch: [] };
    const db = createDb(":memory:");
    await runLedger({ db, watchlist: noWatch, csvText: read("before.csv"), now: NOW, emitChanges: false });
    await runLedger({ db, watchlist: noWatch, csvText: read("after.csv"), now: NOW });

    const usadfAdded = db.domainHistory("usadf.gov").find((c) => c.kind === "added");
    expect(usadfAdded?.severity).toBe("high");
    expect(usadfAdded?.reason).toContain("ndstudio.gov");
    expect(db.countAlerts()).toBe(0); // heuristic flags a change; it does not create alerts
  });
});

describe("§5.10.3 person-watch — fires exactly once, dedups on re-run", () => {
  it("@ndstudio.gov fires one high alert for usadf, zero on identical re-run", async () => {
    const db = createDb(":memory:");
    await runLedger({ db, watchlist: wl, csvText: read("before.csv"), now: NOW, emitChanges: false });

    await runLedger({ db, watchlist: wl, csvText: read("after.csv"), now: NOW });
    expect(usadfHighAlerts(db)).toHaveLength(1);

    const totalAlerts = db.countAlerts();
    const rerun = await runLedger({ db, watchlist: wl, csvText: read("after.csv"), now: NOW });
    expect(rerun.changesEmitted).toBe(0);
    expect(db.countAlerts()).toBe(totalAlerts); // no new alerts
    expect(usadfHighAlerts(db)).toHaveLength(1);
  });
});

describe("§5.10.4 allowlist sanity — central mailboxes do not trip H1", () => {
  it("EOP + GSA central contacts are not flagged; usadf still is", () => {
    const before = normalizeCsv(read("before.csv"));
    const eopRows = before.records.filter((r) => r.securityContactEmail?.endsWith("@eop.gov"));
    expect(eopRows.length).toBeGreaterThanOrEqual(2);
    for (const r of eopRows) expect(contactDomainMismatch(r, wl)).toBeNull();

    const login = before.records.find((r) => r.domain === "login.gov");
    expect(contactDomainMismatch(login!, wl)).toBeNull(); // gsa.gov allowlisted

    const eac = before.records.find((r) => r.domain === "eac.gov");
    expect(contactDomainMismatch(eac!, wl)).toBeNull(); // contact is own apex

    const after = normalizeCsv(read("after.csv"));
    const usadf = after.records.find((r) => r.domain === "usadf.gov");
    expect(contactDomainMismatch(usadf!, wl)).not.toBeNull();
  });
});

describe("H1 same-org clearing — legit inter-domain contacts stay unflagged", () => {
  const orgOf = (domain: string): string | null =>
    (({
      "eac.gov": "Election Assistance Commission",
      "hhs.gov": "Department of Health and Human Services",
      "ndstudio.gov": "Executive Office of the President",
    }) as Record<string, string>)[domain] ?? null;

  const rec = (over: Partial<DomainRecord>): DomainRecord => ({
    domain: "x.gov",
    domainType: "Federal - Executive",
    org: "",
    suborg: null,
    city: null,
    state: null,
    securityContactEmail: null,
    ...over,
  });

  it("clears vote.gov → @eac.gov (same org) but still flags usadf → @ndstudio.gov (cross org)", () => {
    const vote = rec({
      domain: "vote.gov",
      org: "Election Assistance Commission",
      securityContactEmail: "security@eac.gov",
    });
    expect(contactDomainMismatch(vote, wl, orgOf)).toBeNull();

    const usadf = rec({
      domain: "usadf.gov",
      org: "United States African Development Foundation",
      securityContactEmail: "akash@ndstudio.gov",
    });
    expect(contactDomainMismatch(usadf, wl, orgOf)?.severity).toBe("high");
  });

  it("resolves a subdomain contact to its apex org (988.gov → @samhsa.hhs.gov, both HHS)", () => {
    const r988 = rec({
      domain: "988.gov",
      org: "Department of Health and Human Services",
      securityContactEmail: "soc@samhsa.hhs.gov",
    });
    expect(contactDomainMismatch(r988, wl, orgOf)).toBeNull();
  });
});

describe("§5.10.5 idempotency — re-running identical data is a no-op", () => {
  it("after → after emits zero changes and inserts zero new observations", async () => {
    const db = createDb(":memory:");
    await runLedger({ db, watchlist: wl, csvText: read("after.csv"), now: NOW });
    const c1 = obsCount(db);
    const rerun = await runLedger({ db, watchlist: wl, csvText: read("after.csv"), now: NOW });
    expect(rerun.changesEmitted).toBe(0);
    expect(rerun.shortCircuited).toBe(true);
    expect(obsCount(db)).toBe(c1);
  });
});

describe("§5.10.6 feed — high change surfaces with a working deep link", () => {
  it("the usadf high change renders into /ledger/feed.xml", async () => {
    const db = createDb(":memory:");
    await runLedger({ db, watchlist: wl, csvText: read("before.csv"), now: NOW, emitChanges: false });
    await runLedger({ db, watchlist: wl, csvText: read("after.csv"), now: NOW });

    const highRows = db.listChanges({ module: "ledger", severity: "high", limit: 50 });
    const entries = highRows.map((r) => changeToEntry(r));
    const xml = renderRss(entries, {
      title: "Daylight — Ledger changes",
      description: "Ownership + security-contact changes across the federal .gov registry.",
      siteUrl: "https://daylight.example",
      feedUrl: "https://daylight.example/ledger/feed.xml",
    });

    expect(entries.some((e) => e.domain === "usadf.gov" && e.severity === "high")).toBe(true);
    expect(xml).toContain("https://daylight.example/domain/usadf.gov");
    expect(xml).toContain("<category>high</category>");
  });
});

describe("§6.1 verify-the-header guardrail", () => {
  it("a drifted header fails loudly to /status and skips the diff", async () => {
    const db = createDb(":memory:");
    const bad = "Domain,Type,Org\nusadf.gov,Federal,Foo\n";
    const r = await runLedger({ db, watchlist: wl, csvText: bad, now: NOW });
    expect(r.ok).toBe(false);
    expect(r.headerOk).toBe(false);
    const status = db.getStatus().find((s) => s.module === "ledger");
    expect(status?.ok).toBe(0);
    expect(status?.error).toBeTruthy();
  });
});

// A steady beforeEach so a stray shared DB never leaks between cases.
beforeEach(() => {});
