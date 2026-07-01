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
});
