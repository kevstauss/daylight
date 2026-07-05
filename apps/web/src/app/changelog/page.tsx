import { readFileSync } from "node:fs";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { renderTrustedMarkdown } from "@/lib/markdown";
import { findRepoFile } from "@/lib/repoFile";

export const metadata: Metadata = { title: "Changelog" };
// Read the repo-committed CHANGELOG.md at request time so a redeploy surfaces new entries
// immediately (the file ships in the image via the Dockerfile `COPY . .`).
export const dynamic = "force-dynamic";

function safeRead(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

/** Renders the repo-committed CHANGELOG.md as a plain public document. The markdown is our own
 *  (trusted), and renderTrustedMarkdown drops raw HTML at the token level, so the innerHTML is safe. */
export default function ChangelogPage() {
  const path = findRepoFile("CHANGELOG.md");
  const md = path ? safeRead(path) : null;
  if (!md) notFound();
  return (
    <article className="prose-daylight" dangerouslySetInnerHTML={{ __html: renderTrustedMarkdown(md) }} />
  );
}
