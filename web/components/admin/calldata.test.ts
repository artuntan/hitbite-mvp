import { describe, expect, it } from "vitest";

import { calldataLayout, encodeCall } from "@/components/admin/calldata";
import { ADMIN_ACTIONS } from "@/components/admin/roles";
import { hbTokenAbi, identityRegistryAbi, mockUsdcAbi } from "@/lib/generated/abis";

/**
 * The expected values are not produced by viem. They come from `cast calldata` against the same
 * signatures, so this file compares two independent encoders rather than checking viem against
 * itself — which is the only version of this test that could ever fail usefully.
 *
 *     cast calldata "setNAV(uint256,uint256,bool)" 1003061 1000000 false
 */
const TOKEN = "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0" as const;
const REGISTRY = "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512" as const;
const HOLDER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as const;

describe("encodeCall", () => {
  it("encodes setNAV exactly as cast does", () => {
    const result = encodeCall({
      contract: "HBToken",
      address: TOKEN,
      abi: hbTokenAbi,
      functionName: "setNAV",
      args: [
        { value: 1_003_061n, display: "1.003061 USDC" },
        { value: 1_000_000n, display: "1.00 USDC" },
        { value: false },
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.call.signature).toBe("setNAV(uint256,uint256,bool)");
    expect(result.call.selector).toBe("0x42b264f0");
    expect(result.call.data).toBe(
      "0x42b264f000000000000000000000000000000000000000000000000000000000000f4e3500000000000000000000000000000000000000000000000000000000000f42400000000000000000000000000000000000000000000000000000000000000000",
    );
    expect(result.call.arguments.map((argument) => argument.name)).toEqual([
      "newNav",
      "newReportedAUM",
      "force",
    ]);
    expect(result.call.arguments[0]).toMatchObject({
      type: "uint256",
      value: "1003061",
      display: "1.003061 USDC",
    });
    expect(result.call.arguments[2]).toMatchObject({ type: "bool", value: "false", display: null });
    expect(result.call.value).toBe(0n);
  });

  it("encodes setCountryBlocked on the registry", () => {
    const result = encodeCall({
      contract: "IdentityRegistry",
      address: REGISTRY,
      abi: identityRegistryAbi,
      functionName: "setCountryBlocked",
      args: [{ value: 840 }, { value: true }],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.call.signature).toBe("setCountryBlocked(uint16,bool)");
    expect(result.call.selector).toBe("0x8db7b007");
    expect(result.call.data).toBe(
      "0x8db7b00700000000000000000000000000000000000000000000000000000000000003480000000000000000000000000000000000000000000000000000000000000001",
    );
  });

  it("encodes distributeCoupon and burn", () => {
    const distribute = encodeCall({
      contract: "HBToken",
      address: TOKEN,
      abi: hbTokenAbi,
      functionName: "distributeCoupon",
      args: [{ value: 12_000_000n, display: "12.00 USDC" }],
    });
    expect(distribute.ok && distribute.call.data).toBe(
      "0x7604c5000000000000000000000000000000000000000000000000000000000000b71b00",
    );

    const burn = encodeCall({
      contract: "HBToken",
      address: TOKEN,
      abi: hbTokenAbi,
      functionName: "burn",
      args: [{ value: HOLDER }, { value: 1_000_000_000_000_000_000n, display: "1.0 hbTRS" }],
    });
    expect(burn.ok && burn.call.data).toBe(
      "0x9dc29fac00000000000000000000000070997970c51812dc3a010c7d01b50e0d17dc79c80000000000000000000000000000000000000000000000000de0b6b3a7640000",
    );
  });

  it("encodes a no-argument function to its bare selector", () => {
    const result = encodeCall({
      contract: "HBToken",
      address: TOKEN,
      abi: hbTokenAbi,
      functionName: "pause",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.call.data).toBe("0x8456cb59");
    expect(result.call.signature).toBe("pause()");
    expect(result.call.arguments).toHaveLength(0);
  });

  it("still encodes when the network has no deployment, with a null destination", () => {
    // Calldata is a function of the ABI and the arguments. A missing address means there is nowhere
    // to send it, not that there is nothing to show.
    const result = encodeCall({
      contract: "HBToken",
      address: null,
      abi: hbTokenAbi,
      functionName: "distributeCoupon",
      args: [{ value: 12_000_000n }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.call.address).toBeNull();
    expect(result.call.data).toBe(
      "0x7604c5000000000000000000000000000000000000000000000000000000000000b71b00",
    );
  });

  it("refuses rather than throws on an argument that cannot be encoded", () => {
    const result = encodeCall({
      contract: "HBToken",
      address: TOKEN,
      abi: hbTokenAbi,
      functionName: "burn",
      // Half-typed address: the ordinary state of a form, and not a reason to crash the page.
      args: [{ value: "0x7099" }, { value: 1n }],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason.length).toBeGreaterThan(0);
  });

  it("names a function the ABI does not have", () => {
    const result = encodeCall({
      contract: "HBToken",
      address: TOKEN,
      abi: hbTokenAbi,
      functionName: "rugPull",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("no function named rugPull");
  });
});

/**
 * Every call the console can send, against the generated ABI.
 *
 * `useReadContract` and `useTx` are typed against the same `as const` ABIs, so a misspelled read is
 * already a compile error. A misspelled *write* is not: `encodeCall` looks the name up at runtime
 * and would refuse at the moment an operator pressed the button. This table closes that gap, and
 * the selectors are `cast sig` output rather than viem's, so a signature that silently changed in
 * the contract fails here.
 */
describe("the console's whole call surface", () => {
  const calls = [
    {
      contract: "HBToken",
      abi: hbTokenAbi,
      name: "setNAV",
      arity: 3,
      signature: "setNAV(uint256,uint256,bool)",
      selector: "0x42b264f0",
    },
    {
      contract: "HBToken",
      abi: hbTokenAbi,
      name: "distributeCoupon",
      arity: 1,
      signature: "distributeCoupon(uint256)",
      selector: "0x7604c500",
    },
    {
      contract: "HBToken",
      abi: hbTokenAbi,
      name: "pause",
      arity: 0,
      signature: "pause()",
      selector: "0x8456cb59",
    },
    {
      contract: "HBToken",
      abi: hbTokenAbi,
      name: "unpause",
      arity: 0,
      signature: "unpause()",
      selector: "0x3f4ba83a",
    },
    {
      contract: "HBToken",
      abi: hbTokenAbi,
      name: "mint",
      arity: 2,
      signature: "mint(address,uint256)",
      selector: "0x40c10f19",
    },
    {
      contract: "HBToken",
      abi: hbTokenAbi,
      name: "burn",
      arity: 2,
      signature: "burn(address,uint256)",
      selector: "0x9dc29fac",
    },
    {
      contract: "IdentityRegistry",
      abi: identityRegistryAbi,
      name: "setCountryBlocked",
      arity: 2,
      signature: "setCountryBlocked(uint16,bool)",
      selector: "0x8db7b007",
    },
    {
      contract: "MockUSDC",
      abi: mockUsdcAbi,
      name: "approve",
      arity: 2,
      signature: "approve(address,uint256)",
      selector: "0x095ea7b3",
    },
  ] as const;

  const sampleArgs: Record<string, unknown[]> = {
    setNAV: [1_000_000n, 1_000_000n, false],
    distributeCoupon: [1_000_000n],
    pause: [],
    unpause: [],
    mint: [HOLDER, 1n],
    burn: [HOLDER, 1n],
    setCountryBlocked: [840, true],
    approve: [TOKEN, 1n],
  };

  it.each(calls)("encodes $contract.$name", ({ contract, abi, name, signature, selector }) => {
    const result = encodeCall({
      contract,
      address: TOKEN,
      abi,
      functionName: name,
      args: (sampleArgs[name] ?? []).map((value) => ({ value })),
    });

    expect(result.ok, `${contract}.${name} must exist in the generated ABI`).toBe(true);
    if (!result.ok) return;
    expect(result.call.signature).toBe(signature);
    expect(result.call.selector).toBe(selector);
    expect(result.call.data.startsWith(selector)).toBe(true);
  });

  it("covers every action the roles table advertises as a contract call", () => {
    // Only the rows that name a contract function. The queue's two actions are HTTP endpoints and
    // have no calldata; they are excluded by the shape of what they advertise, not by a list.
    const advertised = ADMIN_ACTIONS.flatMap((action) => {
      const match = /^(HBToken|IdentityRegistry|MockUSDC)\.(\w+)\(/.exec(action.call);
      return match ? [match[2] as string] : [];
    });
    expect(advertised.length).toBeGreaterThan(0);

    const encodable = new Set<string>(calls.map((call) => call.name));
    for (const name of advertised) {
      expect(encodable.has(name), `${name} is advertised but not encodable`).toBe(true);
    }
  });
});

describe("calldataLayout", () => {
  it("splits calldata into a selector and whole 32-byte words", () => {
    const layout = calldataLayout(
      "0x8db7b00700000000000000000000000000000000000000000000000000000000000003480000000000000000000000000000000000000000000000000000000000000001",
    );
    expect(layout.selector).toBe("0x8db7b007");
    expect(layout.words).toHaveLength(2);
    expect(layout.words[0]).toHaveLength(64);
    expect(layout.words[1]?.endsWith("1")).toBe(true);
    expect(layout.ragged).toBe(false);
  });

  it("handles a bare selector", () => {
    const layout = calldataLayout("0x8456cb59");
    expect(layout.selector).toBe("0x8456cb59");
    expect(layout.words).toEqual([]);
    expect(layout.ragged).toBe(false);
  });
});
