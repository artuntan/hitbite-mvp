"use client";
import { useState } from "react";
import { useAccount } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { erc20Abi, isAddress, type Address } from "viem";
import { hBTokenAbi, identityRegistryAbi } from "@hitbite/config/abi";
import countries from "@hitbite/config/countries";
import {
  amount,
  client,
  config,
  deployment,
  units,
  addressUrl,
  type Snapshot,
} from "@/lib/chain";
import { Action } from "./action";
import { Activity } from "./activity";
import { useSnapshot, WalletButton, Status, Metric } from "./ui";

function RegistryTable() {
  const [pages, setPages] = useState(1);
  const { data, error } = useQuery({
    queryKey: ["registry", pages],
    queryFn: async () => {
      const d = deployment!;
      const latest = await client.getBlockNumber();
      const first = BigInt(d.blockNumber);
      const addresses = new Set<Address>();
      let from = latest;
      for (let i = 0; i < pages; i++) {
        const to = latest - BigInt(i * 2000);
        if (to < first) break;
        from = to - 1999n > first ? to - 1999n : first;
        const events = await client.getContractEvents({
          address: d.addresses.IdentityRegistry,
          abi: identityRegistryAbi,
          eventName: "Verified",
          fromBlock: from,
          toBlock: to,
        });
        for (const event of events)
          if (event.args.account) addresses.add(event.args.account);
      }
      const rows = await Promise.all(
        [...addresses].map(async (address) => {
          const base = {
            address: d.addresses.IdentityRegistry,
            abi: identityRegistryAbi,
          } as const;
          const [verified, country] = await Promise.all([
            client.readContract({
              ...base,
              functionName: "isVerified",
              args: [address],
            }),
            client.readContract({
              ...base,
              functionName: "countryOf",
              args: [address],
            }),
          ]);
          return { address, verified, country };
        }),
      );
      return { rows, more: from > first };
    },
    refetchInterval: 15000,
  });
  return (
    <section className="card">
      <h2>Registry</h2>
      <p className="caption muted">
        Current status of wallets with verification events in the loaded blocks.
      </p>
      {error ? (
        <p className="error">Registry events are unavailable.</p>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Wallet</th>
                <th>Country</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {data?.rows.map((row) => (
                <tr key={row.address}>
                  <td>
                    <a
                      className="mono"
                      href={addressUrl(row.address)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {row.address}
                    </a>
                  </td>
                  <td>
                    {countries.countries.find((c) => c.numeric === row.country)
                      ?.name || row.country}
                  </td>
                  <td>{row.verified ? "Verified" : "Revoked / blocked"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!data?.rows.length && (
        <p className="muted">No verification events in the loaded blocks.</p>
      )}
      {data?.more && (
        <button className="secondary" onClick={() => setPages((p) => p + 1)}>
          Load older registry events
        </button>
      )}
    </section>
  );
}
export function Admin() {
  const { address, chainId } = useAccount();
  const { data, error } = useSnapshot();
  const authorized =
    data &&
    (data.issuer || data.oracle || data.registrar) &&
    chainId === config.chain.id;
  return (
    <main className="page admin">
      <div className="page-intro compact">
        <div>
          <p className="eyebrow">ADMIN / ROLE-RESTRICTED</p>
          <h1>Operate the testnet.</h1>
          <p className="lead">
            Every control is enforced by the contract&apos;s on-chain roles.
          </p>
        </div>
        <WalletButton />
      </div>
      {error && (
        <p className="error">
          Role information is unavailable. Controls remain locked.
        </p>
      )}
      {!authorized ? (
        <section className="card">
          <h2>
            {address
              ? "This wallet has no available operator role."
              : "Connect an operator wallet."}
          </h2>
          <p className="muted">
            ISSUER controls funding, coupons and pause. ORACLE publishes NAV.
            REGISTRAR manages eligibility.
          </p>
          {address && chainId !== config.chain.id && <WalletButton />}
        </section>
      ) : (
        <>
          <div className="metrics-grid card">
            <Metric
              label="AVAILABLE LIQUIDITY"
              value={`${units(data.liquidity, 6, 4)} USDC`}
            />
            <Metric
              label="COUPON RESERVE"
              value={`${units(data.reserve, 6, 6)} USDC`}
            />
            <Metric
              label="ON-CHAIN NAV"
              value={`${units(data.nav, 6, 6)} USDC`}
            />
            <Metric
              label="TOKEN STATE"
              value={
                <Status tone={data.paused ? "pending" : "good"}>
                  {data.paused ? "Paused" : "Active"}
                </Status>
              }
              detail={[
                data.issuer ? "ISSUER" : "",
                data.oracle ? "ORACLE" : "",
                data.registrar ? "REGISTRAR" : "",
              ]
                .filter(Boolean)
                .join(" · ")}
            />
          </div>
          {(data.issuer || data.oracle) && <TokenControls data={data} />}{" "}
          {data.registrar && (
            <>
              <RegistryControls />
              <RegistryTable />
            </>
          )}
          <Activity />
        </>
      )}
    </main>
  );
}
function TokenControls({ data }: { data: Snapshot }) {
  const [nav, setNav] = useState("");
  const [force, setForce] = useState(false);
  const [coupon, setCoupon] = useState("0.2");
  const [fund, setFund] = useState("1");
  const target = amount(nav),
    distribution = amount(coupon),
    funding = amount(fund);
  const d = deployment!;
  const navMove = target
    ? (target > data.nav ? target - data.nav : data.nav - target) * 10000n >
      data.nav * 500n
    : false;
  return (
    <div className="admin-grid">
      <section className="card">
        <h2>Publish NAV</h2>
        <label>
          USDC per token
          <input
            aria-label="New NAV"
            inputMode="decimal"
            value={nav}
            onChange={(e) => setNav(e.target.value)}
            placeholder={units(data.nav, 6, 6)}
          />
        </label>
        {data.issuer && (
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={force}
              onChange={(e) => setForce(e.target.checked)}
            />
            <span>Force this NAV as ISSUER, bypassing the 5% rail.</span>
          </label>
        )}
        <Action
          title={force ? "Force NAV update" : "Publish NAV"}
          fn="setNAV"
          address={d.addresses.HBToken}
          abi={hBTokenAbi}
          args={force ? [target ?? 0n, true] : [target ?? 0n]}
          description={
            force
              ? "Explicitly override the 5% movement rail and publish this NAV. This changes every subscription and redemption price."
              : "Publish a new USDC price per hbTRS. The contract rejects changes larger than 5%."
          }
          disabled={
            !target
              ? "Enter a positive NAV with up to 6 decimals."
              : force
                ? !data.issuer
                  ? "ISSUER role required."
                  : undefined
                : !data.oracle
                  ? "ORACLE role required; an issuer can explicitly choose force."
                  : navMove
                    ? "This change exceeds the 5% rail. Review the value."
                    : undefined
          }
        />
        <p className="caption muted">
          A manual NAV update can make the signed snapshot stale. Republish the
          NAV pipeline after review.
        </p>
      </section>
      {data.issuer && (
        <>
          <section className="card">
            <h2>Fund a coupon</h2>
            <label>
              Total distribution in USDC
              <input
                aria-label="Coupon amount"
                inputMode="decimal"
                value={coupon}
                onChange={(e) => setCoupon(e.target.value)}
              />
            </label>
            <p className="caption muted">
              Funded externally. This increases claimable coupons and does not
              reduce NAV.
            </p>
            <Action
              title="Approve coupon funding"
              fn="approve"
              address={d.addresses.USDC}
              abi={erc20Abi}
              args={[d.addresses.HBToken, distribution ?? 0n]}
              description="Allow HBToken to transfer exactly the entered USDC distribution from the issuer."
              disabled={
                !distribution
                  ? "Enter a positive coupon amount."
                  : distribution > (data.usdc ?? 0n) - 50000n
                    ? "Keep USDC for gas."
                    : undefined
              }
            />
            <Action
              title="Distribute coupon"
              fn="distributeCoupon"
              address={d.addresses.HBToken}
              abi={hBTokenAbi}
              args={[distribution ?? 0n]}
              description="Move USDC into the coupon reserve and credit all current holders through the cumulative index."
              disabled={
                data.paused
                  ? "Coupon distributions are paused."
                  : !distribution
                    ? "Enter a positive coupon amount."
                    : data.supply === 0n
                      ? "No outstanding tokens exist."
                      : (data.allowance ?? 0n) < distribution
                        ? "Approve the distribution first."
                        : distribution > (data.usdc ?? 0n) - 50000n
                          ? "Keep USDC for gas."
                          : undefined
              }
            />
          </section>
          <section className="card">
            <h2>Fund the vault</h2>
            <label>
              USDC to add
              <input
                aria-label="Vault funding amount"
                inputMode="decimal"
                value={fund}
                onChange={(e) => setFund(e.target.value)}
              />
            </label>
            <Action
              title="Transfer USDC to vault"
              fn="transfer"
              address={d.addresses.USDC}
              abi={erc20Abi}
              args={[d.addresses.HBToken, funding ?? 0n]}
              description="Transfer issuer USDC to HBToken so the vault can cover redemptions. This does not mint tokens or change NAV."
              disabled={
                !funding
                  ? "Enter a positive funding amount."
                  : funding > (data.usdc ?? 0n) - 50000n
                    ? "Keep USDC for gas."
                    : undefined
              }
            />
          </section>
          <section className="card">
            <h2>Pause controls</h2>
            <p className="muted">
              Pause blocks subscriptions, redemptions, transfers and claims.
            </p>
            <Action
              title={data.paused ? "Unpause token" : "Pause token"}
              fn={data.paused ? "unpause" : "pause"}
              address={d.addresses.HBToken}
              abi={hBTokenAbi}
              description={
                data.paused
                  ? "Restore token movement and investor transactions."
                  : "Stop all token movement and investor transactions until the issuer unpauses."
              }
            />
          </section>
        </>
      )}
    </div>
  );
}
function RegistryControls() {
  const [wallet, setWallet] = useState("");
  const [country, setCountry] = useState(826);
  const [blocked, setBlocked] = useState(true);
  const [blockCode, setBlockCode] = useState(840);
  const d = deployment!;
  const valid = isAddress(wallet) && !/^0x0{40}$/i.test(wallet);
  const { data } = useQuery({
    queryKey: ["blocklist", blockCode, country],
    queryFn: async () => {
      const codes = [...new Set([840, 792, blockCode, country])];
      return await Promise.all(
        codes.map(async (code) => ({
          code,
          blocked: await client.readContract({
            address: d.addresses.IdentityRegistry,
            abi: identityRegistryAbi,
            functionName: "isCountryBlocked",
            args: [code],
          }),
        })),
      );
    },
    refetchInterval: 10000,
  });
  const select = (value: number, onChange: (v: number) => void) => (
    <select value={value} onChange={(e) => onChange(Number(e.target.value))}>
      {countries.countries.map((c) => (
        <option key={c.numeric} value={c.numeric}>
          {c.name} ({c.numeric})
        </option>
      ))}
    </select>
  );
  return (
    <div className="admin-grid">
      <section className="card">
        <h2>Wallet eligibility</h2>
        <label>
          Wallet address
          <input
            value={wallet}
            onChange={(e) => setWallet(e.target.value)}
            placeholder="0x…"
          />
        </label>
        <label>Country of residence{select(country, setCountry)}</label>
        <Action
          title="Verify wallet"
          fn="addVerified"
          address={d.addresses.IdentityRegistry}
          abi={identityRegistryAbi}
          args={[wallet as Address, country]}
          description="Write this wallet and country to the on-chain eligibility registry."
          disabled={
            !valid
              ? "Enter a valid nonzero wallet address."
              : data?.find((r) => r.code === country)?.blocked
                ? "This country is blocked by the registry."
                : undefined
          }
        />
        <Action
          title="Revoke wallet"
          fn="removeVerified"
          address={d.addresses.IdentityRegistry}
          abi={identityRegistryAbi}
          args={[wallet as Address]}
          description="Remove eligibility to receive or subscribe. Existing tokens and accrued coupons can still exit while unpaused."
          disabled={
            !valid ? "Enter a valid nonzero wallet address." : undefined
          }
        />
      </section>
      <section className="card">
        <h2>Country blocklist</h2>
        <ul className="plain-list">
          {data
            ?.filter((r) => [840, 792, blockCode].includes(r.code))
            .map((r) => (
              <li key={r.code}>
                {countries.countries.find((c) => c.numeric === r.code)?.name}{" "}
                <Status tone={r.blocked ? "pending" : "good"}>
                  {r.blocked ? "Blocked" : "Allowed"}
                </Status>
              </li>
            ))}
        </ul>
        <label>Country to change{select(blockCode, setBlockCode)}</label>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={blocked}
            onChange={(e) => setBlocked(e.target.checked)}
          />
          <span>Block residents of this country</span>
        </label>
        <Action
          title="Update country rule"
          fn="setCountryBlocked"
          address={d.addresses.IdentityRegistry}
          abi={identityRegistryAbi}
          args={[blockCode, blocked]}
          description="Update the live registry country rule. A block also removes receiving eligibility from current residents."
        />
        <p className="caption muted">
          The public simulated-review API always excludes United States and
          Türkiye residents, even if an operator changes their registry rule.
        </p>
      </section>
    </div>
  );
}
