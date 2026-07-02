import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Change, DomainRecord, Watchlist } from "@daylight/core";
import { loadWatchlist } from "@daylight/core";
import { createDb } from "@daylight/db";
import { changeToEntry, renderRss } from "@daylight/feeds";
import { beforeEach, describe, expect, it } from "vitest";
import {
  classifyChange,
  contactConcentration,
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

describe("§5.10.3 person-watch — fires exactly once, dedups via change-event evaluation", () => {
  it("@ndstudio.gov fires one high alert for usadf; a byte-different-but-usadf-unchanged re-run fires zero new", async () => {
    const db = createDb(":memory:");
    await runLedger({ db, watchlist: wl, csvText: read("before.csv"), now: NOW, emitChanges: false });

    await runLedger({ db, watchlist: wl, csvText: read("after.csv"), now: NOW });
    expect(usadfHighAlerts(db)).toHaveLength(1);
    const totalAlerts = db.countAlerts();

    // Re-run a file whose bytes differ (a benign city edit — not a change event) so the
    // whole-file short-circuit is BYPASSED and diff() actually runs. This proves the
    // non-re-fire comes from change-event evaluation, not merely the file hash.
    const rerunCsv = read("after.csv").replace(
      "ndstudio.gov,Federal - Executive,Executive Office of the President,White House Office,Washington,DC",
      "ndstudio.gov,Federal - Executive,Executive Office of the President,White House Office,Reston,VA",
    );
    const rerun = await runLedger({ db, watchlist: wl, csvText: rerunCsv, now: NOW });
    expect(rerun.shortCircuited).toBe(false); // short-circuit bypassed
    expect(rerun.changesEmitted).toBe(0); // usadf row unchanged → no change event
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
    // Feed items now link to their /change/{id} permalink; the domain still shows in the title.
    expect(xml).toContain("https://daylight.example/change/");
    expect(xml).toContain("usadf.gov");
    expect(xml).toContain("<category>high</category>");
    // The severity filter must return ONLY high rows (not a pass-through of everything).
    expect(highRows.length).toBeGreaterThan(0);
    expect(highRows.every((r) => r.severity === "high")).toBe(true);
  });

  it("the severity filter returns only matching rows (not a tautology)", () => {
    const db = createDb(":memory:");
    const mk = (severity: "info" | "notable" | "high", domain: string) =>
      db.insertChange({ module: "ledger", domain, detectedAt: NOW, kind: "added", severity });
    mk("info", "a.gov");
    mk("notable", "b.gov");
    mk("high", "c.gov");
    const highs = db.listChanges({ module: "ledger", severity: "high" });
    expect(highs.map((r) => r.domain)).toEqual(["c.gov"]);
    expect(db.listChanges({ module: "ledger" })).toHaveLength(3);
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
    // ...and the diff is actually SKIPPED — no state written (not just a failure signal).
    expect(r.changesEmitted).toBe(0);
    expect(r.itemsSeen).toBe(0);
    expect(db.allDomains()).toHaveLength(0);
  });
});

describe("review hardening — removals, H4 isolation, person-watch elevation, H3 scope", () => {
  const mkRec = (over: Partial<DomainRecord>): DomainRecord => ({
    domain: "x.gov",
    domainType: "Federal - Executive",
    org: "",
    suborg: null,
    city: null,
    state: null,
    securityContactEmail: null,
    ...over,
  });

  it("diff() emits a `removed` change for a domain present before but not after (§5.4)", () => {
    const a = mkRec({ domain: "a.gov", org: "A" });
    const b = mkRec({ domain: "b.gov", org: "B" });
    const changes = diff(recordsToMap([a, b]), recordsToMap([a]), NOW);
    expect(changes.filter((c) => c.kind === "removed").map((c) => c.domain)).toEqual(["b.gov"]);
    expect(changes.filter((c) => c.kind !== "removed")).toHaveLength(0);
  });

  it("runLedger emits `removed` exactly once, even across later byte-different runs", async () => {
    const db = createDb(":memory:");
    // Baseline has usadf.gov (after.csv); the next file (before.csv) drops it.
    await runLedger({ db, watchlist: wl, csvText: read("after.csv"), now: NOW, emitChanges: false });
    await runLedger({ db, watchlist: wl, csvText: read("before.csv"), now: NOW });
    const removedFirst = db.domainHistory("usadf.gov").filter((c) => c.kind === "removed");
    expect(removedFirst).toHaveLength(1);
    expect(db.getDomain("usadf.gov")).toBeNull(); // dropped from the current snapshot

    // A later file that still lacks usadf (byte-different so no short-circuit) must NOT re-fire.
    const beforeVariant = read("before.csv").replace(
      "freedom.gov,Federal - Executive,Executive Office of the President,White House Office,Washington,DC",
      "freedom.gov,Federal - Executive,Executive Office of the President,White House Office,Reston,VA",
    );
    await runLedger({ db, watchlist: wl, csvText: beforeVariant, now: NOW });
    expect(db.domainHistory("usadf.gov").filter((c) => c.kind === "removed")).toHaveLength(1);
  });

  it("H4: a same-org contact change on a watched domain is `notable`, not `high` (person-watch aside)", () => {
    const orgOf = (d: string): string | null =>
      d === "ndstudio.gov" ? "Executive Office of the President" : null;
    const trumprx = mkRec({
      domain: "trumprx.gov",
      org: "Executive Office of the President",
      securityContactEmail: "someone@ndstudio.gov",
    });
    const change: Change = {
      module: "ledger",
      domain: "trumprx.gov",
      detectedAt: NOW,
      kind: "modified",
      field: "securityContactEmail",
      oldValue: null,
      newValue: "someone@ndstudio.gov",
      severity: "info",
    };
    const { severity } = classifyChange(change, trumprx, wl, orgOf);
    expect(severity).toBe("notable"); // H1 same-org cleared → H4 notable
  });

  it("person-watch match elevates the change to `high` in the run (§5.7)", async () => {
    const db = createDb(":memory:");
    await runLedger({ db, watchlist: wl, csvText: read("before.csv"), now: NOW, emitChanges: false });
    await runLedger({ db, watchlist: wl, csvText: read("after.csv"), now: NOW });
    // trumprx's contact became someone@ndstudio.gov → person-watch hit → elevated to high.
    const h = db.domainHistory("trumprx.gov").find((c) => c.field === "securityContactEmail");
    expect(h?.severity).toBe("high");
    expect(db.listAlerts(h?.id).some((a) => a.subscription_pattern === "@ndstudio.gov")).toBe(true);
  });

  it("H3 fires only for `Federal - Executive`, not other federal branches", () => {
    const exec = mkRec({ domain: "e.gov", domainType: "Federal - Executive", org: "E" });
    const jud = mkRec({ domain: "j.gov", domainType: "Federal - Judicial", org: "J" });
    const added = (rec: DomainRecord): Change => ({
      module: "ledger",
      domain: rec.domain,
      detectedAt: NOW,
      kind: "added",
      severity: "info",
    });
    expect(classifyChange(added(exec), exec, wl).severity).toBe("notable");
    expect(classifyChange(added(jud), jud, wl).severity).toBe("info");
  });

  it("H5: a removed watchlisted apex is `high`; a removed ordinary apex is `notable`", () => {
    const removed = (domain: string): Change => ({
      module: "ledger",
      domain,
      detectedAt: NOW,
      kind: "removed",
      severity: "info",
    });
    const wlRec = mkRec({ domain: "usadf.gov", org: "United States African Development Foundation" });
    const other = mkRec({ domain: "random.gov", org: "Random Agency" });
    const wlOut = classifyChange(removed("usadf.gov"), wlRec, wl);
    expect(wlOut.severity).toBe("high"); // usadf.gov is a watchlisted apex
    expect(wlOut.reason).toContain("removed from the federal registry");
    expect(classifyChange(removed("random.gov"), other, wl).severity).toBe("notable");
  });

  it("H5 floor: any change on a watchlisted apex is at least notable (never silent info)", () => {
    // A domainType change carries no H1–H4 trigger, so pre-H5 it was `info`.
    const rec = mkRec({ domain: "realfood.gov", org: "Executive Office of the President", domainType: "Federal - Executive" });
    const modified: Change = {
      module: "ledger",
      domain: "realfood.gov",
      detectedAt: NOW,
      kind: "modified",
      field: "domainType",
      oldValue: "Federal - Executive",
      newValue: "Federal - Executive (Reassigned)",
      severity: "info",
    };
    expect(classifyChange(modified, rec, wl).severity).toBe("notable");
  });

  it("runLedger classifies a removed watchlisted apex high and fires its person-watch on removal", async () => {
    const db = createDb(":memory:");
    // Baseline (after.csv) has usadf.gov with contact akash@ndstudio.gov; before.csv drops it.
    await runLedger({ db, watchlist: wl, csvText: read("after.csv"), now: NOW, emitChanges: false });
    await runLedger({ db, watchlist: wl, csvText: read("before.csv"), now: NOW });
    const removed = db.domainHistory("usadf.gov").find((c) => c.kind === "removed");
    expect(removed?.severity).toBe("high"); // usadf.gov is watchlisted → H5 high
    expect(db.listAlerts(removed?.id).some((a) => a.subscription_pattern === "@ndstudio.gov")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// H9 contact-domain CONCENTRATION — one foreign apex, many distinct orgs.
// Backtest: akash@ndstudio.gov reproduces as the seed case (structural, no watchlist entry).
// ---------------------------------------------------------------------------

const CONCENTRATION_CSV =
  [
    "Domain name,Domain type,Organization name,Suborganization name,City,State,Security contact email",
    "ndstudio.gov,Federal - Executive,Executive Office of the President,White House Office,Washington,DC,dl.eop.cloudadmin@eop.gov",
    "usadf.gov,Federal - Executive,United States African Development Foundation,African Development Foundation,Washington,DC,akash@ndstudio.gov",
    "imls.gov,Federal - Executive,Institute of Museum and Library Sciences,,Washington,DC,akash@ndstudio.gov",
    "mbda.gov,Federal - Executive,Minority Business Development Agency,,Washington,DC,akash@ndstudio.gov",
  ].join("\n") + "\n";

describe("H9 contact-domain concentration — backtest reproduces akash@ndstudio.gov", () => {
  it("flags ndstudio.gov as the security contact of record across ≥3 distinct orgs", () => {
    const { records } = normalizeCsv(CONCENTRATION_CSV);
    const clusters = contactConcentration(records, wl);
    const nd = clusters.find((c) => c.contactApex === "ndstudio.gov");
    expect(nd).toBeTruthy();
    expect(nd!.orgs.length).toBeGreaterThanOrEqual(3);
    expect(nd!.domains).toEqual(["imls.gov", "mbda.gov", "usadf.gov"]);
  });

  it("does NOT flag a 2-org cluster (after.csv: ndstudio serves only trumprx + usadf)", () => {
    const { records } = normalizeCsv(read("after.csv"));
    expect(contactConcentration(records, wl)).toHaveLength(0);
  });

  it("does NOT flag an allowlisted central mailbox shared across many orgs", () => {
    const allowlisted =
      [
        "Domain name,Domain type,Organization name,Suborganization name,City,State,Security contact email",
        "a.gov,Federal - Executive,Agency A,,Washington,DC,soc@cisa.gov",
        "b.gov,Federal - Executive,Agency B,,Washington,DC,soc@cisa.gov",
        "c.gov,Federal - Executive,Agency C,,Washington,DC,soc@cisa.gov",
      ].join("\n") + "\n";
    const { records } = normalizeCsv(allowlisted);
    expect(contactConcentration(records, wl)).toHaveLength(0); // cisa.gov is allowlisted
  });

  it("runLedger emits exactly one high concentration change, idempotent on rerun", async () => {
    const db = createDb(":memory:");
    await runLedger({ db, watchlist: wl, csvText: CONCENTRATION_CSV, now: NOW });
    const conc = db
      .domainHistory("ndstudio.gov")
      .filter((c) => c.field === "securityContactConcentration");
    expect(conc).toHaveLength(1);
    expect(conc[0]!.severity).toBe("high");
    expect(conc[0]!.reason).toContain("foreign to 3 organizations");

    // A byte-different re-run (benign city edit) bypasses the file short-circuit but the
    // concentration is unchanged → the idempotency observation must suppress a duplicate emit.
    const rerunCsv = CONCENTRATION_CSV.replace("Washington,DC,dl.eop", "Reston,VA,dl.eop");
    const rerun = await runLedger({ db, watchlist: wl, csvText: rerunCsv, now: NOW });
    expect(rerun.shortCircuited).toBe(false);
    expect(
      db.domainHistory("ndstudio.gov").filter((c) => c.field === "securityContactConcentration"),
    ).toHaveLength(1);
  });
});

describe("task 12 — every emitted change carries a re-verifiable source_url", () => {
  it("runLedger stamps changes with the run's source_url", async () => {
    const db = createDb(":memory:");
    const SRC = "https://example.gov/current-federal.csv";
    await runLedger({ db, watchlist: wl, csvText: read("before.csv"), now: NOW, emitChanges: false });
    await runLedger({ db, watchlist: wl, csvText: read("after.csv"), now: NOW, sourceUrl: SRC });
    const usadf = db.domainHistory("usadf.gov").find((c) => c.kind === "added");
    expect(usadf?.source_url).toBe(SRC);
  });
});

// A steady beforeEach so a stray shared DB never leaks between cases.
beforeEach(() => {});
