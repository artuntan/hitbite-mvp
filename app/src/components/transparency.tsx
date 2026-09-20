"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { copy, productionMapping } from "@hitbite/config/copy";
import { config, deployment, addressUrl, units } from "@/lib/chain";
import { verifyAttestation, type Attestation } from "@/lib/attestation";
import { useNav, useSnapshot, Metric, Caption } from "./ui";
function money(value: string | undefined) {
  return value === undefined
    ? "—"
    : Number(value).toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 6,
      });
}
export function Transparency() {
  const { data: nav, error } = useNav();
  const { data: live } = useSnapshot();
  const [verification, setVerification] = useState("");
  const [valid, setValid] = useState(false);
  const { data: attestation } = useQuery({
    queryKey: ["attestation"],
    queryFn: async () => {
      const r = await fetch("/data/attestation.json", { cache: "no-store" });
      if (!r.ok) throw new Error("Unavailable attestation");
      return (await r.json()) as Attestation;
    },
    refetchInterval: 60000,
  });
  async function verify() {
    if (!attestation || !deployment) return;
    try {
      await verifyAttestation(
        attestation,
        config.attestorAddress,
        config.chain.id,
        deployment.addresses.HBToken,
        nav?.nav_units,
      );
      setValid(true);
      setVerification(
        "Signature verified against the configured attestor. This confirms who signed this simulated snapshot, not that real bonds exist.",
      );
    } catch (e) {
      setValid(false);
      setVerification(
        e instanceof Error ? e.message : "Signature verification failed.",
      );
    }
  }
  const history = nav?.history ?? [];
  const values = history.map((h) => Number(h.nav));
  const min = Math.min(...values),
    max = Math.max(...values);
  const range = Math.max(max - min, 0.001);
  return (
    <main className="page transparency">
      <div className="page-intro">
        <p className="eyebrow">TRANSPARENCY / SIMULATED PORTFOLIO</p>
        <h1>
          Every number.
          <br />
          Open to inspection.
        </h1>
        <p className="lead">
          Follow the holdings, the NAV and the signed record behind hbTRS.
        </p>
      </div>
      {error && (
        <p className="error" role="alert">
          The NAV snapshot could not be loaded.
        </p>
      )}
      <div className="metrics-grid card">
        <Metric
          label="ON-CHAIN NAV / TOKEN"
          value={`${units(live?.nav, 6, 6)} USDC`}
          detail={live ? `Block ${live.navBlock}` : undefined}
        />
        <Metric
          label="SNAPSHOT NAV / TOKEN"
          value={`${money(nav?.nav_per_token)} USDC`}
          detail={nav ? `As of ${nav.timestamp}` : undefined}
        />
        <Metric
          label="SIMULATED BACKING RATIO"
          value={
            nav?.supply_backed_ratio
              ? `${Number(nav.supply_backed_ratio).toFixed(4)}×`
              : "—"
          }
          detail="Simulated assets / snapshot token liability"
        />
        <Metric
          label="LIVE REDEMPTION LIQUIDITY"
          value={`${units(live?.liquidity, 6, 4)} USDC`}
          detail="Actual vault cash less unpaid coupon reserves"
        />
      </div>
      <p className="caption muted">
        A simulated backing ratio is not evidence of custody. Snapshot supply:{" "}
        {money(nav?.supply)} hbTRS. Live supply: {units(live?.supply, 18, 6)}{" "}
        hbTRS.
      </p>
      {nav && live && BigInt(nav.nav_units) !== live.nav && (
        <p className="notice">
          Snapshot NAV does not currently match on-chain NAV. The contract
          executes at the on-chain value.
        </p>
      )}
      <section className="card">
        <div className="section-heading">
          <h2>Holdings</h2>
          <span className="label-tag">SIMULATED</span>
        </div>
        <p className="muted">
          No bonds are held by this testnet. Coupon and maturity dates are model
          assumptions.
        </p>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                {[
                  "Simulated holding",
                  "Target",
                  "Scaled face",
                  "Clean / 100",
                  "Dirty / 100",
                  "Value (USDC)",
                  "Quote date",
                ].map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {nav?.holdings.map((h) => (
                <tr key={h.id}>
                  <td>
                    <strong>{h.name}</strong>
                    <span className="caption muted">
                      {h.id} · Matures {h.maturity}
                    </span>
                  </td>
                  <td>{Number(h.weight) * 100}%</td>
                  <td>{money(h.scaled_face)}</td>
                  <td>{money(h.clean_price)}</td>
                  <td>{money(h.dirty_price)}</td>
                  <td>{money(h.value)}</td>
                  <td>
                    {h.price_date}
                    <span className="caption muted">
                      Manual simulated input
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Caption>
          Dirty price includes accrued bond interest. Scaled face adjusts the
          reference basket to the snapshot token supply.
        </Caption>
        <div className="detail-grid">
          <dl className="data-list">
            <div>
              <dt>Simulated holdings value</dt>
              <dd>{money(nav?.portfolio_value)} USDC</dd>
            </div>
            <div>
              <dt>Simulated retained cash</dt>
              <dd>{money(nav?.cash)} USDC</dd>
            </div>
            <div>
              <dt>Simulated net assets</dt>
              <dd>{money(nav?.net_assets)} USDC</dd>
            </div>
          </dl>
          <dl className="data-list">
            <div>
              <dt>Management fee / year</dt>
              <dd>0.75%</dd>
            </div>
            <div>
              <dt>Simulated expenses / year</dt>
              <dd>0.30%</dd>
            </div>
            <div>
              <dt>Accrued fees in snapshot</dt>
              <dd>
                {nav
                  ? money(
                      String(
                        Number(nav.fees.management_accrued) +
                          Number(nav.fees.expenses_accrued),
                      ),
                    )
                  : "—"}{" "}
                USDC
              </dd>
            </div>
          </dl>
        </div>
        <p className="caption muted">
          {nav?.model} Fees accrue on the fixed reference units using
          Actual/365. {nav?.day_count}. Manual clean prices carry forward until
          explicitly revised.
        </p>
        <div className="yield-row">
          <div>
            <span className="eyebrow small">SIMULATED YIELD TO MATURITY</span>
            <strong>
              {nav
                ? (Number(nav.weighted_simulated_ytm) * 100).toFixed(2) + "%"
                : "—"}
            </strong>
            <span className="caption muted">
              Value-weighted model calculation.
            </span>
          </div>
          <div>
            <span className="eyebrow small">
              SIMULATED DISTRIBUTION YIELD / 30 DAYS
            </span>
            <strong>
              {nav
                ? (Number(nav.simulated_distribution_yield_30d) * 100).toFixed(
                    4,
                  ) + "%"
                : "—"}
            </strong>
            <span className="caption muted">
              {nav?.distribution_yield_method}
            </span>
          </div>
        </div>
      </section>
      <div className="detail-grid">
        <section className="card">
          <div className="section-heading">
            <h2>NAV history</h2>
            <span className="caption muted">USDC / hbTRS</span>
          </div>
          {history.length > 0 ? (
            <>
              <svg
                className="nav-chart"
                viewBox="0 0 600 200"
                role="img"
                aria-label={`NAV history: ${history.map((h) => `${h.date}: ${h.nav} USDC`).join(", ")}`}
              >
                <line x1="20" y1="160" x2="580" y2="160" stroke="#d8d8d8" />
                <line
                  x1="20"
                  y1="30"
                  x2="580"
                  y2="30"
                  stroke="#d8d8d8"
                  strokeDasharray="4 4"
                />
                <polyline
                  fill="none"
                  stroke="#080808"
                  strokeWidth="2"
                  points={history
                    .map(
                      (h, i) =>
                        `${history.length === 1 ? 300 : 20 + (i / (history.length - 1)) * 560},${130 - ((Number(h.nav) - min) / range) * 90}`,
                    )
                    .join(" ")}
                />
                {history.map((h, i) => (
                  <circle
                    key={h.date}
                    cx={
                      history.length === 1
                        ? 300
                        : 20 + (i / (history.length - 1)) * 560
                    }
                    cy={130 - ((Number(h.nav) - min) / range) * 90}
                    r="5"
                    fill="#7a3dff"
                  />
                ))}
              </svg>
              <div className="section-heading caption muted">
                <span>{history[0]?.date}</span>
                <span>{history.at(-1)?.date}</span>
              </div>
              <p className="caption muted">
                {history.length === 1
                  ? "One published observation. More points appear after daily publications."
                  : "One observation per valuation date."}
              </p>
            </>
          ) : (
            <p>No published history yet.</p>
          )}
        </section>
        <section className="card">
          <h2>Cash is separate.</h2>
          <dl className="data-list">
            <div>
              <dt>Live vault cash</dt>
              <dd>
                {live ? units(live.liquidity + live.reserve, 6, 6) : "—"} USDC
              </dd>
            </div>
            <div>
              <dt>Reserved for unpaid coupons</dt>
              <dd>{units(live?.reserve, 6, 6)} USDC</dd>
            </div>
            <div>
              <dt>Available for redemptions</dt>
              <dd>{units(live?.liquidity, 6, 6)} USDC</dd>
            </div>
          </dl>
          <p className="caption muted">
            {copy.vaultNotice} The simulated portfolio value is not spendable
            vault cash.
          </p>
        </section>
      </div>
      <section className="card">
        <div className="section-heading">
          <h2>Signed attestation</h2>
          <button onClick={verify} disabled={!attestation}>
            Verify signature
          </button>
        </div>
        <p>{copy.attestationLabel}</p>
        <Caption>
          Your browser checks that the displayed JSON matches the signed message
          and the configured public signer.
        </Caption>
        <p className="caption mono break">
          Expected attestor: {config.attestorAddress || "Not configured"}
        </p>
        {verification && (
          <p role="status" className={valid ? "verification-good" : "error"}>
            {verification}
          </p>
        )}
        <details>
          <summary>View signed JSON, signature and public key</summary>
          <pre>
            {attestation
              ? JSON.stringify(attestation, null, 2)
              : "Loading signed snapshot…"}
          </pre>
        </details>
        <a className="text-link" href="/data/attestation.json" download>
          Download attestation JSON ↓
        </a>
        <p className="caption muted">
          Signatures authenticate a historical snapshot. They do not guarantee
          current supply, liquidity, asset custody or independent review.
        </p>
      </section>
      <section className="card">
        <h2>Contracts you can inspect.</h2>
        <dl className="contract-list">
          {deployment &&
            Object.entries(deployment.addresses).map(([name, address]) => (
              <div key={name}>
                <dt>{name}</dt>
                <dd>
                  <a
                    className="mono break"
                    href={addressUrl(address)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {address} ↗
                  </a>
                </dd>
              </div>
            ))}
        </dl>
      </section>
      <section className="production-section">
        <p className="eyebrow">FROM REFERENCE TO FIRST ISSUANCE</p>
        <h2>What changes in production.</h2>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Layer</th>
                <th>Testnet v2</th>
                <th>Production (first issuance)</th>
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
        <p className="caption muted">
          The production column describes the intended operating model, not an
          existing regulated issuance or partnership.
        </p>
      </section>
    </main>
  );
}
