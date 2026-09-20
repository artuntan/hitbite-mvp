"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { decodeEventLog, type Address } from "viem";
import { hBTokenAbi, identityRegistryAbi } from "@hitbite/config/abi";
import { client, deployment, short, txUrl } from "@/lib/chain";
import { Caption } from "./ui";
export function Activity({ address }: { address?: Address }) {
  const [pages, setPages] = useState(1);
  const { data, isPending, error } = useQuery({
    queryKey: ["activity", address, pages],
    queryFn: async () => {
      if (!deployment) return { events: [], more: false };
      const latest = await client.getBlockNumber();
      const first = BigInt(deployment.blockNumber);
      const events: {
        name: string;
        hash: string;
        block: string;
        index: number;
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
  return (
    <section className="card activity">
      <div className="section-heading">
        <h3>On-chain activity</h3>
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
      ) : !data?.events.length ? (
        <p className="muted">No activity in the loaded blocks.</p>
      ) : (
        <ul className="activity-list">
          {data.events.map((e) => (
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
