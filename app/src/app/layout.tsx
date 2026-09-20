import type { Metadata } from "next";
import { copy, repositoryUrl } from "@hitbite/config/copy";
import "./globals.css";

export const metadata: Metadata = {
  title: "HitBite — Testnet",
  description: copy.testnetBanner,
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <div className="testnet-banner">{copy.testnetBanner}</div>
        <header className="shell-header"><span>HitBite</span></header>
        {children}
        <footer>
          <p>{copy.footer}</p>
          <a href={repositoryUrl}>GitHub repository</a>
        </footer>
      </body>
    </html>
  );
}
