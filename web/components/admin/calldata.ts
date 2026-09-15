/**
 * The encoded call, built from the contract's own ABI.
 *
 * BUILD_PROMPT 7.2 asks that every admin action show its encoded call before it is signed. The
 * point is not decoration: a wallet popup shows a `to` address and a blob, and the only way an
 * operator can tell that the blob is the transaction they meant is to have seen the selector and
 * the arguments written out beside the form that produced them. So this module encodes with
 * `viem.encodeFunctionData` — the same function `useTx` will hand to the wallet, against the same
 * generated ABI — and returns the pieces separately so the UI can lay out the selector, the
 * arguments and the 32-byte words rather than one unreadable hex string.
 *
 * Encoding failures are returned, not thrown. A half-typed address is a normal state of a form, and
 * a form that throws while you are typing in it is worse than one that says "not yet".
 *
 * A **missing destination is not an encoding failure**. Calldata is a function of the ABI and the
 * arguments; the address is where it would be sent. So a network with no recorded deployment still
 * gets the selector, the arguments and the whole calldata — which is the version of this panel a
 * reviewer opening the page on a fresh clone will see, and it is the version that teaches the most.
 * `address` is `null` there, and nothing can be signed, which the card says separately.
 */

import { encodeFunctionData, toFunctionSelector, type Abi, type Address, type Hex } from "viem";

/** One argument: the value viem will encode, plus how a person should read it. */
export interface CallArgument {
  readonly value: unknown;
  /** Human form, e.g. `"1.003061 USDC"` beside the integer `1003061`. */
  readonly display?: string;
}

export interface EncodedArgument {
  readonly name: string;
  readonly type: string;
  /** The value exactly as it goes into the encoding. */
  readonly value: string;
  /** The same value in the units a person thinks in, when that differs. */
  readonly display: string | null;
}

export interface EncodedCall {
  /** Contract name as the generated ABIs know it, e.g. `"HBToken"`. */
  readonly contract: string;
  /** Where it would be sent, or `null` when this network has no recorded deployment. */
  readonly address: Address | null;
  readonly functionName: string;
  /** Canonical signature, e.g. `"setNAV(uint256,uint256,bool)"`. */
  readonly signature: string;
  readonly selector: Hex;
  /** Full calldata: selector plus arguments. */
  readonly data: Hex;
  readonly arguments: readonly EncodedArgument[];
  /** Native value sent with the call. Always zero here — none of these functions is payable. */
  readonly value: bigint;
}

export type EncodeResult =
  | { readonly ok: true; readonly call: EncodedCall }
  | { readonly ok: false; readonly reason: string };

export interface EncodeCallInput {
  readonly contract: string;
  readonly address: Address | null;
  readonly abi: Abi | readonly unknown[];
  readonly functionName: string;
  readonly args?: readonly CallArgument[];
}

interface AbiFunctionLike {
  type: string;
  name?: string;
  inputs?: readonly { name?: string; type: string }[];
  stateMutability?: string;
}

/**
 * Find the ABI entry, preferring the overload whose arity matches. None of these contracts
 * overloads a function, but resolving by arity rather than by first match means that if one ever
 * does, this picks the entry that was actually encoded instead of the one that sorted first.
 */
function findFunction(
  abi: Abi | readonly unknown[],
  functionName: string,
  arity: number,
): AbiFunctionLike | null {
  const candidates = (abi as readonly AbiFunctionLike[]).filter(
    (item) => item.type === "function" && item.name === functionName,
  );
  if (candidates.length === 0) return null;
  return candidates.find((item) => (item.inputs?.length ?? 0) === arity) ?? candidates[0] ?? null;
}

function stringifyValue(value: unknown): string {
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) return `[${value.map(stringifyValue).join(", ")}]`;
  return JSON.stringify(value) ?? String(value);
}

/** The first line of whatever viem threw, without the ABI dump that follows it. */
function shortReason(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const line = message.split("\n")[0]?.trim() ?? "";
  if (line === "") return "the arguments could not be encoded.";
  return line.endsWith(".") ? line : `${line}.`;
}

export function encodeCall(input: EncodeCallInput): EncodeResult {
  const args = input.args ?? [];

  const item = findFunction(input.abi, input.functionName, args.length);
  if (!item) {
    return {
      ok: false,
      reason: `${input.contract} has no function named ${input.functionName} in the generated ABI.`,
    };
  }

  const inputs = item.inputs ?? [];
  const signature = `${input.functionName}(${inputs.map((parameter) => parameter.type).join(",")})`;

  let data: Hex;
  try {
    data = encodeFunctionData({
      abi: input.abi as Abi,
      functionName: input.functionName,
      args: args.map((argument) => argument.value),
    } as Parameters<typeof encodeFunctionData>[0]);
  } catch (error) {
    return { ok: false, reason: shortReason(error) };
  }

  const encodedArguments: EncodedArgument[] = inputs.map((parameter, index) => ({
    name: parameter.name && parameter.name !== "" ? parameter.name : `arg${index}`,
    type: parameter.type,
    value: stringifyValue(args[index]?.value),
    display: args[index]?.display ?? null,
  }));

  return {
    ok: true,
    call: {
      contract: input.contract,
      address: input.address,
      functionName: input.functionName,
      signature,
      selector: toFunctionSelector(signature),
      data,
      arguments: encodedArguments,
      value: 0n,
    },
  };
}

export interface CalldataLayout {
  readonly selector: string;
  /** The argument area, one 32-byte word per entry, in order. */
  readonly words: readonly string[];
  /** True when the argument area is not a whole number of words — impossible for a static ABI. */
  readonly ragged: boolean;
}

/**
 * Split calldata into its selector and its 32-byte words, so the UI can print it the way a block
 * explorer does. A single 200-character hex run is technically the same information and is
 * unreadable; four 64-character lines can be checked by eye against an argument list.
 */
export function calldataLayout(data: Hex): CalldataLayout {
  const body = data.startsWith("0x") ? data.slice(2) : data;
  const selector = body.slice(0, 8);
  const rest = body.slice(8);
  const words: string[] = [];
  for (let index = 0; index < rest.length; index += 64) words.push(rest.slice(index, index + 64));
  return { selector: `0x${selector}`, words, ragged: rest.length % 64 !== 0 };
}
