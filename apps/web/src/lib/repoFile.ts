import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

/** Walk up from cwd to find a repo-root file (works in dev + the standalone image). */
export function findRepoFile(name: string): string | null {
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    const p = resolve(dir, name);
    if (existsSync(p)) return p;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

export function readChangelog(): string | null {
  const envPath = process.env.DAYLIGHT_CHANGELOG_PATH?.trim();
  if (envPath && existsSync(envPath)) return readFileSync(envPath, "utf8");
  const p = findRepoFile("CHANGELOG.md");
  return p ? readFileSync(p, "utf8") : null;
}
