import { Marked } from "marked";

// Drop raw HTML at the token level (our markdown never contains any), so a rendering
// surface can never become an XSS vector even if the markdown source ever widens. This
// is robust where a regex pass is not (unquoted handlers, unclosed tags, tag-splitting).
const marked = new Marked({ gfm: true });
marked.use({ renderer: { html: () => "" } });

/** Render our own repo-committed markdown (CHANGELOG.md) to HTML, HTML-stripped. */
export function renderTrustedMarkdown(md: string): string {
  const html = marked.parse(md, { async: false }) as string;
  // Belt-and-suspenders: neutralize any javascript: URL that survived in a link.
  return html.replace(/javascript:/gi, "");
}
