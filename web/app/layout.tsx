import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";

import { Footer } from "@/components/layout/footer";
import { Header } from "@/components/layout/header";
import { TestnetBanner } from "@/components/layout/testnet-banner";
import { ThemeProvider } from "@/components/layout/theme-provider";

import "./globals.css";

const plexSans = IBM_Plex_Sans({
  subsets: ["latin", "latin-ext"], // latin-ext carries the Turkish characters in "Türkiye"
  weight: ["400", "500", "600"],
  display: "swap",
  variable: "--font-plex-sans",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
  variable: "--font-plex-mono",
});

export const metadata: Metadata = {
  title: {
    default: "HitBite hbTRS — testnet demonstration",
    template: "%s — HitBite hbTRS (testnet)",
  },
  description:
    "Testnet demonstration of hbTRS, a whitelisted token representing a simulated, custodied portfolio of Türkiye USD sovereign bonds. Base Sepolia only. Not an offer of securities.",
  applicationName: "HitBite MVP",
  robots: { index: false, follow: false }, // a testnet demo should not be indexed
  openGraph: {
    type: "website",
    siteName: "HitBite MVP (testnet)",
    title: "HitBite hbTRS — testnet demonstration",
    description: "Simulated portfolio and attestation on Base Sepolia. Not an offer of securities.",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafaf8" },
    { media: "(prefers-color-scheme: dark)", color: "#0d0f13" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // suppressHydrationWarning: next-themes writes the theme class on <html>
    // before React hydrates, so the server and client markup differ here by design.
    <html
      lang="en"
      suppressHydrationWarning
      className={`${plexSans.variable} ${plexMono.variable}`}
    >
      <body className="bg-paper text-ink flex min-h-dvh flex-col antialiased">
        <ThemeProvider>
          <a
            href="#main"
            className="skip-link bg-accent text-accent-on rounded-md px-3 py-2 text-sm"
          >
            Skip to content
          </a>
          <TestnetBanner />
          <Header />
          {/* tabIndex={-1} so the skip link actually moves focus here, not just
              the scroll position. `scroll-mt-14` clears the sticky header. */}
          <main id="main" tabIndex={-1} className="flex-1 scroll-mt-14 focus:outline-none">
            {children}
          </main>
          <Footer />
        </ThemeProvider>
      </body>
    </html>
  );
}
