import type { MetadataRoute } from "next";
import { absolute, SITE_URL } from "@/lib/seo";

// Dynamic so the Sitemap/Host URLs derive from the runtime origin (DAYLIGHT_SITE_URL is a Fly
// *runtime* env — unset at build time, so a static robots.txt would bake in the localhost fallback).
export const dynamic = "force-dynamic";

// Daylight's whole thesis is public, machine-readable accountability — so it *welcomes* crawling and
// citation. We name the major AI crawlers explicitly (a positive allow signal, not the more common
// block list) so search engines AND AI assistants can index and cite the record. The one exception
// is /review — the internal, token-gated human-approval queue (also noindex at the page level).
const AI_CRAWLERS = [
  // OpenAI
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  // Anthropic
  "ClaudeBot",
  "Claude-User",
  "Claude-SearchBot",
  "anthropic-ai",
  // Perplexity
  "PerplexityBot",
  "Perplexity-User",
  // Google (Gemini/Vertex training token — distinct from Googlebot, which is covered by "*")
  "Google-Extended",
  // Apple, Amazon, Meta, Common Crawl, Cohere
  "Applebot-Extended",
  "Amazonbot",
  "meta-externalagent",
  "CCBot",
  "cohere-ai",
];

const DISALLOW = ["/review"];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: "*", allow: "/", disallow: DISALLOW },
      ...AI_CRAWLERS.map((userAgent) => ({ userAgent, allow: "/", disallow: DISALLOW })),
    ],
    sitemap: absolute("/sitemap.xml"),
    host: SITE_URL,
  };
}
