import type { Metadata } from "next";
import { copy, repositoryUrl } from "@hitbite/config/copy";
import { Providers } from "@/components/providers";
import { Header } from "@/components/ui";
import "../globals.css";
export const metadata: Metadata = {
  title: "HitBite — Testnet",
  description: copy.testnetBanner,
  robots: { index: false, follow: true },
};
export default function PlatformLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
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
            <a href={repositoryUrl} target="_blank" rel="noreferrer">
              Source ↗
            </a>
          </div>
        </footer>
      </div>
    </Providers>
  );
}
