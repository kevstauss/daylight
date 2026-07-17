import type { GithubOrgWatch } from "@daylight/core";
import { nowIso } from "@daylight/core";
import type { DaylightDb, GithubRepoRow } from "@daylight/db";
import { fetchOrgRepos, type GithubRepo, type RepoFetcher } from "./fetch.js";

export interface RunGithubOptions {
  db: DaylightDb;
  orgs: GithubOrgWatch[];
  /** Injectable fetch (tests pass a mock). Defaults to the real paginated GitHub read. */
  fetchRepos?: RepoFetcher;
  token?: string | null;
  now?: string;
  /** Set false to seed a silent baseline: populate github_repos WITHOUT emitting changes. */
  emitChanges?: boolean;
}

export interface RunGithubResult {
  ok: boolean;
  error?: string;
  orgsPolled: number;
  reposSeen: number;
  newRepos: number;
  firstCommits: number;
  /** True when this run only established the baseline (first-ever run) and emitted nothing. */
  seededBaseline: boolean;
}

// A newly-seen repo whose creation is well before now was almost certainly made public (or
// transferred in), not just created — a distinct, higher-signal event. The window keeps a freshly
// created repo that we simply polled a bit late from being mislabeled.
const MADE_PUBLIC_AFTER_DAYS = 14;

function looksMadePublic(createdAt: string | null, now: string): boolean {
  if (!createdAt) return false;
  const created = Date.parse(createdAt);
  const nowMs = Date.parse(now);
  if (!Number.isFinite(created) || !Number.isFinite(nowMs)) return false;
  return nowMs - created > MADE_PUBLIC_AFTER_DAYS * 86_400_000;
}

/**
 * One GitHub-org monitoring pass: poll each watched federal org's public repos, diff against prior
 * state (a snapshot loaded before writes), and emit Lookout events (module='lookout') for a new repo
 * or a first commit. Keyed on GitHub's immutable repo id so a rename is never a false add. Forks and
 * archived repos never emit. Removals are deliberately NOT emitted (a missing repo can be a transient
 * API/pagination miss). Existence-only, public data. Records a 'github' /status heartbeat.
 */
export async function runGithubWatch(opts: RunGithubOptions): Promise<RunGithubResult> {
  const { db, orgs } = opts;
  const now = opts.now ?? nowIso();
  const emit = opts.emitChanges !== false;
  const fetchRepos: RepoFetcher = opts.fetchRepos ?? ((org) => fetchOrgRepos(org, { token: opts.token }));
  // Seed-safety invariant: only emit once a prior SUCCESSFUL github scan exists. The first-ever run
  // (empty table, no baseline) just records what's there and emits nothing — so an empty prior state
  // can never dump every existing repo as 'added', even if a boot-seed failed or raced the cron.
  const emitting = emit && db.hasSuccessfulScan("github");
  const seededBaseline = emit && !emitting; // asked to emit, but this is the first run → baseline only
  const scanId = db.recordScanStart("github");

  try {
    // Fetch all orgs first (async, network) — the DB transaction below must stay synchronous.
    const fetched: { cfg: GithubOrgWatch; repos: GithubRepo[] }[] = [];
    let reposSeen = 0;
    for (const cfg of orgs) {
      const repos = await fetchRepos(cfg.org);
      reposSeen += repos.length;
      fetched.push({ cfg, repos });
    }

    const out = db.sql.transaction((): { newRepos: number; firstCommits: number } => {
      const prior = new Map<number, GithubRepoRow>();
      for (const row of db.allGithubRepos()) prior.set(row.repo_id, row);

      // Guard against the same repo appearing on two pages: sort=created pagination can return a
      // repo twice if one is created mid-fetch. Without this the duplicate reads as prior-unknown
      // and double-emits (insertChange has no idempotency key of its own).
      const seen = new Set<number>();
      let newRepos = 0;
      let firstCommits = 0;
      for (const { cfg, repos } of fetched) {
        const domain = cfg.apex ?? cfg.org;
        for (const repo of repos) {
          if (seen.has(repo.id)) continue;
          seen.add(repo.id);
          const hasCommits = repo.size > 0;
          const p = prior.get(repo.id);

          if (emitting && !repo.fork && !repo.archived) {
            if (!p) {
              // Severity tracks how newsworthy the ORG is, not made-public-vs-fresh: ordinary orgs
              // (GSA/cisagov/uswds) open-source and transfer repos as routine business, so those must
              // not all read as `high`. The made-public distinction lives in the reason text.
              const madePublic = looksMadePublic(repo.createdAt, now);
              const created = repo.createdAt ? ` (created ${repo.createdAt.slice(0, 10)})` : "";
              db.insertChange({
                module: "lookout",
                domain,
                detectedAt: now,
                kind: "added",
                severity: cfg.highSignal ? "high" : "notable",
                reason: madePublic
                  ? `public repo ${repo.fullName} first observed${created} — federal org ${cfg.org}`
                  : `new repo ${repo.fullName} under federal org ${cfg.org}${created}`,
                sourceUrl: repo.htmlUrl,
              });
              newRepos++;
            } else if (!p.has_commits && hasCommits) {
              db.insertChange({
                module: "lookout",
                domain,
                detectedAt: now,
                kind: "modified",
                field: "firstCommit",
                severity: cfg.highSignal ? "notable" : "info",
                reason: `first commit(s) landed on ${repo.fullName} (federal org ${cfg.org})`,
                sourceUrl: repo.htmlUrl,
              });
              firstCommits++;
            }
          }

          db.upsertGithubRepo(
            {
              repoId: repo.id,
              org: cfg.org,
              name: repo.name,
              fullName: repo.fullName,
              htmlUrl: repo.htmlUrl,
              isFork: repo.fork,
              createdAt: repo.createdAt,
              pushedAt: repo.pushedAt,
              hasCommits,
            },
            now,
          );
        }
      }
      return { newRepos, firstCommits };
    })();

    db.recordScanFinish(scanId, {
      ok: true,
      itemsSeen: reposSeen,
      changesEmitted: out.newRepos + out.firstCommits,
    });
    return { ok: true, orgsPolled: orgs.length, reposSeen, seededBaseline, ...out };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    db.recordScanFinish(scanId, { ok: false, error, itemsSeen: 0, changesEmitted: 0 });
    return { ok: false, error, orgsPolled: orgs.length, reposSeen: 0, newRepos: 0, firstCommits: 0, seededBaseline: false };
  }
}
