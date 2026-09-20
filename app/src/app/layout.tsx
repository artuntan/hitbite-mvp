import type { Metadata } from "next";
import { copy, repositoryUrl } from "@hitbite/config/copy";
import { Providers } from "@/components/providers";
import { Header, WalkthroughToggle } from "@/components/ui";
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
          <div className="app-shell">
            <a className="skip-link" href="#content">
              Skip to content
            </a>
            <Header />
            <div id="content">{children}</div>
            <footer>
              <p>{copy.testnetBanner}</p>
              <div>
                <WalkthroughToggle />
                <a href={repositoryUrl} target="_blank" rel="noreferrer">
                  Source ↗
                </a>
              </div>
            </footer>
          </div>
        </Providers>
      </body>
    </html>
  );
}
