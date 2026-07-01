import { createDb, type DaylightDb } from "@daylight/db";
import { beforeEach, describe, expect, it } from "vitest";
import { domainComposite } from "./composite.js";

const NOW = "2026-07-01T00:00:00.000Z";

function seedLedger(db: DaylightDb): void {
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
});

describe("§6.1 composition — sections render for available data, empty for the rest", () => {
  it("a domain with only Ledger data composes ledger + graceful empties", () => {
    seedLedger(db);
    const c = domainComposite(db, "ndstudio.gov");
    expect(c.ledger?.org).toBe("Executive Office of the President");
    expect(c.subdomains).toEqual([]);
    expect(c.scorecards).toEqual([]);
    expect(c.snapshots).toEqual([]);
    expect(c.gaps).toEqual([]);
    expect(c.hasAnyData).toBe(true);
  });

  it("an unknown domain composes to all-empty, hasAnyData=false", () => {
    const c = domainComposite(db, "nothing-here.gov");
    expect(c.ledger).toBeNull();
    expect(c.hasAnyData).toBe(false);
  });
});

describe("§6.2 provenance — last-checked timestamps present where data exists", () => {
  it("populates lastChecked for modules that have data, null otherwise", () => {
    seedLedger(db);
    db.upsertSubdomain(
      { fqdn: "previews.ndstudio.gov", apex: "ndstudio.gov", labels: ["previews"], flagSeverity: "high" },
      NOW,
    );
    const c = domainComposite(db, "ndstudio.gov");
    expect(c.lastChecked.ledger).toBe(NOW);
    expect(c.lastChecked.lookout).toBe(NOW);
    expect(c.lastChecked.floodlight).toBeNull();
    expect(c.lastChecked.redtape).toBeNull();
  });
});

describe("§6.3 scope gate — composite never surfaces an unreviewed Redtape gap", () => {
  it("only human-reviewed + published gaps appear in the composite", () => {
    seedLedger(db);
    // an unreviewed gap for the domain
    db.insertGap({ domain: "ndstudio.gov", gapAssessment: "no_filing", queriesRun: ["q"], sourcesChecked: ["s"], createdAt: NOW });
    // a reviewed + published gap for the domain
    const publishedId = db.insertGap({ domain: "ndstudio.gov", gapAssessment: "no_filing", queriesRun: ["q2"], sourcesChecked: ["s2"], createdAt: NOW });
    db.reviewGap(publishedId, { published: true });

    const c = domainComposite(db, "ndstudio.gov");
    expect(c.gaps).toHaveLength(1);
    expect(c.gaps[0]!.id).toBe(publishedId);
    expect(c.gaps[0]!.human_reviewed).toBe(1);
    expect(c.gaps[0]!.published).toBe(1);
  });
});
