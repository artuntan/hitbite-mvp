"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { copy, productionMapping } from "@hitbite/config/copy";
import {
  config,
  deployment,
  addressUrl,
  txUrl,
  short,
  units,
  type NavData,
} from "@/lib/chain";
import {
  canonical,
  verifyAttestation,
  type Attestation,
} from "@/lib/attestation";
import { useNav, useSnapshot, Caption, Icon } from "./ui";
import { NavHistory } from "./nav-history";

function money(value: string | undefined, places = 2) {
  return value === undefined
    ? "—"
    : Number(value).toLocaleString("en-US", {
        minimumFractionDigits: places,
        maximumFractionDigits: places,
      });
}
function date(value: string | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}
function Download({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <a className="record-download" href={href} download>
      {children}
      <span aria-hidden="true">↓</span>
    </a>
  );
}

export function Transparency() {
  const navQuery = useNav();
  const liveQuery = useSnapshot();
  const { data: nav, error: navError } = navQuery;
  const { data: live, error: liveError } = liveQuery;
  const attestationQuery = useQuery({
    queryKey: ["attestation"],
    queryFn: async () => {
      const r = await fetch("/data/attestation.json", { cache: "no-store" });
      if (!r.ok) throw new Error("Unavailable attestation");
      return (await r.json()) as Attestation;
    },
    refetchInterval: 60000,
  });
  const { data: attestation, error: attestationError } = attestationQuery;
  const [checking, setChecking] = useState(false);
  const [verification, setVerification] = useState<{
    fingerprint: string;
    valid: boolean;
    message: string;
  }>();
  const fingerprint = attestation
    ? canonical(attestation) + config.attestorAddress + nav?.nav_units
    : "";
  const currentVerification =
    verification?.fingerprint === fingerprint && !attestationError && !navError;
  const verified = currentVerification && verification?.valid;
  const matched = !!(nav && live && nav.nav_units === live.nav.toString());
  const changed = !!(nav && live && !matched);
  async function verify() {
    if (!attestation || !nav || !deployment || checking) return;
    setChecking(true);
    try {
      await verifyAttestation(
        attestation,
        config.attestorAddress,
        config.chain.id,
        deployment.addresses.HBToken,
        nav.nav_units,
      );
      setVerification({
        fingerprint,
        valid: true,
        message:
          "Signature verified against the configured attestor. It authenticates this simulated snapshot, not asset custody.",
      });
    } catch (e) {
      setVerification({
        fingerprint,
        valid: false,
        message:
          e instanceof Error ? e.message : "Signature verification failed.",
      });
    } finally {
      setChecking(false);
    }
  }
  const vault = live ? live.liquidity + live.reserve : undefined;
  const availableShare =
    live && vault ? Number((live.liquidity * 10000n) / vault) / 100 : 0;
  return (
    <main className="page transparency-page">
      <div className="portfolio-heading transparency-heading">
        <div>
          <span className="workspace-label">hbTRS / FUND RECORDS</span>
          <h1>Transparency</h1>
          <p>
            Portfolio data, on-chain balances and the record behind each NAV.
          </p>
        </div>
        <div className="publication-meta">
          <span className="asset-network">SIMULATED PORTFOLIO</span>
          <span>
            Published{" "}
            <time dateTime={nav?.timestamp}>{date(nav?.timestamp)}</time>
          </span>
        </div>
      </div>
      {(navError || liveError || attestationError) && (
        <div className="data-warning" role="alert">
          <div>
            <strong>Some records are unavailable.</strong>
            <span>
              {[
                navError && "Published NAV",
                liveError && "On-chain balances",
                attestationError && "Signed attestation",
              ]
                .filter(Boolean)
                .join(" · ")}
              .{" "}
              {nav || live || attestation
                ? "Any values shown are the last loaded records."
                : "Try loading the records again."}
            </span>
          </div>
          <button
            className="secondary"
            onClick={() => {
              void navQuery.refetch();
              void liveQuery.refetch();
              void attestationQuery.refetch();
            }}
          >
            Retry data
          </button>
        </div>
      )}
      {changed && (
        <div className="data-warning" role="status">
          <div>
            <strong>NAV has changed on-chain.</strong>
            <span>
              The published snapshot differs from the contract. Subscriptions
              and redemptions use the on-chain NAV.
            </span>
          </div>
        </div>
      )}
      <section
        className="portfolio-metrics transparency-metrics"
        aria-label="Fund metrics"
      >
        <div className="portfolio-metric primary-metric">
          <span>On-chain NAV / token</span>
          <strong data-testid="transparency-nav">
            {units(live?.nav, 6, 6)} <small>USDC</small>
          </strong>
          <span className="metric-state">
            {liveError || navError ? (
              "Refresh unavailable"
            ) : matched ? (
              <>
                <Icon name="check" />
                Matches published snapshot
              </>
            ) : changed ? (
              "Different from published snapshot"
            ) : (
              "Loading comparison…"
            )}
          </span>
        </div>
        <div className="portfolio-metric">
          <span>Tokens outstanding</span>
          <strong>
            {units(live?.supply, 18, 6)} <small>hbTRS</small>
          </strong>
          <span>Current supply on {config.chain.name}</span>
        </div>
        <div className="portfolio-metric">
          <span>Redemption liquidity</span>
          <strong>
            {units(live?.liquidity, 6, 6)} <small>USDC</small>
          </strong>
          <span>Vault cash less reserved coupons</span>
        </div>
      </section>
      <div className="transparency-top-grid">
        <section
          className="card terminal-card history-card"
          aria-labelledby="nav-history-title"
        >
          <div className="terminal-section-heading">
            <h2 id="nav-history-title">NAV history</h2>
            <span className="workspace-label">PUBLISHED RECORD</span>
          </div>
          {nav ? (
            <NavHistory key={nav.timestamp} history={nav.history} />
          ) : (
            <div className="data-empty" role="status">
              {navError
                ? "NAV history is unavailable."
                : "Loading published history…"}
            </div>
          )}
        </section>
        <section
          className="card terminal-card attestation-card"
          aria-labelledby="attestation-title"
        >
          <div className="terminal-section-heading">
            <h2 id="attestation-title">Signed snapshot</h2>
            <span className={`record-status${verified ? " checked" : ""}`}>
              <span />
              {checking
                ? "Checking"
                : verified
                  ? "Verified"
                  : verification && currentVerification
                    ? "Check failed"
                    : "Not checked"}
            </span>
          </div>
          <div className="record-seal" aria-hidden="true">
            <svg
              width="28"
              height="28"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z" />
              <path d={verified ? "m8 12 3 3 5-6" : "M9 10h6M9 14h4"} />
            </svg>
          </div>
          <p className="record-intro">
            Check the signature.
            <br />
            <span>Inspect the source.</span>
          </p>
          <p className="data-caption">{copy.attestationLabel}</p>
          <button
            className="verify-record"
            onClick={() => void verify()}
            disabled={
              !attestation ||
              !nav ||
              !deployment ||
              !!attestationError ||
              !!navError ||
              checking
            }
          >
            {checking ? "Verifying…" : "Verify signature"}
            <Icon name="arrow" />
          </button>
          {verification && (
            <p
              role="status"
              className={`record-verification ${!currentVerification ? "record-changed" : verification.valid ? "verification-good" : "error"}`}
            >
              {currentVerification
                ? verification.message
                : "The loaded record changed or could not refresh. Verify its signature again once data is available."}
            </p>
          )}
          <Caption>
            Your browser checks the signed payload, public key, configured
            attestor and snapshot NAV. No wallet signature is needed.
          </Caption>
          <div className="record-actions">
            <Download href="/data/attestation.json">Signed JSON</Download>
            <Download href="/data/nav.json">NAV data</Download>
          </div>
          <details className="inspect-details signature-details">
            <summary>
              Signature & source <Icon name="chevron" />
            </summary>
            <dl className="inspect-list">
              <div>
                <dt>Expected signer</dt>
                <dd className="mono break">
                  {config.attestorAddress || "Not configured"}
                </dd>
              </div>
              <div>
                <dt>Snapshot time</dt>
                <dd className="mono">
                  {String(attestation?.payload.timestamp ?? "—")}
                </dd>
              </div>
              <div>
                <dt>Publication</dt>
                <dd>
                  {nav?.publication ? (
                    <a
                      className="mono"
                      href={txUrl(nav.publication.transaction_hash)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Block {nav.publication.block_number} ↗
                    </a>
                  ) : (
                    "—"
                  )}
                </dd>
              </div>
            </dl>
            <pre aria-label="Signed attestation JSON">
              {attestation
                ? JSON.stringify(attestation, null, 2)
                : "Signed record is unavailable."}
            </pre>
          </details>
        </section>
      </div>
      <Holdings nav={nav} />
      <div className="transparency-bottom-grid">
        <section
          className="card terminal-card liquidity-card"
          aria-labelledby="liquidity-title"
        >
          <div className="terminal-section-heading">
            <h2 id="liquidity-title">Vault liquidity</h2>
            <span className="workspace-label">ON-CHAIN USDC</span>
          </div>
          <div className="vault-total">
            <span>Total vault balance</span>
            <strong>
              {units(vault, 6, 6)} <small>USDC</small>
            </strong>
          </div>
          <div className="liquidity-bar" aria-hidden="true">
            <span style={{ width: `${availableShare}%` }} />
          </div>
          <dl className="inspect-list liquidity-breakdown">
            <div>
              <dt>
                <span className="allocation-key available" />
                Available for redemption
              </dt>
              <dd>
                {units(live?.liquidity, 6, 6)} <small>USDC</small>
              </dd>
            </div>
            <div>
              <dt>
                <span className="allocation-key reserved" />
                Reserved for coupons
              </dt>
              <dd>
                {units(live?.reserve, 6, 6)} <small>USDC</small>
              </dd>
            </div>
          </dl>
          <p className="data-caption">
            {copy.vaultNotice} Simulated holdings are separate from this
            balance.
          </p>
        </section>
        <section
          className="card terminal-card contracts-card"
          aria-labelledby="contracts-title"
        >
          <div className="terminal-section-heading">
            <h2 id="contracts-title">Contracts</h2>
            <span className="workspace-label">CHAIN {config.chain.id}</span>
          </div>
          <div className="inspect-contracts">
            {deployment ? (
              Object.entries(deployment.addresses).map(([name, address]) => (
                <Contract key={name} name={name} address={address} />
              ))
            ) : (
              <p className="data-caption">
                No confirmed contracts are configured.
              </p>
            )}
          </div>
          <p className="data-caption">
            Open an address to inspect its code and transactions on the
            explorer.
          </p>
        </section>
      </div>
      <section
        className="card terminal-card methodology-card"
        aria-label="Model and operating assumptions"
      >
        <details className="inspect-details">
          <summary>
            <span>
              <strong>Valuation & methodology</strong>
              <span>Fees, model assumptions and simulated yields</span>
            </span>
            <Icon name="chevron" />
          </summary>
          <Model nav={nav} />
        </details>
        <details className="inspect-details">
          <summary>
            <span>
              <strong>From testnet to production</strong>
              <span>Who operates each part of a future issuance</span>
            </span>
            <Icon name="chevron" />
          </summary>
          <p className="data-caption">
            The production column describes the intended operating model, not an
            existing regulated issuance or partnership.
          </p>
          <div
            className="inspect-scroll"
            role="region"
            tabIndex={0}
            aria-label="Production operating model"
          >
            <table className="inspect-table production-table">
              <thead>
                <tr>
                  <th scope="col">Layer</th>
                  <th scope="col">Testnet v2</th>
                  <th scope="col">Production (first issuance)</th>
                </tr>
              </thead>
              <tbody>
                {productionMapping.map(([layer, testnet, production]) => (
                  <tr key={layer}>
                    <th scope="row">{layer}</th>
                    <td>{testnet}</td>
                    <td>{production}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </section>
      <div className="workspace-status">
        <span>
          <span className={`live-dot${liveError ? " stale" : ""}`} />
          {liveError ? "Refresh unavailable" : live ? "Synced" : "Connecting"}
          <span className="mono">{live ? `#${live.blockNumber}` : "—"}</span>
        </span>
        <span>{config.chain.name} · Test funds only</span>
      </div>
    </main>
  );
}
function Holdings({ nav }: { nav?: NavData }) {
  return (
    <section
      className="card terminal-card holdings-card"
      aria-labelledby="holdings-title"
    >
      <div className="terminal-section-heading">
        <div>
          <h2 id="holdings-title">Portfolio composition</h2>
          <p className="data-caption">
            Simulated sovereign bonds · No real bonds are held by this testnet.
          </p>
        </div>
        <span className="workspace-label">
          {nav
            ? `${String(nav.holdings.length).padStart(2, "0")} HOLDINGS`
            : "LOADING"}
        </span>
      </div>
      <div className="allocation-strip" aria-hidden="true">
        {nav?.holdings.map((h, i) => (
          <span
            key={h.id}
            className={`allocation-${i % 3}`}
            style={{ flexGrow: Number(h.weight) }}
          />
        ))}
      </div>
      <div
        className="inspect-scroll"
        role="region"
        tabIndex={0}
        aria-label="Simulated portfolio holdings"
      >
        <table className="inspect-table holdings-table">
          <thead>
            <tr>
              {[
                "Instrument",
                "Target",
                "Coupon",
                "Maturity",
                "Value / USDC",
              ].map((h) => (
                <th key={h} scope="col">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {nav?.holdings.map((h, i) => (
              <tr key={h.id}>
                <td>
                  <div className="holding-instrument">
                    <span
                      className={`holding-mark allocation-${i % 3}`}
                      aria-hidden="true"
                    />
                    <div>
                      <strong>{h.name}</strong>
                      <span className="mono">{h.id}</span>
                    </div>
                  </div>
                </td>
                <td className="mono">
                  {money(String(Number(h.weight) * 100), 0)}%
                </td>
                <td className="mono">
                  {money(String(Number(h.coupon) * 100))}%
                </td>
                <td className="mono">{h.maturity}</td>
                <td className="mono">{money(h.value, 6)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="holdings-basis">
        At publication: {money(nav?.supply, 6)} hbTRS · {date(nav?.timestamp)}
      </p>
      <div className="holdings-totals">
        <div>
          <span>Holdings value</span>
          <strong>
            {money(nav?.portfolio_value, 6)} <small>USDC</small>
          </strong>
        </div>
        <div>
          <span>Retained cash</span>
          <strong>
            {money(nav?.cash, 6)} <small>USDC</small>
          </strong>
        </div>
        <div>
          <span>Simulated net assets</span>
          <strong>
            {money(nav?.net_assets, 6)} <small>USDC</small>
          </strong>
        </div>
      </div>
      <details className="inspect-details valuation-details">
        <summary>
          Prices & valuation inputs <Icon name="chevron" />
        </summary>
        <div
          className="inspect-scroll"
          role="region"
          tabIndex={0}
          aria-label="Valuation inputs"
        >
          <table className="inspect-table">
            <thead>
              <tr>
                {[
                  "Holding",
                  "Coupon",
                  "Maturity",
                  "Scaled face",
                  "Clean / 100",
                  "Dirty / 100",
                  "Quote date",
                ].map((h) => (
                  <th scope="col" key={h}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {nav?.holdings.map((h) => (
                <tr key={h.id}>
                  <th scope="row" className="mono">
                    {h.id}
                  </th>
                  <td className="mono">
                    {money(String(Number(h.coupon) * 100))}%
                  </td>
                  <td className="mono">{h.maturity}</td>
                  <td className="mono">{money(h.scaled_face, 6)}</td>
                  <td className="mono">{money(h.clean_price, 6)}</td>
                  <td className="mono">{money(h.dirty_price, 6)}</td>
                  <td>
                    <span className="mono">{h.price_date}</span>
                    <span className="quote-source">{h.price_source}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="data-caption">
          Dirty prices include accrued interest. Scaled face adjusts the
          reference basket to the snapshot supply. Coupon rates and maturity
          dates are model assumptions.
        </p>
      </details>
    </section>
  );
}
function Model({ nav }: { nav?: NavData }) {
  return (
    <>
      <div className="model-grid">
        <dl className="inspect-list">
          <div>
            <dt>Published NAV / token</dt>
            <dd>{money(nav?.nav_per_token, 6)} USDC</dd>
          </div>
          <div>
            <dt>Snapshot supply</dt>
            <dd>{money(nav?.supply, 6)} hbTRS</dd>
          </div>
          <div>
            <dt>Simulated backing ratio</dt>
            <dd>
              {nav?.supply_backed_ratio
                ? `${money(nav.supply_backed_ratio, 4)}×`
                : "—"}
            </dd>
          </div>
        </dl>
        <dl className="inspect-list">
          <div>
            <dt>Management fee / year</dt>
            <dd>
              {nav
                ? money(String(Number(nav.fees.management_rate) * 100)) + "%"
                : "—"}
            </dd>
          </div>
          <div>
            <dt>Simulated expenses / year</dt>
            <dd>
              {nav
                ? money(String(Number(nav.fees.expense_rate) * 100)) + "%"
                : "—"}
            </dd>
          </div>
          <div>
            <dt>Accrued fees</dt>
            <dd>
              {nav
                ? money(
                    String(
                      Number(nav.fees.management_accrued) +
                        Number(nav.fees.expenses_accrued),
                    ),
                    6,
                  )
                : "—"}{" "}
              USDC
            </dd>
          </div>
        </dl>
      </div>
      <p className="data-caption">
        {nav?.model} {nav?.day_count}. Manual prices carry forward until
        revised. The simulated backing ratio is not evidence of custody or
        spendable vault cash.
      </p>
      <div className="model-yields">
        <div>
          <span>Simulated yield to maturity</span>
          <strong>
            {nav
              ? money(String(Number(nav.weighted_simulated_ytm) * 100)) + "%"
              : "—"}
          </strong>
          <p className="data-caption">Value-weighted model calculation.</p>
        </div>
        <div>
          <span>Simulated distribution yield / 30 days</span>
          <strong>
            {nav
              ? money(
                  String(Number(nav.simulated_distribution_yield_30d) * 100),
                  4,
                ) + "%"
              : "—"}
          </strong>
          <p className="data-caption">{nav?.distribution_yield_method}</p>
        </div>
      </div>
    </>
  );
}
function Contract({ name, address }: { name: string; address: string }) {
  const [copyState, setCopyState] = useState("");
  const names: Record<string, string> = {
    HBToken: "hbTRS token",
    IdentityRegistry: "Identity registry",
    USDC: "Settlement asset",
  };
  return (
    <div className="inspect-contract">
      <div>
        <span>{names[name] ?? name}</span>
        <a
          className="mono"
          title={address}
          aria-label={`${name}: ${address}. Open in explorer`}
          href={addressUrl(address)}
          target="_blank"
          rel="noreferrer"
        >
          {short(address)} ↗
        </a>
      </div>
      <button
        className="copy-address"
        aria-label={`Copy ${name} address`}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(address);
            setCopyState("Address copied");
          } catch {
            setCopyState(
              "Copy unavailable. Open the explorer to copy the address.",
            );
          }
        }}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden="true"
        >
          <rect x="8" y="8" width="12" height="12" rx="2" />
          <path d="M16 8V4H4v12h4" />
        </svg>
      </button>
      <span className="copy-feedback" role="status">
        {copyState}
      </span>
    </div>
  );
}
