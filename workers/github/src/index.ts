// @daylight/github — public API (library only; the CLI lives in cli.ts).
//
// Monitors watched federal GitHub orgs (config: watchlist.yaml github_orgs) for new repos + first
// commits — a leading indicator, since code often lands before the site. Its findings surface as
// LOOKOUT events (module='lookout'), so this is a signal INSIDE Lookout, not a new module/tile; the
// package records its own 'github' /status heartbeat so a dead poller is still visible.

export { fetchOrgRepos, githubToken, userAgent } from "./fetch.js";
export type { GithubRepo, RepoFetcher } from "./fetch.js";
export { runGithubWatch, type RunGithubOptions, type RunGithubResult } from "./run.js";
