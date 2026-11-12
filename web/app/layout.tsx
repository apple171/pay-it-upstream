import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Nav } from "./nav";
import { REPO } from "@/lib/views";

const sans = Geist({ subsets: ["latin"], variable: "--font-geist" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });

export const metadata: Metadata = {
  title: { default: "Pay It Upstream: fund the code you run on", template: "%s · Pay It Upstream" },
  description:
    "Point it at your code repo. AI finds which open-source packages keep it alive. PayPal pays the people who maintain them, and every payment is PayPal-verified.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#08090b" },
    { media: "(prefers-color-scheme: light)", color: "#fbfbfc" },
  ],
};

// Dark by default; a saved choice wins. Runs before paint, so there's no flash.
const THEME = `try{var t=localStorage.getItem("theme");document.documentElement.dataset.theme=t==="light"?"light":"dark"}catch(e){document.documentElement.dataset.theme="dark"}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark" className={`${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME }} />
      </head>
      <body>
        <Nav />
        {children}
        <footer className="site-footer">
          <div className="container">
            <div>
              <div>Pay It Upstream · MIT licensed · payments by PayPal</div>
              <div className="faint tiny" style={{ marginTop: 6 }}>
                Package data from npm, PyPI and <a href="https://deps.dev">deps.dev</a> (CC-BY 4.0). Maintainer contacts are masked.
                Sandbox runs are demo payments to test accounts.
              </div>
            </div>
            <nav aria-label="Footer">
              <Link href="/how-it-works">How it works</Link>
              <Link href="/proof">Proof</Link>
              <Link href="/maintainers">For maintainers</Link>
              <a href={REPO}>GitHub</a>
            </nav>
          </div>
        </footer>
      </body>
    </html>
  );
}
