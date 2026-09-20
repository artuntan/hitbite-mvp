import type { Metadata } from "next";
/* Native links avoid loading the platform until the visitor opens it. */
/* eslint-disable @next/next/no-html-link-for-pages */
import { landingFont, landingMono } from "@/lib/landing-font";
import { repositoryUrl } from "@hitbite/config/copy";
import { LandingNav } from "@/components/landing-nav";
import { accessEmail, accessUrl, appLive, landingCopy } from "@/lib/site";
import styles from "./landing.module.css";

export const metadata: Metadata = {
  title: `HitBite — ${landingCopy.headline.slice(0, -1)}`,
  description: landingCopy.description,
  alternates: { canonical: "/" },
  robots: { index: true, follow: true },
  openGraph: {
    title: `HitBite — ${landingCopy.headline.slice(0, -1)}`,
    description: landingCopy.description,
    siteName: "HitBite",
    type: "website",
    url: "/",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    site: "@hitbiterwa",
    title: `HitBite — ${landingCopy.headline.slice(0, -1)}`,
    description: landingCopy.description,
  },
};
export default function LandingPage() {
  return (
    <div
      className={`${styles.landing} ${landingFont.variable} ${landingMono.variable}`}
    >
      <header className={styles.header}>
        <a
          href="/"
          className={styles.wordmark}
          aria-label="HitBite"
          draggable={false}
        >
          {/* A 2× display-size derivative; the original brand asset is preserved. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/brand/hitbite-280.avif"
            alt="HitBite"
            width={512}
            height={151}
            draggable={false}
            fetchPriority="high"
          />
        </a>
        <nav aria-label="Main navigation">
          <a className={styles.github} href={repositoryUrl}>
            GitHub
          </a>
          {appLive && (
            <a href="/app" className={styles.headerAction}>
              Open the testnet
            </a>
          )}
        </nav>
      </header>
      <main className={styles.main}>
        <h1 className={styles.headline}>{landingCopy.headline}</h1>
        <p className={styles.description}>{landingCopy.paragraph}</p>
        <div className={styles.actions}>
          {appLive ? (
            <a href="/app" className={styles.primary}>
              Open the testnet
            </a>
          ) : (
            <a href={accessUrl} className={styles.primary}>
              Request access
            </a>
          )}
          <div className={styles.quietLinks}>
            <a href={repositoryUrl}>Read the code</a>
            <span aria-hidden="true">·</span>
            <a href={accessUrl}>Request access</a>
          </div>
        </div>
        <div className={styles.liveSlot}>{appLive && <LandingNav />}</div>
      </main>
      <footer className={styles.footer}>
        <p>{landingCopy.disclaimer}</p>
        <div>
          <span>© 2026 HitBite</span>
          <span aria-hidden="true">·</span>
          <a href="https://x.com/hitbiterwa">X</a>
          <span aria-hidden="true">·</span>
          <a href={`mailto:${accessEmail}`}>{accessEmail}</a>
        </div>
      </footer>
    </div>
  );
}
