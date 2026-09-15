/**
 * A `RegistryGateway` that answers from a script instead of from a node.
 *
 * The worker's job is to decide — is this country blocked, is this type allowed, has this address
 * already been verified, what do I do when the transaction reverts — and every one of those
 * decisions is reachable here without a chain, a key or a second of waiting. The real gateway is
 * exercised by the Anvil checkpoint in PLAN.md Phase 7, not by unit tests pretending to be a node.
 */

import type { Address } from "viem";

import type {
  AddVerifiedResult,
  BlocklistResult,
  CountryBlockedResult,
  IdentityResult,
  OnChainIdentity,
  RegistrarStatus,
  RegistryGateway,
} from "../chain";

export interface FakeChainOptions {
  /** Codes the registry reports as blocked. */
  blocked?: readonly number[];
  /** When set, every read fails with this reason — the "RPC is down" case. */
  unavailable?: string | null;
  /** When set, the registrar reports itself unavailable with this reason. */
  registrarUnavailable?: string | null;
  registryAddress?: Address | null;
  identities?: Readonly<Record<string, OnChainIdentity>>;
  /** What `addVerified` returns. A function sees the arguments it was called with. */
  addVerifiedResult?:
    | AddVerifiedResult
    | ((address: Address, country: number, callIndex: number) => AddVerifiedResult);
}

const REGISTRY = "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512" as Address;
const REGISTRAR = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" as Address;

export class FakeChain implements RegistryGateway {
  readonly chainId = 31337 as const;
  readonly network = "anvil" as const;
  readonly registryAddress: Address | null;

  /** Every `addVerified` call, in order. The assertion that nothing was sent reads this. */
  readonly addVerifiedCalls: { address: Address; country: number }[] = [];
  readonly blockedChecks: number[] = [];

  private readonly options: FakeChainOptions;

  constructor(options: FakeChainOptions = {}) {
    this.options = options;
    this.registryAddress =
      options.registryAddress === undefined ? REGISTRY : options.registryAddress;
  }

  registrar(): RegistrarStatus {
    if (this.options.registrarUnavailable) {
      return { status: "unavailable", address: null, reason: this.options.registrarUnavailable };
    }
    return { status: "ready", address: REGISTRAR, reason: null };
  }

  isCountryBlocked(country: number): Promise<CountryBlockedResult> {
    this.blockedChecks.push(country);
    if (this.options.unavailable) {
      return Promise.resolve({ status: "unavailable", reason: this.options.unavailable });
    }
    return Promise.resolve({
      status: "ok",
      blocked: (this.options.blocked ?? []).includes(country),
    });
  }

  identityOf(address: Address): Promise<IdentityResult> {
    if (this.options.unavailable) {
      return Promise.resolve({ status: "unavailable", reason: this.options.unavailable });
    }
    const identity = this.options.identities?.[address];
    return Promise.resolve({
      status: "ok",
      identity: identity ?? {
        verified: false,
        canHold: false,
        country: 0,
        investorType: 0,
        verifiedAt: null,
      },
    });
  }

  blockedCountries(): Promise<BlocklistResult> {
    if (this.options.unavailable) {
      return Promise.resolve({ status: "unavailable", reason: this.options.unavailable });
    }
    return Promise.resolve({ status: "ok", codes: [...(this.options.blocked ?? [])].sort() });
  }

  addVerified(address: Address, country: number): Promise<AddVerifiedResult> {
    const callIndex = this.addVerifiedCalls.length;
    this.addVerifiedCalls.push({ address, country });

    const configured = this.options.addVerifiedResult;
    if (typeof configured === "function") {
      return Promise.resolve(configured(address, country, callIndex));
    }
    return Promise.resolve(
      configured ?? {
        status: "confirmed",
        hash: `0x${"ab".repeat(32)}` as `0x${string}`,
      },
    );
  }
}
