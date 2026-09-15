/**
 * Unit tests for the pure half of the wallet layer.
 *
 * Three things are worth testing here and they are all here: the status machine's transition
 * table, the revert decoder against **real** ABI-encoded revert data (produced by viem's
 * `encodeErrorResult` from the same generated ABIs the app ships), and the explorer URL builder on
 * both chains. The React parts are not unit-tested — `vitest.config.mts` runs in a `node`
 * environment and its `include` globs cover `lib/` and `tests/unit/` only, and that config is not
 * this task's to change; the components are covered by the Playwright suite instead.
 */

import { encodeErrorResult, type Hex } from "viem";
import { afterEach, describe, expect, it } from "vitest";

import { ANVIL_CHAIN_ID, BASE_SEPOLIA_CHAIN_ID } from "./chains";
import { hbTokenAbi, identityRegistryAbi, mockUsdcAbi } from "./generated/abis";
import {
  CONTRACT_ERROR_ABI,
  TX_IDLE,
  addressExplorerLink,
  decodeRevertData,
  decodeTxError,
  describeTxPhase,
  isBusyPhase,
  isTerminalPhase,
  revertedReceiptFailure,
  txExplorerLink,
  txHashOf,
  txReducer,
  walletDisconnectedFailure,
  walletNetworkFacts,
  type TxFailure,
  type TxState,
} from "./tx";

const HASH = "0x5e8ed126a35a187a3706300d6b4cf231dbac1942d71b22aa74a11955811872cb" as Hex; // allow-secret
const OTHER_HASH = "0x655a04e5c450053f20ab76c44e188ab99c5cb97bf79f17b24134d82cc74b578d" as Hex; // allow-secret
const ALICE = "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0";
const HBTOKEN = "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512";

const FAILURE: TxFailure = {
  kind: "unknown",
  title: "Boom",
  message: "Something happened.",
  retryable: true,
};

// =========================================================================== the status machine

describe("txReducer", () => {
  it("runs the happy path idle -> awaiting-signature -> pending -> confirmed", () => {
    let state: TxState = TX_IDLE;
    state = txReducer(state, { type: "submit" });
    expect(state).toEqual({ phase: "awaiting-signature" });

    state = txReducer(state, { type: "signed", hash: HASH });
    expect(state).toEqual({ phase: "pending", hash: HASH });

    state = txReducer(state, { type: "confirmed", hash: HASH, blockNumber: 42n });
    expect(state).toEqual({ phase: "confirmed", hash: HASH, blockNumber: 42n });
  });

  it("returns the identical object when an event changes nothing", () => {
    const idle = txReducer(TX_IDLE, { type: "reset" });
    expect(idle).toBe(TX_IDLE);

    const pending = txReducer(TX_IDLE, { type: "signed", hash: HASH });
    expect(pending).toBe(TX_IDLE);
  });

  it("ignores a second submit while one is already in flight", () => {
    const awaiting = txReducer(TX_IDLE, { type: "submit" });
    expect(txReducer(awaiting, { type: "submit" })).toBe(awaiting);

    const pending = txReducer(awaiting, { type: "signed", hash: HASH });
    expect(txReducer(pending, { type: "submit" })).toBe(pending);
  });

  it("lets a wallet replace a pending transaction with a new hash", () => {
    const pending = txReducer(txReducer(TX_IDLE, { type: "submit" }), {
      type: "signed",
      hash: HASH,
    });
    const replaced = txReducer(pending, { type: "signed", hash: OTHER_HASH });
    expect(replaced).toEqual({ phase: "pending", hash: OTHER_HASH });
    // …but the same hash twice is not a state change.
    expect(txReducer(pending, { type: "signed", hash: HASH })).toBe(pending);
  });

  it("keeps the hash when a failure lands on a pending transaction", () => {
    const pending = txReducer(txReducer(TX_IDLE, { type: "submit" }), {
      type: "signed",
      hash: HASH,
    });
    const failed = txReducer(pending, { type: "failed", failure: FAILURE });
    expect(failed).toEqual({ phase: "failed", hash: HASH, failure: FAILURE });
    // The explorer link survives the failure, which is what stops a disconnect dead-ending.
    expect(txHashOf(failed)).toBe(HASH);
  });

  it("records a failure with no hash when the signature was never given", () => {
    const awaiting = txReducer(TX_IDLE, { type: "submit" });
    const failed = txReducer(awaiting, { type: "failed", failure: FAILURE });
    expect(failed).toEqual({ phase: "failed", failure: FAILURE });
    expect(txHashOf(failed)).toBeUndefined();
  });

  it("never lets a late failure recolour a confirmed transaction", () => {
    const confirmed: TxState = { phase: "confirmed", hash: HASH };
    expect(txReducer(confirmed, { type: "failed", failure: FAILURE })).toBe(confirmed);
  });

  it("does not confirm a transaction that was never broadcast", () => {
    expect(txReducer(TX_IDLE, { type: "confirmed", hash: HASH })).toBe(TX_IDLE);
    const awaiting = txReducer(TX_IDLE, { type: "submit" });
    expect(txReducer(awaiting, { type: "confirmed", hash: HASH })).toBe(awaiting);
    const failed: TxState = { phase: "failed", failure: FAILURE };
    expect(txReducer(failed, { type: "confirmed", hash: HASH })).toBe(failed);
  });

  it("resets from every phase, and allows a retry from a terminal phase", () => {
    const states: TxState[] = [
      TX_IDLE,
      { phase: "awaiting-signature" },
      { phase: "pending", hash: HASH },
      { phase: "confirmed", hash: HASH },
      { phase: "failed", failure: FAILURE },
    ];
    for (const state of states) expect(txReducer(state, { type: "reset" }).phase).toBe("idle");
    expect(txReducer({ phase: "failed", failure: FAILURE }, { type: "submit" }).phase).toBe(
      "awaiting-signature",
    );
    expect(txReducer({ phase: "confirmed", hash: HASH }, { type: "submit" }).phase).toBe(
      "awaiting-signature",
    );
  });

  it("classifies the busy and terminal phases", () => {
    expect(isBusyPhase("awaiting-signature")).toBe(true);
    expect(isBusyPhase("pending")).toBe(true);
    expect(isBusyPhase("idle")).toBe(false);
    expect(isBusyPhase("confirmed")).toBe(false);
    expect(isTerminalPhase("confirmed")).toBe(true);
    expect(isTerminalPhase("failed")).toBe(true);
    expect(isTerminalPhase("pending")).toBe(false);
  });

  it("describes each phase with a label, a sentence and a tone", () => {
    expect(describeTxPhase({ phase: "awaiting-signature" }, "Subscribe")).toEqual({
      label: "Waiting for signature",
      message: "Subscribe: confirm the request in your wallet.",
      tone: "accent",
    });
    const pending = describeTxPhase({ phase: "pending", hash: HASH }, "Subscribe");
    expect(pending.tone).toBe("accent");
    expect(pending.message).toContain("0x5e8ed1…1872cb");
    expect(describeTxPhase({ phase: "confirmed", hash: HASH }).tone).toBe("success");
    const failed = describeTxPhase({ phase: "failed", failure: FAILURE }, "Redeem");
    expect(failed.tone).toBe("danger");
    expect(failed.message).toContain("Something happened.");
  });
});

// =========================================================================== explorer links

describe("explorer links", () => {
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_EXPLORER_URL;
  });

  it("links a transaction on Base Sepolia", () => {
    const link = txExplorerLink(HASH, BASE_SEPOLIA_CHAIN_ID);
    expect(link).toEqual({
      available: true,
      href: `https://sepolia.basescan.org/tx/${HASH}`,
      label: "View 0x5e8ed1…1872cb on the explorer",
      host: "sepolia.basescan.org",
    });
  });

  it("links an address on Base Sepolia", () => {
    const link = addressExplorerLink(ALICE, BASE_SEPOLIA_CHAIN_ID);
    expect(link.available).toBe(true);
    if (link.available) {
      expect(link.href).toBe(`https://sepolia.basescan.org/address/${ALICE}`);
      expect(link.host).toBe("sepolia.basescan.org");
    }
  });

  it("explains that Anvil has no explorer instead of returning a dead link", () => {
    const tx = txExplorerLink(HASH, ANVIL_CHAIN_ID);
    expect(tx.available).toBe(false);
    if (!tx.available) {
      expect(tx.reason).toContain("Anvil (local) has no block explorer");
      expect(tx.reason).toContain("transaction hash");
    }
    const address = addressExplorerLink(ALICE, ANVIL_CHAIN_ID);
    expect(address.available).toBe(false);
    if (!address.available) expect(address.reason).toContain("address");
  });

  it("honours NEXT_PUBLIC_EXPLORER_URL for the active chain, trailing slash and all", () => {
    process.env.NEXT_PUBLIC_EXPLORER_URL = "https://explorer.example/";
    const link = txExplorerLink(HASH, BASE_SEPOLIA_CHAIN_ID);
    expect(link.available).toBe(true);
    if (link.available) {
      expect(link.href).toBe(`https://explorer.example/tx/${HASH}`);
      expect(link.host).toBe("explorer.example");
    }
    // The override is scoped to the configured chain; Anvil still has no explorer.
    expect(txExplorerLink(HASH, ANVIL_CHAIN_ID).available).toBe(false);
  });

  it("reports the facts needed to add the network by hand", () => {
    expect(walletNetworkFacts(BASE_SEPOLIA_CHAIN_ID)).toEqual({
      chainId: 84532,
      chainIdHex: "0x14a34",
      label: "Base Sepolia",
      rpcUrl: "https://sepolia.base.org",
      currencySymbol: "ETH",
      explorerUrl: "https://sepolia.basescan.org",
    });
    expect(walletNetworkFacts(ANVIL_CHAIN_ID)).toMatchObject({
      chainId: 31337,
      chainIdHex: "0x7a69",
      rpcUrl: "http://127.0.0.1:8545",
      explorerUrl: null,
    });
  });
});

// =========================================================================== revert decoding

/** Real encoded revert data, from the ABIs the app ships. */
function encode(
  abi: typeof hbTokenAbi | typeof identityRegistryAbi | typeof mockUsdcAbi,
  errorName: string,
  args: readonly unknown[],
): Hex {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return encodeErrorResult({ abi, errorName, args } as any);
}

describe("decodeRevertData", () => {
  it("covers every custom error the three contracts declare", () => {
    const declared = new Set(
      [...hbTokenAbi, ...identityRegistryAbi, ...mockUsdcAbi]
        .filter((item) => item.type === "error")
        .map((item) => item.name),
    );
    const known = new Set(
      CONTRACT_ERROR_ABI.filter((item) => item.type === "error").map((item) => item.name),
    );
    expect([...declared].sort()).toEqual([...known].sort());
    expect(known.size).toBe(35);
  });

  it("decodes InsufficientLiquidity into an amount comparison in USDC", () => {
    const data = encode(hbTokenAbi, "InsufficientLiquidity", [1_000_000_000n, 2_500_123_456n]);
    const failure = decodeRevertData(data, { contract: "HBToken", functionName: "redeem" });
    expect(failure).not.toBeNull();
    expect(failure?.kind).toBe("reverted");
    expect(failure?.errorName).toBe("InsufficientLiquidity");
    expect(failure?.title).toBe("Not enough liquidity to redeem that");
    expect(failure?.message).toContain("1,000.000000 USDC");
    expect(failure?.message).toContain("2,500.123456 USDC");
    expect(failure?.message).toContain("Unclaimed coupons are reserved");
    expect(failure?.retryable).toBe(true);
    expect(failure?.details).toEqual([
      { label: "Available", value: "1,000.000000 USDC", mono: "num" },
      { label: "Requested", value: "2,500.123456 USDC", mono: "num" },
    ]);
  });

  it("decodes BelowMinimum without rounding the two numbers into agreement", () => {
    const data = encode(hbTokenAbi, "BelowMinimum", [100_000_000n, 99_999_999n]);
    const failure = decodeRevertData(data, { contract: "HBToken", functionName: "subscribe" });
    expect(failure?.errorName).toBe("BelowMinimum");
    expect(failure?.message).toContain("100.000000 USDC");
    expect(failure?.message).toContain("99.999999 USDC");
    expect(failure?.retryable).toBe(false);
  });

  it("decodes NotEligible and says what makes an address eligible", () => {
    const data = encode(hbTokenAbi, "NotEligible", [ALICE]);
    const failure = decodeRevertData(data, { contract: "HBToken", functionName: "subscribe" });
    expect(failure?.errorName).toBe("NotEligible");
    expect(failure?.title).toBe("That address cannot hold hbTRS");
    expect(failure?.message).toContain("0x9fE4…a6e0");
    expect(failure?.message).toContain("whitelist");
    expect(failure?.details).toEqual([{ label: "Address", value: ALICE, mono: "addr" }]);
  });

  it("decodes CountryBlocked and names the codes BUILD_PROMPT 16.1 names", () => {
    const usa = decodeRevertData(encode(identityRegistryAbi, "CountryBlocked", [840]), {
      contract: "IdentityRegistry",
    });
    expect(usa?.message).toContain("United States (code 840)");

    const turkiye = decodeRevertData(encode(identityRegistryAbi, "CountryBlocked", [792]), {});
    expect(turkiye?.message).toContain("Türkiye (code 792)");

    // An admin can block a code this app has never heard of; print the code, do not invent a name.
    const unknown = decodeRevertData(encode(identityRegistryAbi, "CountryBlocked", [999]), {});
    expect(unknown?.message).toContain("country code 999");

    // A page holding the full ISO list can supply the name.
    const supplied = decodeRevertData(encode(identityRegistryAbi, "CountryBlocked", [999]), {
      countryName: (code) => (code === 999 ? "Testland" : null),
    });
    expect(supplied?.message).toContain("Testland (code 999)");
  });

  it("scales a shared ERC-20 error by the token the call actually moves", () => {
    const data = encode(hbTokenAbi, "ERC20InsufficientAllowance", [
      HBTOKEN,
      50_000_000n,
      100_000_000n,
    ]);

    // subscribe pulls USDC in: six decimals.
    const onSubscribe = decodeRevertData(data, { contract: "HBToken", functionName: "subscribe" });
    expect(onSubscribe?.message).toContain("50.000000 USDC");
    expect(onSubscribe?.message).toContain("100.000000 USDC");

    // transferFrom moves hbTRS: eighteen decimals, so the same integers are dust.
    const onTransfer = decodeRevertData(data, {
      contract: "HBToken",
      functionName: "transferFrom",
    });
    expect(onTransfer?.message).toContain("0.000000 hbTRS");

    // The faucet is always mUSDC.
    const onFaucet = decodeRevertData(
      encode(mockUsdcAbi, "ERC20InsufficientBalance", [ALICE, 1n, 2n]),
      { contract: "MockUSDC", functionName: "transfer" },
    );
    expect(onFaucet?.message).toContain("mUSDC");

    // With no hint at all, report base units rather than guess a scale.
    const noHint = decodeRevertData(data, {});
    expect(noHint?.message).toContain("50000000 base units");
    expect(noHint?.message).not.toContain("USDC");
  });

  it("names the role behind AccessControlUnauthorizedAccount", () => {
    const ISSUER_ROLE = "0x114e74f6ea3bd819998f78687bfcb11b140da08e9b7d222fa9c1f1ba1f2aa122"; // allow-secret
    const data = encode(hbTokenAbi, "AccessControlUnauthorizedAccount", [ALICE, ISSUER_ROLE]);
    const failure = decodeRevertData(data, { contract: "HBToken" });
    expect(failure?.message).toContain("issuer role");
    expect(failure?.details).toContainEqual({ label: "Required role", value: "issuer role" });

    const admin = encode(hbTokenAbi, "AccessControlUnauthorizedAccount", [
      ALICE,
      `0x${"0".repeat(64)}`,
    ]);
    expect(decodeRevertData(admin, {})?.message).toContain("admin role");
  });

  it("decodes the argument-free errors into rules, not names", () => {
    const paused = decodeRevertData(encode(hbTokenAbi, "EnforcedPause", []), {});
    expect(paused?.title).toBe("The token is paused");
    expect(paused?.message).toContain("unpause");
    expect(paused?.retryable).toBe(true);

    const retail = decodeRevertData(encode(identityRegistryAbi, "RetailNotAllowed", []), {});
    expect(retail?.message).toContain("professional");

    const zeroTokens = decodeRevertData(encode(hbTokenAbi, "ZeroTokens", []), {});
    expect(zeroTokens?.message).toContain("Increase the amount");
  });

  it("decodes the faucet's own errors", () => {
    const tooLarge = decodeRevertData(
      encode(mockUsdcAbi, "FaucetAmountTooLarge", [20_000_000_000n, 10_000_000_000n]),
      { contract: "MockUSDC", functionName: "faucet" },
    );
    expect(tooLarge?.message).toContain("10,000.000000 mUSDC per call");

    const capped = decodeRevertData(
      encode(mockUsdcAbi, "FaucetDailyCapExceeded", [2_500_000_000n]),
      {},
    );
    expect(capped?.message).toContain("2,500.000000 mUSDC left");
    expect(capped?.retryable).toBe(true);
  });

  it("decodes the NAV rail with the percentage spelled out", () => {
    const data = encode(hbTokenAbi, "NavMoveExceedsRail", [1_000_000n, 1_200_000n, 500n]);
    const failure = decodeRevertData(data, {});
    expect(failure?.message).toContain("5.00%");
    expect(failure?.message).toContain("1.200000 USDC");
    expect(failure?.details).toHaveLength(3);
  });

  it("decodes the two built-in Solidity errors", () => {
    const solidityError = [
      { type: "error", name: "Error", inputs: [{ type: "string", name: "message" }] },
      { type: "error", name: "Panic", inputs: [{ type: "uint256", name: "reason" }] },
    ] as const;

    const stringRevert = decodeRevertData(
      encodeErrorResult({ abi: solidityError, errorName: "Error", args: ["only owner"] }),
      {},
    );
    expect(stringRevert?.message).toContain('"only owner"');

    const panic = decodeRevertData(
      encodeErrorResult({ abi: solidityError, errorName: "Panic", args: [0x11n] }),
      {},
    );
    expect(panic?.message).toContain("overflowed");
  });

  it("returns null for data it cannot decode rather than inventing a cause", () => {
    expect(decodeRevertData("0xdeadbeef", {})).toBeNull();
    expect(decodeRevertData("0x", {})).toBeNull();
  });
});

// =========================================================================== error classification

/** The shape viem produces: a chain of causes, each with a `name` and sometimes `data`. */
function viemError(links: Array<Record<string, unknown>>): unknown {
  return links.reduceRight<unknown>((cause, link) => ({ ...link, cause }), undefined);
}

describe("decodeTxError", () => {
  it("finds a revert through viem's wrapper chain and keeps the raw message for the details block", () => {
    const data = encode(hbTokenAbi, "BelowMinimum", [100_000_000n, 1_000_000n]);
    const error = viemError([
      {
        name: "ContractFunctionExecutionError",
        shortMessage: 'The contract function "subscribe" reverted.',
        message: "long viem message\nwith detail",
      },
      { name: "ContractFunctionRevertedError", raw: data, shortMessage: "execution reverted" },
    ]);
    const failure = decodeTxError(error, {
      action: "Subscribe",
      contract: "HBToken",
      functionName: "subscribe",
    });
    expect(failure.kind).toBe("reverted");
    expect(failure.errorName).toBe("BelowMinimum");
    expect(failure.message).toContain("100.000000 USDC");
    expect(failure.raw).toBe('The contract function "subscribe" reverted.');
    // The headline a person reads is never the node's string.
    expect(failure.title).not.toContain("execution reverted");
  });

  it("reuses the arguments viem already decoded when there is no raw payload", () => {
    const error = viemError([
      { name: "ContractFunctionExecutionError" },
      {
        name: "ContractFunctionRevertedError",
        data: { errorName: "NotEligible", args: [ALICE] },
      },
    ]);
    expect(decodeTxError(error).errorName).toBe("NotEligible");
  });

  it("reads revert data out of a bare provider error", () => {
    const data = encode(identityRegistryAbi, "CountryBlocked", [840]);
    expect(decodeTxError({ code: 3, message: "execution reverted", data }).errorName).toBe(
      "CountryBlocked",
    );
    // …and out of RawContractError's nested shape.
    expect(decodeTxError({ name: "RawContractError", data: { data } }).errorName).toBe(
      "CountryBlocked",
    );
  });

  it("treats a rejection as a rejection even when it wraps something else", () => {
    const error = viemError([
      { name: "TransactionExecutionError", shortMessage: "User rejected the request." },
      { name: "UserRejectedRequestError", code: 4001 },
    ]);
    const failure = decodeTxError(error, { action: "Subscribe" });
    expect(failure.kind).toBe("rejected");
    expect(failure.title).toBe("You declined the request");
    expect(failure.message).toContain("nothing was sent");
    expect(failure.retryable).toBe(true);
  });

  it("recognises a rejection reported only as an EIP-1193 code", () => {
    expect(decodeTxError({ code: 4001, message: "" }).kind).toBe("rejected");
  });

  it("recognises a wallet that already has a request open", () => {
    const failure = decodeTxError({
      code: -32002,
      message: "Request of type wallet_requestPermissions already pending",
    });
    expect(failure.kind).toBe("wallet-busy");
    expect(failure.retryable).toBe(true);
  });

  it("explains a network the wallet does not know, with the facts to add it by hand", () => {
    const failure = decodeTxError(
      viemError([{ name: "SwitchChainError" }, { code: 4902, message: "Unrecognized chain ID" }]),
      { action: "Switch network" },
    );
    expect(failure.kind).toBe("unsupported-chain");
    expect(failure.message).toContain("84532");
    expect(failure.message).toContain("0x14a34");
    expect(failure.message).toContain("https://sepolia.base.org");
  });

  it("recognises a chain the config does not carry", () => {
    expect(decodeTxError({ name: "ChainNotConfiguredError" }).kind).toBe("unsupported-chain");
  });

  it("recognises a wallet on the wrong network", () => {
    const failure = decodeTxError({ name: "ChainMismatchError", message: "chain mismatch" });
    expect(failure.kind).toBe("wrong-network");
    expect(failure.message).toContain("Base Sepolia");
  });

  it("recognises a wallet that disconnected mid-flight", () => {
    const byName = decodeTxError({
      name: "ConnectorNotConnectedError",
      message: "Connector not connected.",
    });
    expect(byName.kind).toBe("disconnected");
    expect(byName.message).toContain("Reconnect");
    expect(byName.retryable).toBe(true);
    expect(decodeTxError({ code: 4900, message: "disconnected" }).kind).toBe("disconnected");
  });

  it("separates an empty gas tank from a revert", () => {
    const failure = decodeTxError({
      name: "TransactionExecutionError",
      shortMessage: "An error occurred",
      message: "insufficient funds for gas * price + value",
    });
    expect(failure.kind).toBe("insufficient-gas");
    expect(failure.message).toContain("faucet");
  });

  it("says a receipt may still arrive rather than inviting a second send", () => {
    const failure = decodeTxError({ name: "WaitForTransactionReceiptTimeoutError" });
    expect(failure.kind).toBe("timeout");
    expect(failure.retryable).toBe(false);
    expect(failure.message).toContain("explorer");
  });

  it("reports a transport failure as a transport failure", () => {
    const failure = decodeTxError(
      viemError([{ name: "HttpRequestError", shortMessage: "HTTP request failed." }]),
      { action: "Redeem" },
    );
    expect(failure.kind).toBe("network");
    expect(failure.message).toContain("Redeem");
  });

  it("is honest when it cannot decode a revert", () => {
    const failure = decodeTxError(
      viemError([
        { name: "ContractFunctionExecutionError", shortMessage: "reverted" },
        { name: "ContractFunctionRevertedError", raw: "0xdeadbeef" },
      ]),
    );
    expect(failure.kind).toBe("reverted");
    expect(failure.message).toContain("not known here");
    expect(failure.raw).toBe("reverted");
  });

  it("is honest when it recognises nothing at all", () => {
    const failure = decodeTxError(new Error("something odd"), { action: "Claim" });
    expect(failure.kind).toBe("unknown");
    expect(failure.title).toBe("Claim failed");
    expect(failure.raw).toBe("something odd");
  });

  it("does not crash on null, undefined or a string", () => {
    expect(decodeTxError(undefined).kind).toBe("unknown");
    expect(decodeTxError(null).kind).toBe("unknown");
    expect(decodeTxError("boom").raw).toBe("boom");
  });

  it("survives a cause cycle", () => {
    const a: Record<string, unknown> = { name: "A" };
    const b: Record<string, unknown> = { name: "B", cause: a };
    a.cause = b;
    expect(decodeTxError(a).kind).toBe("unknown");
  });

  it("distinguishes a disconnect before a signature from one after a broadcast", () => {
    const before = walletDisconnectedFailure("Subscribe", false);
    expect(before.kind).toBe("disconnected");
    expect(before.message).toContain("nothing was sent");
    expect(before.retryable).toBe(true);

    const after = walletDisconnectedFailure("Subscribe", true);
    expect(after.message).toContain("still watching it");
    expect(after.retryable).toBe(false);
  });

  it("describes a mined-but-reverted receipt without pretending to know why", () => {
    const failure = revertedReceiptFailure("Redeem");
    expect(failure.kind).toBe("reverted");
    expect(failure.message).toContain("Gas was spent");
    expect(failure.retryable).toBe(false);
  });
});
