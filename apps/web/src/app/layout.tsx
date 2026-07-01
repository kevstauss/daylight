import type { Metadata } from "next";
import { IBM_Plex_Mono, Public_Sans } from "next/font/google";
import Link from "next/link";
import type { ReactNode } from "react";
import "./globals.css";
import { ThemeToggle } from "@/components/theme-toggle";
import { flags } from "@/lib/flags";
import { CREDIT_LINE, SITE_NAME, SITE_TAGLINE } from "@/lib/site";

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
  title: { default: `${SITE_NAME} — federal .gov watch`, template: `%s · ${SITE_NAME}` },
  description: SITE_TAGLINE,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  const f = flags();
  const nav = [
    ...(f.registry ? [{ href: "/registry", label: "Ledger" }] : []),
    ...(f.lookout ? [{ href: "/lookout", label: "Lookout" }] : []),
    ...(f.floodlight ? [{ href: "/floodlight", label: "Floodlight" }] : []),
    ...(f.receipts ? [{ href: "/receipts", label: "Receipts" }] : []),
    ...(f.redtape ? [{ href: "/redtape", label: "Redtape" }] : []),
    { href: "/methods", label: "Methods" },
    { href: "/status", label: "Status" },
  ];

  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <body className="min-h-screen bg-paper font-sans text-ink antialiased">
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH }} />
        <div className="mx-auto flex min-h-screen max-w-5xl flex-col px-5 sm:px-8">
          <header className="border-b border-edgeStrong">
            <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 py-4">
              <Link href="/" className="group flex items-baseline gap-3">
                <span className="text-[22px] font-extrabold leading-none tracking-[-0.02em] text-ink">
                  Daylight
                </span>
                <span className="kicker hidden sm:inline">federal .gov watch</span>
              </Link>
              <nav className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                {nav.map((n) => (
                  <Link
                    key={n.href}
                    href={n.href}
                    className="text-muted underline decoration-transparent underline-offset-[5px] transition-colors hover:text-ink hover:decoration-edgeStrong"
                  >
                    {n.label}
                  </Link>
                ))}
                <Link
                  href={f.feed ? "/ledger/feed.xml" : "/feed.xml"}
                  className="rounded-sm border border-edgeStrong px-2 py-0.5 font-mono text-[11px] text-muted transition-colors hover:border-ink hover:text-ink"
                >
                  RSS
                </Link>
                <ThemeToggle />
              </nav>
            </div>
            <div className="flex items-center gap-2 pb-2 font-mono text-[10px] uppercase tracking-[0.12em] text-faint">
              <span className="inline-block h-[7px] w-[7px] shrink-0 rounded-full border border-alarm bg-alarm/60" />
              observational · public data only · every record timestamped &amp; source-linked
            </div>
          </header>

          <main className="flex-1 py-9">{children}</main>

          <footer className="border-t border-edge py-7 text-xs leading-relaxed text-faint">
            <p className="max-w-measure">
              Daylight records that things <strong className="font-semibold text-muted">exist</strong>{" "}
              and how they <strong className="font-semibold text-muted">change</strong>, using only
              already-public data. It never authenticates past an access wall, probes, or crawls.{" "}
              <Link href="/methods" className="link">
                Read the methods
              </Link>
              .
            </p>
            <p className="mt-2.5 font-mono">{CREDIT_LINE}</p>
          </footer>
        </div>
      </body>
    </html>
  );
}
