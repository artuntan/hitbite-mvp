import { isAddress, verifyMessage, type Address, type Hex } from "viem";
export function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  return (
    "{" +
    Object.keys(value)
      .sort()
      .map(
        (key) =>
          JSON.stringify(key) +
          ":" +
          canonical((value as Record<string, unknown>)[key]),
      )
      .join(",") +
    "}"
  );
}
export type Attestation = {
  payload: Record<string, unknown>;
  message: string;
  signature: Hex;
  signer: Address;
  public_key: Hex;
};
export async function verifyAttestation(
  a: Attestation,
  expected: string | undefined,
  chainId: number,
  token: string,
  navUnits?: string,
) {
  if (!expected || !isAddress(expected))
    throw new Error("No trusted attestor address is configured.");
  if (
    a.payload.simulated !== true ||
    a.payload.schema !== "hitbite.attestation.v2" ||
    a.payload.chain_id !== chainId ||
    String(a.payload.token).toLowerCase() !== token.toLowerCase()
  )
    throw new Error("Attestation scope does not match this testnet contract.");
  if (canonical(a.payload) !== a.message)
    throw new Error("The displayed payload differs from the signed message.");
  if (a.signer.toLowerCase() !== expected.toLowerCase())
    throw new Error("The signer differs from the configured trust anchor.");
  if (navUnits && a.payload.nav_units !== navUnits)
    throw new Error("The attestation NAV differs from the displayed snapshot.");
  if (
    !(await verifyMessage({
      address: expected,
      message: a.message,
      signature: a.signature,
    }))
  )
    throw new Error("Invalid attestation signature.");
  return true;
}
