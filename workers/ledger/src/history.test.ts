import { fileURLToPath } from "node:url";
import type { Watchlist } from "@daylight/core";
import { loadWatchlist } from "@daylight/core";
import { createDb, type DaylightDb } from "@daylight/db";
import { beforeEach, describe, expect, it } from "vitest";
import { backfillHistory, type HistoryCommit } from "./index.js";

const wl: Watchlist = loadWatchlist(
  fileURLToPath(new URL("../../../config/watchlist.yaml", import.meta.url)),
);

const HEADER =
  "Domain name,Domain type,Organization name,Suborganization name,City,State,Security contact email";
const ND = "ndstudio.gov,Federal - Executive,Executive Office of the President,White House Office,Washington,DC,dl.eop.cloudadmin@eop.gov";
const VOTE = "vote.gov,Federal - Executive,Election Assistance Commission,,Washington,DC,security@eac.gov";
const TRUMPRX_BLANK = "trumprx.gov,Federal - Executive,Executive Office of the President,White House Office,Washington,DC,(blank)";
const TRUMPRX_ND = "trumprx.gov,Federal - Executive,Executive Office of the President,White House Office,Washington,DC,someone@ndstudio.gov";
const USADF = "usadf.gov,Federal - Executive,United States African Development Foundation,African Development Foundation,Washington,DC,akash@ndstudio.gov";

// Three historical revisions of current-federal.csv, oldest → newest.
const CSV: Record<string, string> = {
  c1: [HEADER, ND, VOTE, TRUMPRX_BLANK].join("\n") + "\n", // baseline
  c2: [HEADER, ND, VOTE, TRUMPRX_BLANK, USADF].join("\n") + "\n", // usadf appears
  c3: [HEADER, ND, VOTE, TRUMPRX_ND, USADF].join("\n") + "\n", // trumprx contact → @ndstudio.gov
};
const commits: HistoryCommit[] = [
  { sha: "c1", date: "2020-01-01T00:00:00.000Z" },
  { sha: "c2", date: "2021-06-01T00:00:00.000Z" },
  { sha: "c3", date: "2022-03-01T00:00:00.000Z" },
];
const getCsv = async (sha: string): Promise<string> => CSV[sha]!;

let db: DaylightDb;
beforeEach(() => {
  db = createDb(":memory:");
});

describe("git-history backfill — dated historical changes", () => {
  it("replays commits, emitting changes dated to each commit (baseline emits nothing)", async () => {
    const res = await backfillHistory({ db, watchlist: wl, commits, getCsv });
    expect(res.ok).toBe(true);
    expect(res.skipped).toBe(false);
    expect(res.commitsProcessed).toBe(3);
    // Only real diffs after the baseline: usadf appears (c2), trumprx contact changes (c3).
    expect(res.changesEmitted).toBe(2);

    const usadf = db.domainHistory("usadf.gov");
    expect(usadf).toHaveLength(1);
    expect(usadf[0]!.kind).toBe("added");
    expect(usadf[0]!.detected_at).toBe("2021-06-01T00:00:00.000Z"); // dated to the commit
    expect(usadf[0]!.severity).toBe("high"); // H1 contact-domain mismatch
    expect(usadf[0]!.reason).toContain("ndstudio.gov");

    const trumprx = db.domainHistory("trumprx.gov").filter((c) => c.kind === "modified");
    expect(trumprx).toHaveLength(1);
    expect(trumprx[0]!.detected_at).toBe("2022-03-01T00:00:00.000Z");
    expect(trumprx[0]!.severity).toBe("high"); // person-watch elevation
  });

  it("leaves the domains table at the latest revision + fires the person-watch (dated)", async () => {
    await backfillHistory({ db, watchlist: wl, commits, getCsv });
    expect(db.getDomain("usadf.gov")).not.toBeNull();
    expect(db.getDomain("trumprx.gov")?.security_contact_email).toBe("someone@ndstudio.gov");
    // @ndstudio.gov person-watch fired for usadf (c2) and trumprx (c3).
    expect(db.countAlerts()).toBe(2);
  });

  it("is idempotent — a re-run is a no-op unless forced", async () => {
    await backfillHistory({ db, watchlist: wl, commits, getCsv });
    const rerun = await backfillHistory({ db, watchlist: wl, commits, getCsv });
    expect(rerun.skipped).toBe(true);
    expect(rerun.changesEmitted).toBe(0);
    // still exactly one usadf change (no duplication)
    expect(db.domainHistory("usadf.gov")).toHaveLength(1);

    const forced = await backfillHistory({ db, watchlist: wl, commits, getCsv, force: true });
    expect(forced.skipped).toBe(false);
    expect(forced.changesEmitted).toBe(2);
  });

  it("--reset rebuilds cleanly without duplicating already-inserted changes", async () => {
    await backfillHistory({ db, watchlist: wl, commits, getCsv });
    expect(db.domainHistory("usadf.gov")).toHaveLength(1);

    const rebuilt = await backfillHistory({ db, watchlist: wl, commits, getCsv, reset: true });
    expect(rebuilt.skipped).toBe(false);
    expect(rebuilt.changesEmitted).toBe(2);
    // Prior changes were cleared first, so history is not duplicated.
    expect(db.domainHistory("usadf.gov")).toHaveLength(1);
    expect(db.listChanges({ module: "ledger" })).toHaveLength(2);
  });
});

describe("git-history backfill — replays across CISA's changing header schemas", () => {
  // The same domains carried through three header eras. Only the real contact change (in the
  // current-header commit) should emit; the format transitions must NOT fake a diff.
  const H19 = "Domain Name,Domain Type,Agency,Organization,City,State,Security Contact Email,,,";
  const HMID = "Domain name,Domain type,Agency,Organization name,City,State,Security contact email";
  const gsa = (email: string, hdr: "old" | "now"): string =>
    hdr === "old"
      ? `gsa.gov,Federal - Executive,General Services Administration,Technology Transformation Services,Washington,DC,${email},,,`
      : `gsa.gov,Federal - Executive,General Services Administration,Technology Transformation Services,Washington,DC,${email}`;

  const eras: Record<string, string> = {
    e2019: [H19, gsa("security@gsa.gov", "old")].join("\n") + "\n", // 2019 schema — baseline
    e2022: [HMID, gsa("security@gsa.gov", "old")].join("\n") + "\n", // mid schema, same data
    e2026: [HEADER, gsa("newsec@gsa.gov", "now")].join("\n") + "\n", // current schema, contact change
  };
  const eraCommits: HistoryCommit[] = [
    { sha: "e2019", date: "2019-06-01T00:00:00.000Z" },
    { sha: "e2022", date: "2022-06-01T00:00:00.000Z" },
    { sha: "e2026", date: "2026-06-01T00:00:00.000Z" },
  ];

  it("recovers a change dated to the current-schema commit and fakes none at schema transitions", async () => {
    const res = await backfillHistory({
      db,
      watchlist: wl,
      commits: eraCommits,
      getCsv: async (s) => eras[s]!,
    });
    expect(res.ok).toBe(true);
    expect(res.commitsProcessed).toBe(3); // all three eras parsed, none skipped as "drift"
    // Exactly one change: the 2022→2026 contact change. NO phantom diff at the 2019→2022 rename.
    const changes = db.domainHistory("gsa.gov");
    expect(changes).toHaveLength(1);
    expect(changes[0]!.kind).toBe("modified");
    expect(changes[0]!.detected_at).toBe("2026-06-01T00:00:00.000Z");
    // The 2019 row parsed positionally: Agency → org, Organization → suborg.
    expect(db.getDomain("gsa.gov")?.org).toBe("General Services Administration");
    expect(db.getDomain("gsa.gov")?.security_contact_email).toBe("newsec@gsa.gov");
  });
});

describe("git-history backfill — failure paths never poison the one-time marker", () => {
  it("an empty commit list returns ok:false, writes NO completion marker, and stays retriable", async () => {
    const res = await backfillHistory({ db, watchlist: wl, commits: [], getCsv });
    expect(res.ok).toBe(false);
    expect(res.skipped).toBe(false);
    expect(res.commitsProcessed).toBe(0);
    // The marker is absent, so a later run with real commits actually performs the backfill.
    const real = await backfillHistory({ db, watchlist: wl, commits, getCsv });
    expect(real.skipped).toBe(false);
    expect(real.commitsProcessed).toBe(3);
    expect(real.changesEmitted).toBe(2);
  });

  it("every revision unreachable → ok:false, no marker, no phantom changes, still retriable", async () => {
    const failCsv = async (): Promise<string> => {
      throw new Error("network down");
    };
    const res = await backfillHistory({ db, watchlist: wl, commits, getCsv: failCsv });
    expect(res.ok).toBe(false);
    expect(res.commitsProcessed).toBe(0);
    expect(db.listChanges({ module: "ledger" })).toHaveLength(0);
    const real = await backfillHistory({ db, watchlist: wl, commits, getCsv });
    expect(real.commitsProcessed).toBe(3);
  });

  it("a header-only (zero-row) revision does not wipe the baseline or emit phantom removals", async () => {
    const withEmpty: Record<string, string> = { c1: CSV.c1!, cE: HEADER + "\n", c3: CSV.c3! };
    const cs: HistoryCommit[] = [
      { sha: "c1", date: "2020-01-01T00:00:00.000Z" },
      { sha: "cE", date: "2020-06-01T00:00:00.000Z" }, // truncated/mid-edit revision
      { sha: "c3", date: "2022-03-01T00:00:00.000Z" },
    ];
    await backfillHistory({ db, watchlist: wl, commits: cs, getCsv: async (s) => withEmpty[s]! });
    // The empty revision removed nothing…
    expect(db.listChanges({ module: "ledger" }).filter((c) => c.kind === "removed")).toHaveLength(0);
    // …and the baseline survived, so c3's real change is still detected against c1.
    expect(db.getDomain("vote.gov")).not.toBeNull();
    expect(db.getDomain("trumprx.gov")?.security_contact_email).toBe("someone@ndstudio.gov");
  });
});
