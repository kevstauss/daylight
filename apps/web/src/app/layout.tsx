import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import "./globals.css";
import { flags } from "@/lib/flags";
import { CREDIT_LINE, SITE_NAME, SITE_TAGLINE } from "@/lib/site";

export const metadata: Metadata = {
  title: { default: `${SITE_NAME} — federal .gov watchdog`, template: `%s · ${SITE_NAME}` },
  description: SITE_TAGLINE,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  const f = flags();
  const nav = [
    ...(f.registry ? [{ href: "/registry", label: "Registry" }] : []),
    ...(f.lookout ? [{ href: "/lookout", label: "Lookout" }] : []),
    ...(f.floodlight ? [{ href: "/floodlight", label: "Floodlight" }] : []),
    ...(f.receipts ? [{ href: "/receipts", label: "Receipts" }] : []),
    { href: "/methods", label: "Methods" },
    { href: "/status", label: "Status" },
    { href: "/changelog", label: "Changelog" },
    { href: f.feed ? "/ledger/feed.xml" : "/feed.xml", label: "Feed" },
  ];
  return (
    <html lang="en">
      <body className="min-h-screen bg-paper text-ink antialiased">
        <div className="mx-auto flex min-h-screen max-w-4xl flex-col px-5">
          <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-edge py-4">
            <Link href="/" className="group flex items-baseline gap-2">
              <span className="text-lg font-semibold tracking-tight">{SITE_NAME}</span>
              <span className="hidden font-mono text-[11px] text-faint sm:inline">
                federal .gov watchdog
              </span>
            </Link>
            <nav className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-xs">
              {nav.map((n) => (
                <Link key={n.href} href={n.href} className="text-muted hover:text-ink">
                  {n.label}
                </Link>
              ))}
            </nav>
          </header>

          <main className="flex-1 py-8">{children}</main>

          <footer className="border-t border-edge py-6 text-xs text-faint">
            <p className="max-w-2xl">
              Everything here is <strong className="text-muted">observational</strong> and built on{" "}
              <strong className="text-muted">already-public data</strong>. We note that things exist
              and how they change; we never authenticate past any access wall.{" "}
              <Link href="/methods" className="text-signal underline underline-offset-2">
                Methods &amp; sources
              </Link>
              .
            </p>
            <p className="mt-2 font-mono">{CREDIT_LINE}</p>
          </footer>
        </div>
      </body>
    </html>
  );
}
