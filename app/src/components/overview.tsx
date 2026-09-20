"use client";
import Link from "next/link";
import { units, config, txUrl } from "@/lib/chain";
import { useNav, useSnapshot, Metric, Caption, Status } from "./ui";
const how = [
  ["Verify", "Your eligibility is recorded in the on-chain registry."],
  ["Subscribe", "USDC enters the vault. Tokens arrive in your wallet."],
  ["Hold", "Your balance is visible at the published NAV."],
  ["Coupons", "Claim your share when the issuer funds a distribution."],
  ["Redeem", "Burn your tokens and receive USDC from the vault."],
];
export function Overview() {
  const { data: nav, error: navError } = useNav();
  const { data: live, error: rpcError } = useSnapshot();
  const fresh = live ? live.blockTime - live.navTime < 30n * 3600n : false;
  return (
    <main className="page overview">
      <section className="overview-hero">
        <div>
          <p className="eyebrow">
            <span className="live-dot" />
            {config.chain.name.toUpperCase()} / hbTRS
          </p>
          <h1>
            Sovereign bonds.
            <br />
            An on-chain
            <br />
            <span className="hero-last">perspective.</span>
          </h1>
          <p className="hero-description">
            hbTRS models access to Türkiye&apos;s USD sovereign bonds. Subscribe
            with test USDC, hold tokens and claim funded coupons. Redeem from
            the testnet vault at the published NAV.
          </p>
          <Link className="button" href="/app">
            Open the app <span>↗</span>
          </Link>
          <Caption>
            Five steps take you from a connected wallet to a confirmed
            redemption.
          </Caption>
          <p className="caption muted">
            A working testnet reference. No real bonds or investor funds.
          </p>
        </div>
        <div className="overview-panel card">
          <div className="section-heading">
            <span className="eyebrow small">THE SIMULATED PORTFOLIO</span>
            <Status tone={live && fresh ? "good" : "neutral"}>
              {live ? (fresh ? "Live NAV" : "NAV stale") : "Connecting"}
            </Status>
          </div>
          <Metric
            label="NET ASSET VALUE / TOKEN"
            value={
              <>
                {units(live?.nav, 6, 6)}
                <span className="value-unit"> USDC</span>
              </>
            }
            detail={
              live ? (
                <>
                  {new Date(Number(live.navTime) * 1000).toLocaleString(
                    "en-GB",
                    { timeZone: "UTC" },
                  )}{" "}
                  UTC · Block {live.navBlock.toString()}
                </>
              ) : (
                "Reading the published NAV from the contract"
              )
            }
          />
          {(navError || rpcError) && (
            <p className="error">Live data is temporarily unavailable.</p>
          )}
          {nav && live && BigInt(nav.nav_units) !== live.nav && (
            <p className="notice">
              The portfolio snapshot and on-chain NAV differ. Review
              Transparency before subscribing.
            </p>
          )}
          <Caption>
            NAV is the price used by the contract when you subscribe or redeem.
          </Caption>
          <div className="composition">
            <div className="section-heading">
              <h3>Three simulated holdings.</h3>
              <span className="caption muted">Target weights</span>
            </div>
            {[
              ["2029", "TURKEY 6.0%", 40, "purple"],
              ["2034", "TURKEY 6.65%", 40, "blue"],
              ["2036", "TURKEY 7.04%", 20, "green"],
            ].map(([year, name, weight, color]) => (
              <div className="composition-row" key={year}>
                <div>
                  <span>
                    {name} <span className="muted">/ {year}</span>
                  </span>
                  <strong>{weight}%</strong>
                </div>
                <div className="bar-track">
                  <div
                    className={`bar ${color}`}
                    style={{ width: `${weight}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
          <div className="next-coupon">
            <div>
              <span className="eyebrow small">NEXT SIMULATED BOND COUPON</span>
              <strong>
                {nav
                  ? new Date(
                      nav.next_simulated_coupon_date + "T12:00:00Z",
                    ).toLocaleDateString("en-GB", {
                      day: "numeric",
                      month: "long",
                      year: "numeric",
                    })
                  : "—"}
              </strong>
            </div>
            <span className="coupon-symbol" aria-hidden="true">
              ↗
            </span>
          </div>
          <p className="caption muted">
            Model date only. On-chain coupons require a separately funded issuer
            transaction.
          </p>
          <Link href="/transparency" className="text-link">
            Inspect the holdings and signed snapshot →
          </Link>
          {nav?.publication && (
            <a
              className="caption muted"
              href={txUrl(nav.publication.transaction_hash)}
              target="_blank"
              rel="noreferrer"
            >
              Snapshot NAV publication ↗
            </a>
          )}
        </div>
      </section>
      <section className="how-section">
        <div className="section-heading">
          <h2>One flow. Every step visible.</h2>
          <span className="eyebrow small">HOW IT WORKS</span>
        </div>
        <div className="how-strip">
          {how.map(([title, description], i) => (
            <div key={title}>
              <span className="how-number mono">
                0{i + 1} <span aria-hidden="true">↗</span>
              </span>
              <h3>{title}</h3>
              <p>{description}</p>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
