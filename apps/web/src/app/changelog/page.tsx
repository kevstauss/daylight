import type { Metadata } from "next";
import { renderTrustedMarkdown } from "@/lib/markdown";
import { readChangelog } from "@/lib/repoFile";
import { EmptyState } from "@/components/ui";

export const metadata: Metadata = { title: "Changelog" };
export const dynamic = "force-dynamic";

export default function ChangelogPage() {
  const md = readChangelog();
  // CHANGELOG.md is our own trusted content, rendered + sanitized server-side.
  const html = md ? renderTrustedMarkdown(md) : null;

  return (
    <div className="max-w-2xl">
      <h1 className="mb-2 text-2xl font-semibold tracking-tight">Changelog</h1>
      <p className="mb-6 text-sm text-muted">
        What Daylight can do, and when each piece went live — in plain language.
      </p>
      {html ? (
        <div className="prose-daylight" dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <EmptyState title="Changelog not found." hint="CHANGELOG.md could not be located." />
      )}
    </div>
  );
}
