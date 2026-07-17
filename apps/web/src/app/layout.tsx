import type { Metadata } from "next";
import { IBM_Plex_Mono, Public_Sans } from "next/font/google";
import { headers } from "next/headers";
import Link from "next/link";
import type { ReactNode } from "react";
import "./globals.css";
import { Mark } from "@/components/mark";
import { MainNav } from "@/components/main-nav";
import { MobileNav } from "@/components/mobile-nav";
import { GlobalSearch } from "@/components/global-search";
import { ThemeToggle } from "@/components/theme-toggle";
import { SupportBanner } from "@/components/support-banner";
import { BackToTop } from "@/components/back-to-top";
import { flags } from "@/lib/flags";
import { CREDIT_LINE, FUNDING_URL, HEADER_TAGLINE, SITE_NAME, SITE_TAGLINE } from "@/lib/site";
import { absolute, metadataBase, SITE_URL } from "@/lib/seo";
import { JsonLd } from "@/components/json-ld";
import { siteGraphLd } from "@/lib/structured-data";

// Applies a saved theme choice before first paint (no flash). System pref is the default.
const NO_FLASH = `(function(){try{var t=localStorage.getItem('daylight-theme');if(t==='light'||t==='dark'){document.documentElement.setAttribute('data-theme',t);}}catch(e){}})();`;

// Public Sans — the US federal government's own typeface (USWDS). On-theme by design.
const sans = Public_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800", "900"],
  variable: "--font-sans",
  display: "swap",
});
// IBM Plex Mono — the co-voice: every machine fact (domain, contact, hash, timestamp).
const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase,
  title: { default: `${SITE_NAME} — federal .gov watch`, template: `%s · ${SITE_NAME}` },
  description: SITE_TAGLINE,
  applicationName: SITE_NAME,
  authors: [{ name: SITE_NAME, url: SITE_URL }],
  creator: SITE_NAME,
  publisher: SITE_NAME,
  manifest: "/manifest.webmanifest",
  // Phone-number autolinking mangles domain/contact strings; turn it off.
  formatDetection: { telephone: false, address: false, email: false },
  // Site-wide feed discovery only. Canonical is intentionally NOT set here — it would cascade to any
  // page that forgot to override it, silently canonicalizing everything to "/". Each page sets its own.
  alternates: {
    types: {
      "application/rss+xml": [{ url: absolute("/feed.xml"), title: `${SITE_NAME} — all changes (RSS)` }],
      "application/feed+json": [{ url: absolute("/feed.json"), title: `${SITE_NAME} — all changes (JSON Feed)` }],
    },
  },
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    locale: "en_US",
    url: SITE_URL,
    title: `${SITE_NAME} — a public watchdog for federal .gov infrastructure`,
    description: SITE_TAGLINE,
  },
  twitter: {
    card: "summary_large_image",
    title: `${SITE_NAME} — federal .gov watch`,
    description: SITE_TAGLINE,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 },
  },
  category: "technology",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  const f = flags();
  const modules = [
    ...(f.registry ? [{ href: "/registry", label: "Ledger", owns: ["/ledger", "/domain"] }] : []),
    ...(f.lookout ? [{ href: "/lookout", label: "Lookout" }] : []),
    ...(f.foundry ? [{ href: "/foundry", label: "Foundry" }] : []),
    ...(f.floodlight ? [{ href: "/floodlight", label: "Floodlight" }] : []),
    ...(f.receipts ? [{ href: "/receipts", label: "Receipts" }] : []),
    ...(f.redtape ? [{ href: "/redtape", label: "Redtape" }] : []),
    ...(f.broadside ? [{ href: "/broadside", label: "Broadside" }] : []),
  ];
  const meta = [
    { href: "/watchlist", label: "Watchlist" },
    { href: "/methods", label: "Methods" },
    { href: "/faq", label: "FAQ" },
    { href: "/privacy", label: "Privacy" },
    { href: "/status", label: "Status" },
  ];

  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <body className="min-h-screen bg-paper font-sans text-ink antialiased">
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: NO_FLASH }} />
        <JsonLd data={siteGraphLd()} />
        <a href="#main" className="skip-link">Skip to main content</a>
        <div className="mx-auto flex min-h-screen max-w-5xl flex-col px-5 sm:px-8">
          <header className="border-b border-edgeStrong">
            <div className="flex items-center justify-between gap-x-6 pb-3 pt-4">
              <Link href="/" className="group flex items-center gap-2.5">
                <Mark className="h-6 w-6 shrink-0 text-ink" />
                <span className="text-[22px] font-extrabold leading-none tracking-[-0.02em] text-ink">
                  Daylight
                </span>
                <span className="kicker hidden sm:inline">federal .gov watch</span>
              </Link>
              <div className="flex shrink-0 items-center gap-2">
                <Link
                  href="/feed.xml"
                  aria-label="Global RSS feed"
                  className="inline-flex h-7 items-center rounded-sm border border-edgeStrong px-2 font-mono text-[11px] text-muted transition-colors hover:border-ink hover:text-ink"
                >
                  RSS
                </Link>
                <ThemeToggle />
                <MobileNav items={modules} meta={meta} />
              </div>
            </div>
            {/* Inline nav on sm+; on mobile it collapses into the MobileNav hamburger above. */}
            <div className="hidden pb-3 sm:block">
              <MainNav items={modules} meta={meta} />
            </div>
            <p className="max-w-measure pb-2.5 text-[13px] leading-snug text-muted">
              {HEADER_TAGLINE}
            </p>
            <div className="hidden items-center gap-2 pb-2 font-mono text-[10px] uppercase tracking-[0.12em] text-faint sm:flex">
              <span className="inline-block h-[7px] w-[7px] shrink-0 rounded-full border border-alarm bg-alarm/60" />
              observational · public data only · every record timestamped &amp; source-linked
            </div>
            <div className="pb-3">
              <GlobalSearch variant="compact" />
            </div>
          </header>

          <main id="main" tabIndex={-1} className="flex-1 py-9 focus:outline-none">
            {children}
          </main>

          <SupportBanner />

          <footer
            aria-label="Site information"
            className="border-t border-edge py-7 text-xs leading-relaxed text-faint"
          >
            <p className="max-w-measure">
              Daylight records that things <strong className="font-semibold text-muted">exist</strong>{" "}
              and how they <strong className="font-semibold text-muted">change</strong>, using only
              already-public data. It never authenticates past an access wall, probes, or crawls.{" "}
              <Link href="/methods" className="link">
                Read the methods
              </Link>
              .
            </p>
            <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
              <Link href="/methods" className="link">Methods</Link>
              <Link href="/faq" className="link">FAQ</Link>
              <Link href="/watchlist" className="link">Watchlist</Link>
              <Link href="/corrections" className="link">Corrections</Link>
              <Link href="/changelog" className="link">Changelog</Link>
              <Link href="/privacy" className="link">Privacy</Link>
              <Link href="/feed.xml" className="link">Global feed</Link>
              <a href="https://github.com/kevstauss/daylight" className="link">Source</a>
              {FUNDING_URL ? (
                <a href={FUNDING_URL} target="_blank" rel="noopener noreferrer" className="link">
                  Support
                </a>
              ) : null}
            </p>
            <p className="mt-2.5 font-mono">{CREDIT_LINE}</p>
            <p className="mt-1.5">
              Daylight owes its start to the reporting of{" "}
              <a
                href="https://substack.com/@thedreydossier"
                target="_blank"
                rel="noopener noreferrer"
                className="link"
              >
                The Drey Dossier
              </a>
              .
            </p>
          </footer>
        </div>
        <BackToTop />
      </body>
    </html>
  );
}
