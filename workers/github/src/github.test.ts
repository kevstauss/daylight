import { describe, it, expect } from "vitest";
import type { GithubOrgWatch } from "@daylight/core";
import { createDb, type DaylightDb } from "@daylight/db";
import { runGithubWatch } from "./run.js";
import type { GithubRepo, RepoFetcher } from "./fetch.js";

const NOW = "2026-07-16T00:00:00.000Z";
const OLD = "2026-06-01T00:00:00.000Z"; // > 14 days before NOW → "made public", not fresh

const ORGS: GithubOrgWatch[] = [
  { org: "nationaldesignstudio", apex: "ndstudio.gov", highSignal: true },
  { org: "cisagov", apex: "cisa.gov", highSignal: false },
];

function repo(id: number, over: Partial<GithubRepo> = {}): GithubRepo {
  return {
    id,
    name: `r${id}`,
    fullName: `org/r${id}`,
    htmlUrl: `https://github.com/org/r${id}`,
    fork: false,
    archived: false,
    createdAt: NOW,
    pushedAt: NOW,
    size: 10,
    ...over,
  };
}

/** A mock fetcher over a fixed org→repos map (mutate between polls to simulate change). */
function fetcher(map: Record<string, GithubRepo[]>): RepoFetcher {
  return (org) => Promise.resolve(map[org] ?? []);
}

function db(): DaylightDb {
  return createDb(":memory:");
}

function lookoutChanges(d: DaylightDb) {
  return d.listChanges({ module: "lookout", limit: 1000 });
}

describe("runGithubWatch", () => {
  it("emits a new-repo 'added' change under module='lookout', keyed to the org's apex", async () => {
    const d = db();
    const r = await runGithubWatch({
      db: d,
      orgs: ORGS,
      now: NOW,
      fetchRepos: fetcher({ nationaldesignstudio: [repo(1)], cisagov: [repo(2)] }),
    });
    expect(r.ok).toBe(true);
    expect(r.newRepos).toBe(2);
    const changes = lookoutChanges(d);
    expect(changes).toHaveLength(2);
    const nds = changes.find((c) => c.domain === "ndstudio.gov");
    expect(nds?.kind).toBe("added");
    expect(nds?.severity).toBe("high"); // high-signal org
    const cisa = changes.find((c) => c.domain === "cisa.gov");
    expect(cisa?.severity).toBe("notable"); // ordinary org, freshly created
    // The scan heartbeat is recorded as 'github', NOT 'lookout' (so it doesn't clobber Lookout's row).
    expect(d.getStatus().find((s) => s.module === "github")?.ok).toBe(1);
    expect(d.getStatus().find((s) => s.module === "lookout")).toBeUndefined();
  });

  it("never emits for a fork or an archived repo", async () => {
    const d = db();
    const r = await runGithubWatch({
      db: d,
      orgs: ORGS,
      now: NOW,
      fetchRepos: fetcher({
        nationaldesignstudio: [repo(1, { fork: true }), repo(2, { archived: true })],
        cisagov: [],
      }),
    });
    expect(r.newRepos).toBe(0);
    expect(lookoutChanges(d)).toHaveLength(0);
  });

  it("labels an old-creation repo as 'made public'; severity tracks the org, not made-public-ness", async () => {
    const d = db();
    await runGithubWatch({ db: d, orgs: ORGS, now: NOW, fetchRepos: fetcher({ nationaldesignstudio: [], cisagov: [] }) });
    const r = await runGithubWatch({
      db: d,
      orgs: ORGS,
      now: NOW,
      fetchRepos: fetcher({
        nationaldesignstudio: [repo(8, { createdAt: OLD })], // high-signal org → high
        cisagov: [repo(9, { createdAt: OLD })], // ordinary org opening/transferring a repo → notable, not high
      }),
    });
    expect(r.newRepos).toBe(2);
    const nds = lookoutChanges(d).find((c) => c.domain === "ndstudio.gov");
    expect(nds?.severity).toBe("high");
    expect(nds?.reason).toContain("first observed");
    const cisa = lookoutChanges(d).find((c) => c.domain === "cisa.gov");
    expect(cisa?.severity).toBe("notable"); // routine open-sourcing must not read as high
    expect(cisa?.reason).toContain("first observed");
  });

  it("emits a first-commit event when a known empty repo gains commits (size 0 → >0)", async () => {
    const d = db();
    // Baseline: repo exists but is empty (size 0).
    await runGithubWatch({
      db: d,
      orgs: ORGS,
      now: NOW,
      fetchRepos: fetcher({ nationaldesignstudio: [repo(1, { size: 0 })], cisagov: [] }),
    });
    expect(lookoutChanges(d)).toHaveLength(1); // the 'added' from the baseline (emit was on)
    // Next poll: it now has content.
    const r = await runGithubWatch({
      db: d,
      orgs: ORGS,
      now: NOW,
      fetchRepos: fetcher({ nationaldesignstudio: [repo(1, { size: 42 })], cisagov: [] }),
    });
    expect(r.firstCommits).toBe(1);
    const fc = lookoutChanges(d).find((c) => c.field === "firstCommit");
    expect(fc?.kind).toBe("modified");
    expect(fc?.reason).toContain("first commit");
  });

  it("is rename-safe: same repo id with a new name is not a remove+add", async () => {
    const d = db();
    await runGithubWatch({ db: d, orgs: ORGS, now: NOW, fetchRepos: fetcher({ nationaldesignstudio: [repo(1, { name: "old", fullName: "org/old" })], cisagov: [] }) });
    const before = lookoutChanges(d).length;
    const r = await runGithubWatch({
      db: d,
      orgs: ORGS,
      now: NOW,
      fetchRepos: fetcher({ nationaldesignstudio: [repo(1, { name: "renamed", fullName: "org/renamed" })], cisagov: [] }),
    });
    expect(r.newRepos).toBe(0);
    expect(lookoutChanges(d).length).toBe(before); // no spurious add
  });

  it("dedupes a repo that appears twice in one poll (pagination race) — emits once", async () => {
    const d = db();
    const r = await runGithubWatch({
      db: d,
      orgs: ORGS,
      now: NOW,
      fetchRepos: fetcher({ nationaldesignstudio: [repo(1), repo(1)], cisagov: [] }),
    });
    expect(r.newRepos).toBe(1);
    expect(lookoutChanges(d)).toHaveLength(1);
  });

  it("seed mode populates state but emits nothing", async () => {
    const d = db();
    const r = await runGithubWatch({
      db: d,
      orgs: ORGS,
      now: NOW,
      emitChanges: false,
      fetchRepos: fetcher({ nationaldesignstudio: [repo(1), repo(2)], cisagov: [repo(3)] }),
    });
    expect(r.newRepos).toBe(0);
    expect(lookoutChanges(d)).toHaveLength(0);
    expect(d.githubReposByOrg("nationaldesignstudio")).toHaveLength(2);
    // A later real poll of the SAME repos emits nothing (they're now known) — seed did its job.
    const r2 = await runGithubWatch({
      db: d,
      orgs: ORGS,
      now: NOW,
      fetchRepos: fetcher({ nationaldesignstudio: [repo(1), repo(2)], cisagov: [repo(3)] }),
    });
    expect(r2.newRepos).toBe(0);
    expect(lookoutChanges(d)).toHaveLength(0);
  });

  it("is idempotent: re-polling the same repos emits no new changes", async () => {
    const d = db();
    const map = { nationaldesignstudio: [repo(1)], cisagov: [repo(2)] };
    await runGithubWatch({ db: d, orgs: ORGS, now: NOW, fetchRepos: fetcher(map) });
    const after1 = lookoutChanges(d).length;
    const r = await runGithubWatch({ db: d, orgs: ORGS, now: NOW, fetchRepos: fetcher(map) });
    expect(r.newRepos).toBe(0);
    expect(r.firstCommits).toBe(0);
    expect(lookoutChanges(d).length).toBe(after1);
  });

  it("records a failed poll to /status without throwing", async () => {
    const d = db();
    const r = await runGithubWatch({
      db: d,
      orgs: ORGS,
      now: NOW,
      fetchRepos: () => Promise.reject(new Error("boom")),
    });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("boom");
    expect(d.getStatus().find((s) => s.module === "github")?.ok).toBe(0);
  });
});
