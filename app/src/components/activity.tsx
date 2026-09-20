"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { decodeEventLog, type Address } from "viem";
import { hBTokenAbi, identityRegistryAbi } from "@hitbite/config/abi";
import { client, deployment, short, txUrl, units } from "@/lib/chain";
import { Caption } from "./ui";
const eventLabels: Record<string, string> = {
  Subscribed: "Subscription",
  Redeemed: "Redemption",
  CouponClaimed: "Coupon payout",
  Verified: "Wallet verified",
  Revoked: "Verification revoked",
};
export function Activity({
  address,
  table = false,
}: {
  address?: Address;
  table?: boolean;
}) {
  const [pages, setPages] = useState(1);
  const { data, isPending, error } = useQuery({
    queryKey: ["activity", address, pages],
    queryFn: async () => {
      if (!deployment) return { events: [], more: false };
      const latest = await client.getBlockNumber({ cacheTime: 0 });
      const first = BigInt(deployment.blockNumber);
      const events: {
        name: string;
        hash: string;
        block: string;
        index: number;
        amount: string;
      }[] = [];
      let from = latest;
      for (let i = 0; i < pages; i++) {
        const to = latest - BigInt(i * 2000);
        if (to < first) break;
        from = to - 1999n > first ? to - 1999n : first;
        const logs = await client.getLogs({
          address: [
            deployment.addresses.HBToken,
            deployment.addresses.IdentityRegistry,
          ],
          fromBlock: from,
          toBlock: to,
        });
        for (const log of logs) {
          for (const abi of [hBTokenAbi, identityRegistryAbi])
            try {
              const decoded = decodeEventLog({
                abi,
                topics: log.topics,
                data: log.data,
              });
              if (
                ![
                  "Verified",
                  "Revoked",
                  "Subscribed",
                  "CouponDistributed",
                  "CouponClaimed",
                  "Redeemed",
                  "NAVUpdated",
                  "Paused",
                  "Unpaused",
                ].includes(decoded.eventName)
              )
                break;
              const args = decoded.args as Record<string, unknown>;
              if (
                address &&
                decoded.eventName !== "CouponDistributed" &&
                String(args.account ?? "").toLowerCase() !==
                  address.toLowerCase()
              )
                break;
              events.push({
                amount:
                  typeof (args.usdcIn ?? args.usdcOut ?? args.usdcAmount) ===
                  "bigint"
                    ? `${units((args.usdcIn ?? args.usdcOut ?? args.usdcAmount) as bigint, 6, 6)} USDC`
                    : "—",
                name: decoded.eventName,
                hash: log.transactionHash!,
                block: log.blockNumber!.toString(),
                index: log.logIndex!,
              });
              break;
            } catch {}
        }
      }
      return {
        events: events.sort(
          (a, b) => Number(b.block) - Number(a.block) || b.index - a.index,
        ),
        more: from > first,
      };
    },
    refetchInterval: 30000,
  });
  const events = table
    ? data?.events.filter((e) => e.name !== "CouponDistributed")
    : data?.events;
  return (
    <section
      className={`card activity${table ? " terminal-card terminal-activity" : ""}`}
    >
      <div className="section-heading">
        <h3>{table ? "Activity" : "On-chain activity"}</h3>
        <span className="eyebrow small">
          {address ? "Your wallet" : "Testnet"}
        </span>
      </div>
      <Caption>
        Each row is an event emitted by a confirmed contract transaction. Coupon
        distributions apply to all holders.
      </Caption>
      {isPending ? (
        <p className="muted">Loading contract events…</p>
      ) : error ? (
        <p className="error" role="alert">
          Activity is unavailable. Balances may still be refreshed.
        </p>
      ) : !events?.length ? (
        <p className="muted">No activity in the loaded blocks.</p>
      ) : table ? (
        <div className="activity-table-wrap">
          <table className="activity-table">
            <thead>
              <tr>
                <th>Transaction</th>
                <th>Amount</th>
                <th>Block / receipt</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.hash + e.index}>
                  <td>
                    <span className="event-indicator" aria-hidden="true" />
                    {eventLabels[e.name] ?? e.name}
                  </td>
                  <td className="mono">{e.amount}</td>
                  <td>
                    <a
                      className="mono"
                      href={txUrl(e.hash)}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`${eventLabels[e.name] ?? e.name} receipt, block ${e.block}`}
                    >
                      {e.block} ↗
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <ul className="activity-list">
          {events.map((e) => (
            <li key={e.hash + e.index}>
              <div>
                <strong>{e.name}</strong>
                <span className="caption muted">Block {e.block}</span>
              </div>
              <a
                className="mono caption"
                href={txUrl(e.hash)}
                target="_blank"
                rel="noreferrer"
              >
                {short(e.hash)} ↗
              </a>
            </li>
          ))}
        </ul>
      )}
      {data?.more && pages < 10 && (
        <button className="secondary" onClick={() => setPages((p) => p + 1)}>
          Load older blocks
        </button>
      )}
      {pages === 10 && data?.more && (
        <p className="caption">
          For earlier activity, open the contract explorer.
        </p>
      )}
    </section>
  );
}
