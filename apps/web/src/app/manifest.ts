import type { MetadataRoute } from "next";
import { SITE_NAME, SITE_TAGLINE } from "@/lib/site";

// Dynamic for parity with robots/sitemap: keeps any future origin-derived field correct at runtime
// rather than baking the build-time env (DAYLIGHT_SITE_URL is a Fly runtime env).
export const dynamic = "force-dynamic";

// A minimal web app manifest. Daylight isn't a PWA (display: browser), so this mostly supplies a
// name + theme color for "add to home screen" and richer link unfurls. Colors match the Mark's
// darkroom chrome (#14181d) — the same palette as icon.svg.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${SITE_NAME} — federal .gov watch`,
    short_name: SITE_NAME,
    description: SITE_TAGLINE,
    start_url: "/",
    display: "browser",
    background_color: "#14181d",
    theme_color: "#14181d",
    icons: [{ src: "/icon.svg", type: "image/svg+xml", sizes: "any" }],
  };
}
