// Public GitHub REST reads (existence-only): list a watched org's public repos. A read-only token
// (GITHUB_TOKEN) only raises the rate limit 60→5000/hr; public-repo reads need no scopes. We never
// authenticate past anything private — a private repo simply isn't in the public list.

const API = "https://api.github.com";

/** One repo, reduced to the fields Daylight diffs. */
export interface GithubRepo {
  id: number; // immutable — the rename-safe diff key
  name: string;
  fullName: string;
  htmlUrl: string;
  fork: boolean;
  archived: boolean;
  createdAt: string | null;
  pushedAt: string | null;
  size: number; // 0 = empty (no commits yet)
}

/** Injectable seam: fetch a watched org's public repos. Tests pass a mock; prod uses fetchOrgRepos. */
export type RepoFetcher = (org: string) => Promise<GithubRepo[]>;

export function githubToken(): string | null {
  return process.env.GITHUB_TOKEN?.trim() || null;
}

export function userAgent(): string {
  const site = (process.env.DAYLIGHT_SITE_URL?.trim() || "http://localhost:3000").replace(
    /\/+$/,
    "",
  );
  return `DaylightBot/0.4 (+${site}/methods; observational; public-data-only)`;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const backoffMs = (attempt: number): number => Math.min(1000 * 2 ** attempt, 15000);

/** The `Link` header's rel="next" URL, or null at the last page. */
function nextLink(link: string | null): string | null {
  if (!link) return null;
  for (const part of link.split(",")) {
    const m = /<([^>]+)>;\s*rel="next"/.exec(part);
    if (m?.[1]) return m[1];
  }
  return null;
}

function normalize(r: Record<string, unknown>): GithubRepo {
  return {
    id: Number(r.id),
    name: String(r.name ?? ""),
    fullName: String(r.full_name ?? ""),
    htmlUrl: String(r.html_url ?? ""),
    fork: !!r.fork,
    archived: !!r.archived,
    createdAt: (r.created_at as string | null) ?? null,
    pushedAt: (r.pushed_at as string | null) ?? null,
    size: Number(r.size) || 0,
  };
}

async function getWithBackoff(
  url: string,
  headers: Record<string, string>,
  retries: number,
  timeoutMs: number,
): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { headers, redirect: "follow", signal: AbortSignal.timeout(timeoutMs) });
      // Secondary/abuse rate limit → honour Retry-After (or back off) and retry.
      if ((res.status === 403 || res.status === 429) && attempt < retries) {
        const ra = Number(res.headers.get("retry-after"));
        await sleep(Number.isFinite(ra) && ra > 0 ? ra * 1000 : backoffMs(attempt));
        continue;
      }
      return res;
    } catch (err) {
      lastErr = err;
      if (attempt < retries) await sleep(backoffMs(attempt));
    }
  }
  if (lastErr) throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  throw new Error(`GET ${url} exhausted retries`);
}

/** List all public repos for an org (paginated, newest-created first). Bounded by maxPages so a huge
 *  umbrella org can't run away; a truncation is the caller's to log. */
export async function fetchOrgRepos(
  org: string,
  opts: { token?: string | null; ua?: string; retries?: number; timeoutMs?: number; maxPages?: number } = {},
): Promise<GithubRepo[]> {
  const token = opts.token === undefined ? githubToken() : opts.token;
  const headers: Record<string, string> = {
    "user-agent": opts.ua ?? userAgent(),
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
  };
  if (token) headers.authorization = `Bearer ${token}`;
  const retries = opts.retries ?? 3;
  const timeoutMs = opts.timeoutMs ?? 20000;
  const maxPages = opts.maxPages ?? 30;

  let url: string | null =
    `${API}/orgs/${encodeURIComponent(org)}/repos?type=public&sort=created&direction=desc&per_page=100`;
  const out: GithubRepo[] = [];
  let pages = 0;
  while (url && pages < maxPages) {
    const res = await getWithBackoff(url, headers, retries, timeoutMs);
    if (!res.ok) throw new Error(`GET ${url} → ${res.status} ${res.statusText}`);
    const arr = (await res.json()) as Record<string, unknown>[];
    for (const r of arr) out.push(normalize(r));
    url = nextLink(res.headers.get("link"));
    pages++;
  }
  return out;
}
