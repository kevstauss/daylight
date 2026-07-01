import type { Change, DomainRecord, Observation } from "@daylight/core";
import { classifyChangeFlag, FLAG_TYPES, sha256 } from "@daylight/core";
import { beforeEach, describe, expect, it } from "vitest";
import { createDb, DaylightDb } from "./index.js";

const rec = (over: Partial<DomainRecord> = {}): DomainRecord => ({
  domain: "usadf.gov",
  domainType: "Federal - Executive",
  org: "United States African Development Foundation",
  suborg: "African Development Foundation",
  city: "Washington",
  state: "DC",
  securityContactEmail: "akash@ndstudio.gov",
  ...over,
});

let db: DaylightDb;
beforeEach(() => {
  db = createDb(":memory:");
});

describe("domains", () => {
  it("upserts and reads back, preserving first_seen while advancing last_seen", () => {
    db.upsertDomain(rec(), "2026-06-01T00:00:00.000Z");
    db.upsertDomain(rec({ securityContactEmail: "new@ndstudio.gov" }), "2026-06-02T00:00:00.000Z");
    const row = db.getDomain("usadf.gov");
    expect(row?.first_seen).toBe("2026-06-01T00:00:00.000Z");
    expect(row?.last_seen).toBe("2026-06-02T00:00:00.000Z");
    expect(row?.security_contact_email).toBe("new@ndstudio.gov");
  });

  it("searches across domain/org/suborg/contact", () => {
    db.upsertDomain(rec(), "2026-06-01T00:00:00.000Z");
    expect(db.searchDomains({ q: "ndstudio" })).toHaveLength(1); // matches contact
    expect(db.searchDomains({ org: "african" })).toHaveLength(1);
    expect(db.searchDomains({ contact: "akash" })).toHaveLength(1);
    expect(db.searchDomains({ q: "nomatch" })).toHaveLength(0);
  });
});

describe("observations idempotency", () => {
  it("skips duplicate (module,domain,content_hash)", () => {
    const obs: Observation = {
      module: "ledger",
      domain: "usadf.gov",
      observedAt: "2026-06-01T00:00:00.000Z",
      sourceUrl: "https://example/current-federal.csv",
      contentHash: sha256("payload"),
      payload: rec(),
    };
    expect(db.insertObservation(obs).inserted).toBe(true);
    expect(db.insertObservation(obs).inserted).toBe(false); // dedup
    expect(db.latestObservation("ledger", "usadf.gov")).not.toBeNull();
  });
});

describe("change flag filter — SQL predicate matches the JS classifier", () => {
  const mk = (over: Partial<Change>): Change => ({
    module: "ledger",
    domain: "x.gov",
    detectedAt: "2026-06-01T00:00:00.000Z",
    kind: "modified",
    severity: "info",
    ...over,
  });

  const samples: Change[] = [
    mk({ kind: "added", severity: "high", reason: "security contact is @ndstudio.gov, foreign to usadf.gov (US ADF)" }),
    mk({ kind: "added", severity: "high", reason: 'watched organization "Executive Office of the President" on new domain fraud.gov' }),
    mk({ kind: "added", reason: "new federal domain: soarc.gov (Department of Defense)" }),
    mk({ kind: "removed" }),
    mk({ kind: "modified", field: "securityContactEmail", oldValue: "a@x.gov", newValue: "b@x.gov" }),
    mk({ kind: "modified", field: "org", oldValue: "A", newValue: "B" }),
    mk({ kind: "modified", field: "suborg", oldValue: "A", newValue: "B" }),
    mk({ kind: "modified", field: "city", oldValue: "A", newValue: "B" }),
  ];

  it("every flag filter returns exactly the rows the classifier assigns to it", () => {
    for (const s of samples) db.insertChange(s);
    const rows = db.listChanges({ module: "ledger", limit: 1000 });
    for (const ft of FLAG_TYPES) {
      const expected = rows.filter((r) => classifyChangeFlag(r) === ft.kind).length;
      const got = db.listChanges({ module: "ledger", flag: ft.kind, limit: 1000 });
      expect(got.length, ft.kind).toBe(expected);
      expect(got.every((r) => classifyChangeFlag(r) === ft.kind), ft.kind).toBe(true);
      expect(db.countChanges({ module: "ledger", flag: ft.kind }), ft.kind).toBe(expected);
    }
    // Every row lands in exactly one bucket (partition check).
    const sum = FLAG_TYPES.reduce((n, ft) => n + db.countChanges({ module: "ledger", flag: ft.kind }), 0);
    expect(sum).toBe(rows.length);
  });
});

describe("scans / status", () => {
  it("records start + finish and returns latest per module", () => {
    const id = db.recordScanStart("ledger");
    db.recordScanFinish(id, { ok: true, itemsSeen: 1344, changesEmitted: 3 });
    const status = db.getStatus();
    expect(status).toHaveLength(1);
    expect(status[0]?.ok).toBe(1);
    expect(status[0]?.changes_emitted).toBe(3);
  });
});
