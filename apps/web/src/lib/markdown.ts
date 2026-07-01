import { marked } from "marked";

/**
 * Render our own repo-committed markdown (CHANGELOG.md, methods copy) to HTML.
 * The input is trusted (only maintainers can commit it), but we still strip the
 * dangerous constructs as defense-in-depth so a rendering surface never becomes an
 * XSS vector even if the source of the markdown ever widens.
 */
export function renderTrustedMarkdown(md: string): string {
  const html = marked.parse(md, { async: false, gfm: true }) as string;
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, "")
    .replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, "")
    .replace(/\son[a-z]+\s*=\s*'[^']*'/gi, "")
    .replace(/javascript:/gi, "");
}
