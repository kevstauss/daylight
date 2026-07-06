import { ogCard, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og";

// Default branded social card. Cascades to every route that doesn't provide its own
// opengraph-image (modules, /faq, /methods, …). Twitter falls back to og:image, so no separate
// twitter-image file is needed.
export const alt = "Daylight — a public watchdog for federal .gov infrastructure";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image(): Response {
  return ogCard({
    title: "Who runs the federal web — and what quietly changes.",
    subtitle:
      "A timestamped, source-linked record of .gov ownership, certificates, trackers, and removals — built on already-public data.",
  });
}
