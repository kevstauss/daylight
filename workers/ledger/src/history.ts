import type { Change, DomainRecord, Watchlist, WatchSubscription } from "@daylight/core";
import { sha256, watchSubscriptions } from "@daylight/core";
import type { DaylightDb } from "@daylight/db";
import { diff } from "./diff.js";
import { resolveChange } from "./emit.js";
import { fetchCsv, userAgent } from "./fetch.js";
import type { OrgResolver } from "./heuristics.js";
import { canonicalHash, normalizeCsv, recordsToMap } from "./normalize.js";

const REPO = "cisagov/dotgov-data";
const CSV_PATH = "current-federal.csv";
const HISTORY_SENTINEL = "__ledger_history__";
// Marker written when the one-time backfill completes — makes a re-run a safe no-op.
const HISTORY_DONE_HASH = sha256("daylight:ledger-history-backfill:v1");

export interface HistoryCommit {
  sha: string;
  date: string; // ISO
}

export interface GitHubFetchOptions {
  fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>;
  token?: string;
  maxPages?: number;
}

/** List the commits that touched current-federal.csv, oldest → newest (GitHub API). */
export async function listCsvCommits(opts: GitHubFetchOptions = {}): Promise<HistoryCommit[]> {
  const f = opts.fetchImpl ?? ((url, init) => fetch(url, init));
  const token = opts.token ?? process.env.GITHUB_TOKEN?.trim();
  const out: HistoryCommit[] = [];
  const per = 100;
  for (let page = 1; page <= (opts.maxPages ?? 30); page++) {
    const url = `https://api.github.com/repos/${REPO}/commits?path=${CSV_PATH}&per_page=${per}&page=${page}`;
    const res = await f(url, {
      headers: {
        "user-agent": userAgent(),
        accept: "application/vnd.github+json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      signal: AbortSignal.timeout(20000), // no default fetch timeout — don't hang the backfill
    });
    if (!res.ok) {
      // A failed FIRST page means we can't list history at all. Returning [] here would let
      // the caller mistake an upstream error (e.g. the 60 req/hr unauthenticated rate limit)
      // for "no history" and permanently mark the one-time backfill done. Fail loudly instead.
      if (page === 1) {
        throw new Error(`GitHub commits API failed (${res.status} ${res.statusText}) — cannot list ledger history`);
      }
      break; // a later page failed after we already collected commits — stop with what we have
    }
    const arr = (await res.json()) as { sha: string; commit?: { committer?: { date?: string }; author?: { date?: string } } }[];
    if (!Array.isArray(arr) || arr.length === 0) break;
    for (const c of arr) {
      const date = c.commit?.committer?.date ?? c.commit?.author?.date;
      if (c.sha && date) out.push({ sha: c.sha, date });
    }
    if (arr.length < per) break;
  }
  // GitHub returns newest-first — reverse to replay chronologically.
  return out.reverse();
}

/** Fetch current-federal.csv as it existed at a given commit (raw, with backoff). */
export function fetchCsvAtCommit(sha: string): Promise<string> {
  return fetchCsv(`https://raw.githubusercontent.com/${REPO}/${sha}/${CSV_PATH}`);
}

export interface BackfillHistoryOptions {
  db: DaylightDb;
  watchlist: Watchlist;
  commits: HistoryCommit[]; // oldest → newest
  getCsv: (sha: string) => Promise<string>;
  subscriptions?: WatchSubscription[];
  /** Re-run even if the completion marker is present. */
  force?: boolean;
  /** Clean rebuild: clear prior ledger changes/alerts/observations/domains before replaying,
   *  so a re-run doesn't duplicate already-inserted changes. Implies force. */
  reset?: boolean;
}

export interface BackfillHistoryResult {
  ok: boolean;
  skipped: boolean;
  commitsProcessed: number;
  changesEmitted: number;
  alertsFired: number;
  error?: string;
}

/**
 * Replay the registry's git history: for each commit (oldest → newest), diff its
 * current-federal.csv against the previous commit's and emit changes DATED TO THE COMMIT.
 * This recovers years of dated ownership/contact changes we "missed" by not watching live.
 * Idempotent — a completion marker makes a re-run a no-op unless `force`.
 */
export async function backfillHistory(opts: BackfillHistoryOptions): Promise<BackfillHistoryResult> {
  const { db, watchlist, commits } = opts;
  const subs = opts.subscriptions ?? watchSubscriptions(watchlist);
  const scanId = db.recordScanStart("ledger");

  try {
    if (!opts.force && !opts.reset) {
      const marker = db.latestObservation("ledger", HISTORY_SENTINEL);
      if (marker && marker.content_hash === HISTORY_DONE_HASH) {
        db.recordScanFinish(scanId, { ok: true, itemsSeen: 0, changesEmitted: 0 });
        return { ok: true, skipped: true, commitsProcessed: 0, changesEmitted: 0, alertsFired: 0 };
      }
    }

    // Fetch + compute (async, pure): accumulate resolved changes + their watch hits.
    const prev = new Map<string, DomainRecord>();
    const pending: { change: Change; hits: WatchSubscription[] }[] = [];
    let finalRecords: DomainRecord[] = [];
    let finalSha = "";
    let commitsProcessed = 0;

    for (const commit of commits) {
      let csv: string;
      try {
        csv = await opts.getCsv(commit.sha);
      } catch {
        continue; // unreachable commit — skip rather than fail the whole backfill
      }
      // allowHistorical: accept the recognized older CISA headers so the backfill replays the
      // full 2019→now record, not just the current-schema era. Columns are positionally identical.
      const parsed = normalizeCsv(csv, { allowHistorical: true });
      // Skip header drift AND empty/zero-row revisions. A header-valid but rowless CSV
      // (a mid-edit commit, or a transient truncation) would otherwise diff as a phantom
      // mass-removal of every domain, then swallow the re-addition on the next commit
      // because prev would be empty. An empty revision is never a real registry state.
      if (!parsed.headerOk || parsed.records.length === 0) continue;
      const current = recordsToMap(parsed.records);

      // The first parsed commit is the baseline — it establishes prior state without a flood
      // of "added" events for the ~1,300 domains that predate our watching. Subsequent
      // commits emit real dated diffs.
      if (prev.size > 0) {
        const orgOf: OrgResolver = (d) => current.get(d)?.org ?? prev.get(d)?.org ?? null;
        for (const raw of diff(prev, current, commit.date)) {
          const rec = current.get(raw.domain);
          const resolved = rec
            ? resolveChange(raw, rec, watchlist, orgOf, subs)
            : { change: raw, hits: [] as WatchSubscription[] };
          pending.push(resolved);
        }
      }
      prev.clear();
      for (const [k, v] of current) prev.set(k, v);
      finalRecords = parsed.records;
      finalSha = commit.sha;
      commitsProcessed++;
    }

    // If nothing was actually replayed — empty commit list, or every revision was
    // unreachable/invalid — do NOT write the completion marker. Writing it here would
    // permanently mark the one-time backfill "done" after a transient upstream failure,
    // and only a --force run could ever recover it. Signal a retriable failure instead.
    if (commitsProcessed === 0) {
      const error =
        commits.length === 0
          ? "no commits to replay (git-history listing empty or upstream failure)"
          : "no commits processed (every revision unreachable or invalid) — not marking backfill done";
      db.recordScanFinish(scanId, { ok: false, error, itemsSeen: 0, changesEmitted: 0 });
      return { ok: false, skipped: false, commitsProcessed: 0, changesEmitted: 0, alertsFired: 0, error };
    }

    const now = commits[commits.length - 1]!.date;
    const sourceUrl = `https://raw.githubusercontent.com/${REPO}/${finalSha}/${CSV_PATH}`;
    let changesEmitted = 0;
    let alertsFired = 0;

    db.sql.transaction(() => {
      if (opts.reset) {
        // Clean rebuild — clear prior ledger-derived rows so a re-run doesn't duplicate changes.
        // Order respects the alerts→changes FK. Scans (run audit trail) are left intact.
        db.sql.prepare("DELETE FROM alerts").run();
        db.sql.prepare("DELETE FROM changes WHERE module = 'ledger'").run();
        db.sql.prepare("DELETE FROM observations WHERE module = 'ledger'").run();
        db.sql.prepare("DELETE FROM domains").run();
      }
      for (const p of pending) {
        const id = db.insertChange(p.change);
        changesEmitted++;
        for (const s of p.hits) {
          db.insertAlert({
            changeId: id,
            subscriptionPattern: s.pattern,
            channel: s.channel ?? "feed",
            target: s.target ?? null,
          });
          alertsFired++;
        }
      }
      // Leave the domains table at the latest revision, so the daily run continues from here.
      for (const rec of finalRecords) {
        db.upsertDomain(rec, now);
        db.insertObservation({
          module: "ledger",
          domain: rec.domain,
          observedAt: now,
          sourceUrl,
          contentHash: canonicalHash(rec),
          payload: rec,
        });
      }
      db.insertObservation({
        module: "ledger",
        domain: HISTORY_SENTINEL,
        observedAt: now,
        sourceUrl: "git-history",
        contentHash: HISTORY_DONE_HASH,
        payload: { commits: commitsProcessed, changes: changesEmitted },
      });
    })();

    db.recordScanFinish(scanId, { ok: true, itemsSeen: commitsProcessed, changesEmitted });
    return { ok: true, skipped: false, commitsProcessed, changesEmitted, alertsFired };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    db.recordScanFinish(scanId, { ok: false, error, itemsSeen: 0, changesEmitted: 0 });
    return { ok: false, skipped: false, commitsProcessed: 0, changesEmitted: 0, alertsFired: 0, error };
  }
}
