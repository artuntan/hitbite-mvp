/**
 * The registrar's view of `IdentityRegistry`: the only module that reads the blocklist, reads an
 * identity, or signs anything.
 *
 * ## The blocklist comes from the chain
 *
 * `COMPLIANCE_RULES.md` section 1 is explicit that the blocklist is registry state the admin can
 * change with `setCountryBlocked`, not a constant. So the question "is 840 blocked?" is answered
 * by calling `isCountryBlocked(840)` on the deployed registry — one `eth_call`, always current,
 * and by construction it cannot drift from the contract. `lib/countries.json` marks the
 * deploy-time seed for the select's disabled options and, when the chain cannot be reached, acts
 * as a floor the server will not go below (see `lib/countries.ts`).
 *
 * The *whole* list, for the UI, is folded from `CountryBlockStatusChanged` logs rather than by
 * calling `isCountryBlocked` 250 times. One `eth_getLogs` from `deployBlock`, memoised for a
 * minute. It is best-effort: a public RPC may refuse a wide range, and then the answer says so
 * and falls back to the seed rather than reporting an empty blocklist, which would be the one
 * wrong answer that matters.
 *
 * ## Every failure is a value, not a throw
 *
 * Each method returns a discriminated union. A verification request arriving while the RPC is
 * down must not 500: it is recorded as pending and the worker tries later. Modelling "the chain
 * did not answer" as data is what makes that path testable — `lib/server/__tests__` passes a
 * fake gateway and never touches a node.
 *
 * ## Keys
 *
 * `REGISTRAR_PRIVATE_KEY` is read through `lib/server/env.ts`, format-checked before viem sees it,
 * and used to build one account. It is never logged, never returned, and never interpolated into
 * an error: everything that leaves this module goes through `describeError`, which redacts it.
 * `assertRpcIsConfiguredChain` runs before the first signature, so the registrar cannot be made to
 * sign against a node that is not the configured testnet.
 */

import {
  BaseError,
  ContractFunctionRevertedError,
  createWalletClient,
  http,
  type Address,
  type Hex,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import {
  ACTIVE_CHAIN,
  ACTIVE_CHAIN_ID,
  assertRpcIsConfiguredChain,
  getChainConfig,
  getDeployment,
  getPublicClient,
  getServerRpcUrl,
  type ChainKey,
  type SupportedChainId,
} from "../chains";
import { SEED_BLOCKED_CODES } from "../countries";
import { identityRegistryAbi } from "../generated/abis";

import {
  assertServerOnly,
  describeError,
  getRegistrarKeyStatus,
  getRegistrarPrivateKey,
} from "./env";
import { INVESTOR_PROFESSIONAL } from "./verification";

assertServerOnly("lib/server/chain.ts");

/** How long to wait for the `addVerified` receipt before reporting the transaction as in flight. */
export const RECEIPT_TIMEOUT_MS = 20_000;

/** How long a folded blocklist is reused. Matches the public API's CDN window. */
export const BLOCKLIST_CACHE_MS = 60_000;

export interface OnChainIdentity {
  readonly verified: boolean;
  /** `verified && !blocked(country)` — the question `HBToken` asks on every transfer. */
  readonly canHold: boolean;
  readonly country: number;
  readonly investorType: number;
  /** Unix seconds, or `null` when there is no record. */
  readonly verifiedAt: number | null;
}

export type CountryBlockedResult =
  | { readonly status: "ok"; readonly blocked: boolean }
  | { readonly status: "unavailable"; readonly reason: string };

export type IdentityResult =
  | { readonly status: "ok"; readonly identity: OnChainIdentity }
  | { readonly status: "unavailable"; readonly reason: string };

export type BlocklistResult =
  | { readonly status: "ok"; readonly codes: readonly number[] }
  | { readonly status: "unavailable"; readonly reason: string };

export type AddVerifiedResult =
  /** Mined, `status: success`. The address is verified. */
  | { readonly status: "confirmed"; readonly hash: Hex }
  /** Sent, but no receipt within `RECEIPT_TIMEOUT_MS`. Not claimed as approved. */
  | { readonly status: "sent"; readonly hash: Hex; readonly reason: string }
  /** The registry refused it. `errorName` is the custom error when viem could decode one. */
  | {
      readonly status: "reverted";
      readonly errorName: string | null;
      readonly reason: string;
      readonly hash: Hex | null;
    }
  /** Nothing was sent: no deployment, no key, or the node did not answer. */
  | { readonly status: "unavailable"; readonly reason: string };

export interface RegistrarStatus {
  readonly status: "ready" | "unavailable";
  /** The registrar's public address. Public by definition — it holds a role on chain. */
  readonly address: Address | null;
  readonly reason: string | null;
}

export interface RegistryGateway {
  readonly chainId: SupportedChainId;
  readonly network: ChainKey;
  readonly registryAddress: Address | null;
  registrar(): RegistrarStatus;
  isCountryBlocked(country: number): Promise<CountryBlockedResult>;
  identityOf(address: Address): Promise<IdentityResult>;
  blockedCountries(): Promise<BlocklistResult>;
  addVerified(address: Address, country: number): Promise<AddVerifiedResult>;
}

// --------------------------------------------------------------------------- helpers

/** The custom error a revert carries, when viem could decode it against the ABI. */
export function revertErrorName(error: unknown): string | null {
  if (error instanceof BaseError) {
    const revert = error.walk((candidate) => candidate instanceof ContractFunctionRevertedError);
    if (revert instanceof ContractFunctionRevertedError) {
      return revert.data?.errorName ?? revert.reason ?? null;
    }
  }
  return null;
}

function noDeploymentReason(chainId: SupportedChainId, network: ChainKey): string {
  return (
    `No deployment is recorded for ${getChainConfig(chainId).label} (chain ${chainId}). ` +
    `Run \`make deploy CHAIN=${network}\` and re-run \`pnpm sync:contracts\`.`
  );
}

// --------------------------------------------------------------------------- viem gateway

class ViemRegistryGateway implements RegistryGateway {
  readonly chainId: SupportedChainId;
  readonly network: ChainKey;
  readonly registryAddress: Address | null;

  private readonly deployBlock: bigint | null;
  private networkChecked: Promise<void> | null = null;
  private blocklistCache: { at: number; result: BlocklistResult } | null = null;
  private wallet: WalletClient | null = null;

  constructor(chainId: SupportedChainId = ACTIVE_CHAIN_ID) {
    this.chainId = chainId;
    this.network = getChainConfig(chainId).key;
    const deployment = getDeployment(chainId);
    this.registryAddress = deployment?.addresses.IdentityRegistry ?? null;
    this.deployBlock = deployment ? BigInt(deployment.deployBlock) : null;
  }

  private contract(): { address: Address; abi: typeof identityRegistryAbi } | null {
    return this.registryAddress
      ? { address: this.registryAddress, abi: identityRegistryAbi }
      : null;
  }

  /** One `eth_chainId` per process, cached, before anything is read or signed (PLAN.md D50). */
  private async assertNetwork(): Promise<void> {
    this.networkChecked ??= assertRpcIsConfiguredChain(this.chainId).catch((error: unknown) => {
      this.networkChecked = null;
      throw error;
    });
    await this.networkChecked;
  }

  registrar(): RegistrarStatus {
    const key = getRegistrarKeyStatus();
    if (key.status !== "configured") {
      return { status: "unavailable", address: null, reason: key.reason };
    }
    if (!this.registryAddress) {
      return {
        status: "unavailable",
        address: null,
        reason: noDeploymentReason(this.chainId, this.network),
      };
    }
    const account = this.account();
    if (!account) {
      return {
        status: "unavailable",
        address: null,
        reason:
          "REGISTRAR_PRIVATE_KEY is the right shape but is not a usable secp256k1 key. The value is not echoed.",
      };
    }
    return { status: "ready", address: account.address, reason: null };
  }

  private account(): ReturnType<typeof privateKeyToAccount> | null {
    const key = getRegistrarPrivateKey();
    if (!key) return null;
    try {
      return privateKeyToAccount(key);
    } catch {
      // Swallowed on purpose: a key-derivation error can quote the input, and this one must not
      // travel. The caller reports a fixed sentence instead.
      return null;
    }
  }

  async isCountryBlocked(country: number): Promise<CountryBlockedResult> {
    const contract = this.contract();
    if (!contract) {
      return { status: "unavailable", reason: noDeploymentReason(this.chainId, this.network) };
    }
    try {
      await this.assertNetwork();
      const blocked = await getPublicClient(this.chainId).readContract({
        ...contract,
        functionName: "isCountryBlocked",
        args: [country],
      });
      return { status: "ok", blocked };
    } catch (error) {
      return {
        status: "unavailable",
        reason: `IdentityRegistry.isCountryBlocked(${country}) could not be read: ${describeError(error)}`,
      };
    }
  }

  async identityOf(address: Address): Promise<IdentityResult> {
    const contract = this.contract();
    if (!contract) {
      return { status: "unavailable", reason: noDeploymentReason(this.chainId, this.network) };
    }
    try {
      await this.assertNetwork();
      const client = getPublicClient(this.chainId);
      const [identity, canHold] = await Promise.all([
        client.readContract({ ...contract, functionName: "identityOf", args: [address] }),
        client.readContract({ ...contract, functionName: "canHold", args: [address] }),
      ]);
      return {
        status: "ok",
        identity: {
          verified: identity.verified,
          canHold,
          country: Number(identity.country),
          investorType: Number(identity.investorType),
          verifiedAt: identity.verified ? Number(identity.verifiedAt) : null,
        },
      };
    } catch (error) {
      return {
        status: "unavailable",
        reason: `IdentityRegistry could not be read for ${address}: ${describeError(error)}`,
      };
    }
  }

  async blockedCountries(): Promise<BlocklistResult> {
    const cached = this.blocklistCache;
    if (cached && Date.now() - cached.at < BLOCKLIST_CACHE_MS) return cached.result;

    const result = await this.foldBlocklist();
    this.blocklistCache = { at: Date.now(), result };
    return result;
  }

  /**
   * Replay `CountryBlockStatusChanged` from `deployBlock` and keep the last value per code. The
   * constructor emits one event per seeded country, so the fold starts complete and stays
   * complete — there is no state before the first log.
   */
  private async foldBlocklist(): Promise<BlocklistResult> {
    const contract = this.contract();
    if (!contract || this.deployBlock === null) {
      return { status: "unavailable", reason: noDeploymentReason(this.chainId, this.network) };
    }
    try {
      await this.assertNetwork();
      const logs = await getPublicClient(this.chainId).getContractEvents({
        address: contract.address,
        abi: identityRegistryAbi,
        eventName: "CountryBlockStatusChanged",
        fromBlock: this.deployBlock,
        toBlock: "latest",
      });

      const blocked = new Map<number, boolean>();
      for (const log of logs) {
        const country = log.args.country;
        const isBlocked = log.args.blocked;
        if (country === undefined || isBlocked === undefined) continue;
        blocked.set(Number(country), isBlocked);
      }

      const codes = [...blocked.entries()]
        .filter(([, isBlocked]) => isBlocked)
        .map(([code]) => code)
        .sort((a, b) => a - b);

      return { status: "ok", codes };
    } catch (error) {
      return {
        status: "unavailable",
        reason:
          `The blocklist could not be read from the registry's logs: ${describeError(error)}. ` +
          `Falling back to the codes the registry is deployed with (${SEED_BLOCKED_CODES.join(", ")}); ` +
          "the admin may have changed it since.",
      };
    }
  }

  async addVerified(address: Address, country: number): Promise<AddVerifiedResult> {
    const contract = this.contract();
    if (!contract) {
      return { status: "unavailable", reason: noDeploymentReason(this.chainId, this.network) };
    }
    const registrar = this.registrar();
    if (registrar.status !== "ready") {
      return { status: "unavailable", reason: registrar.reason ?? "the registrar is not ready" };
    }
    const account = this.account();
    if (!account) {
      return {
        status: "unavailable",
        reason: "REGISTRAR_PRIVATE_KEY could not be turned into an account.",
      };
    }

    const config = getChainConfig(this.chainId);
    const client = getPublicClient(this.chainId);
    // investorType is always professional: retail never reaches this method, and passing 2 would
    // revert RetailNotAllowed anyway (PLAN.md D21).
    const args = [address, country, INVESTOR_PROFESSIONAL] as const;

    let request;
    try {
      await this.assertNetwork();
      const simulated = await client.simulateContract({
        ...contract,
        functionName: "addVerified",
        args,
        account,
      });
      request = simulated.request;
    } catch (error) {
      const errorName = revertErrorName(error);
      if (errorName) {
        return {
          status: "reverted",
          errorName,
          hash: null,
          reason: `IdentityRegistry.addVerified would revert ${errorName}. Nothing was sent.`,
        };
      }
      return {
        status: "unavailable",
        reason: `addVerified could not be simulated: ${describeError(error)}`,
      };
    }

    let hash: Hex;
    try {
      this.wallet ??= createWalletClient({
        account,
        chain: config.viemChain,
        transport: http(getServerRpcUrl(this.chainId), { retryCount: 1, timeout: 10_000 }),
      });
      hash = await this.wallet.writeContract(request);
    } catch (error) {
      return {
        status: "unavailable",
        reason: `the addVerified transaction could not be sent: ${describeError(error)}`,
      };
    }

    try {
      const receipt = await client.waitForTransactionReceipt({
        hash,
        confirmations: 1,
        timeout: RECEIPT_TIMEOUT_MS,
      });
      if (receipt.status === "success") return { status: "confirmed", hash };
      return {
        status: "reverted",
        errorName: null,
        hash,
        reason: `the addVerified transaction ${hash} was mined and reverted.`,
      };
    } catch (error) {
      // The transaction exists; we just did not see it land. Reporting it as approved would be a
      // claim we cannot defend, so the row stays pending and the next call re-reads the chain,
      // finds the address verified, and closes it out without sending anything again.
      return {
        status: "sent",
        hash,
        reason: `addVerified was sent as ${hash} but no receipt arrived within ${RECEIPT_TIMEOUT_MS} ms: ${describeError(error)}`,
      };
    }
  }
}

let shared: RegistryGateway | null = null;

/** The process-wide gateway for the configured chain. */
export function getRegistryGateway(): RegistryGateway {
  shared ??= new ViemRegistryGateway(ACTIVE_CHAIN_ID);
  return shared;
}

/** A gateway for an explicit chain id. Used by tests and by any future multi-chain caller. */
export function createRegistryGateway(
  chainId: SupportedChainId = ACTIVE_CHAIN_ID,
): RegistryGateway {
  return new ViemRegistryGateway(chainId);
}

/** The configured chain, for responses that report it even when there is no deployment. */
export const CHAIN_LABEL = ACTIVE_CHAIN.label;
