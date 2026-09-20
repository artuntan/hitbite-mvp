import type { Metadata } from "next";
import Link from "next/link";
import { copy, repositoryUrl } from "@hitbite/config/copy";
import { Providers } from "@/components/providers";
import { Header } from "@/components/ui";
import "@fontsource-variable/inter";
import "@fontsource-variable/inconsolata";
import "./globals.css";
export const metadata: Metadata = {
  title: "HitBite — Testnet",
  description: copy.testnetBanner,
  robots: { index: false, follow: false },
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <a className="skip-link" href="#content">
            Skip to content
          </a>
          <div className="testnet-banner">
            <span className="banner-dot" />
            {copy.testnetBanner}
          </div>
          <Header />
          <div id="content">{children}</div>
          <footer>
            <div>
              <Link className="wordmark" href="/">
                HitBite<span className="testnet-tag">TESTNET</span>
              </Link>
              <p>{copy.footer}</p>
            </div>
            <div>
              <a href={repositoryUrl} target="_blank" rel="noreferrer">
                View source on GitHub ↗
              </a>
              <Link href="/transparency">Inspect the testnet →</Link>
            </div>
          </footer>
        </Providers>
      </body>
    </html>
  );
}
