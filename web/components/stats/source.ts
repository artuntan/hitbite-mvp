/**
 * The reading half of `/stats`: one event index, one batched contract read, no HTTP.
 *
 * The page is a server component, so it calls the indexer directly rather than
 * fetching its own `/api/stats` over the network. Same process, same 60-second
 * in-memory index (PLAN.md D10), same pure `aggregate()` — which is what makes
 * the figures on the page and the figures in the JSON the same numbers by
 * construction rather than by coincidence. A self-`fetch` would need an absolute
 * origin, would forbid prerendering, and would add a round trip to say nothing new.
 *
 * `readChainFacts` is the transparency page's batched `HBToken` read, reused
 * rather than copied: `totalSupply()` is the one figure this page needs from the
 * contract itself — the cross-check that says whether the supply folded from
 * `Transfer` logs agrees with the token — and a second copy of the same nine
 * `eth_call`s would be one more place for the two pages to drift apart. It never
 * throws; an unreachable chain is one of its three states.
 *
 * Nothing here imports the wallet layer. `/stats` is public and must stay as
 * light as `/transparency` (PLAN.md D63).
 */

import { readChainFacts, type ChainFacts } from "@/components/transparency/chain-facts";
import { ACTIVE_CHAIN, ACTIVE_CHAIN_ID, type ChainKey, type SupportedChainId } from "@/lib/chains";
import { aggregate } from "@/lib/server/events";
import { coverageLimitations, getEventIndex } from "@/lib/server/indexer";

import { buildStatsModel, type StatsModel } from "./view-model";

interface StatsIdentity {
  readonly chainId: SupportedChainId;
  readonly network: ChainKey;
  /** "Base Sepolia" / "Anvil (local)". */
  readonly label: string;
}

export type StatsSource =
  | (StatsIdentity & {
      readonly status: "ok";
      readonly model: StatsModel;
      readonly chain: ChainFacts;
    })
  | (StatsIdentity & { readonly status: "unavailable"; readonly reason: string });

/**
 * Everything `/stats` renders, or the reason there is nothing to render.
 *
 * The two reads run together because neither depends on the other, and a failure
 * in either is a state rather than an exception: `getEventIndex` returns
 * `unavailable` with a reason, `readChainFacts` returns `no-deployment` or
 * `unreachable`. The page renders whichever of those it is told.
 */
export async function readStats(): Promise<StatsSource> {
  const identity: StatsIdentity = {
    chainId: ACTIVE_CHAIN_ID,
    network: ACTIVE_CHAIN.key,
    label: ACTIVE_CHAIN.label,
  };

  const [index, chain] = await Promise.all([getEventIndex(), readChainFacts()]);

  if (index.status !== "ok") {
    return { ...identity, status: "unavailable", reason: index.reason };
  }

  return {
    ...identity,
    status: "ok",
    chain,
    model: buildStatsModel({
      index: index.index,
      cache: index.cache,
      folded: aggregate(index.index.events),
      // `null` is "not checked", not "zero": with no contract read there is one
      // side of the supply comparison and the page must not call that a pass.
      chainSupplyWei: chain.status === "ok" ? chain.totalSupply : null,
      limitations: coverageLimitations(index.index, index.cache),
    }),
  };
}
