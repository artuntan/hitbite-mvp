import {
  createHmac,
  randomBytes,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { isAddress, type Address } from "viem";
import countryData from "@hitbite/config/countries";

export const REVIEW_MS = 10_000;
export const EXPIRY_MS = 300_000;
export type Application = {
  address: Address;
  country: number;
  name: string;
  professional: true;
};
export type Challenge = {
  address: Address;
  country: number;
  nameHash: string;
  professional: true;
  chainId: number;
  origin: string;
  issuedAt: number;
  expiresAt: number;
  nonce: string;
};
export function application(input: unknown): Application {
  if (!input || typeof input !== "object")
    throw new Error("Invalid application.");
  const i = input as Record<string, unknown>;
  if (
    typeof i.address !== "string" ||
    !isAddress(i.address) ||
    /^0x0{40}$/i.test(i.address)
  )
    throw new Error("A valid wallet address is required.");
  if (
    typeof i.name !== "string" ||
    i.name.trim().length < 2 ||
    i.name.trim().length > 100
  )
    throw new Error("Enter a name between 2 and 100 characters.");
  if (
    typeof i.country !== "number" ||
    !countryData.countries.some((c) => c.numeric === i.country)
  )
    throw new Error("Choose a country from the list.");
  if (i.professional !== true)
    throw new Error("Professional-investor confirmation is required.");
  return {
    address: i.address as Address,
    country: i.country,
    name: i.name.trim(),
    professional: true,
  };
}
function mac(value: string, secret: string) {
  return createHmac("sha256", secret).update(value).digest();
}
export function issue(
  input: Application,
  chainId: number,
  origin: string,
  secret: string,
  now = Date.now(),
) {
  const payload: Challenge = {
    address: input.address,
    country: input.country,
    nameHash: createHash("sha256").update(input.name).digest("hex"),
    professional: true,
    chainId,
    origin,
    issuedAt: now,
    expiresAt: now + EXPIRY_MS,
    nonce: randomBytes(24).toString("hex"),
  };
  const value = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return {
    ticket: value + "." + mac(value, secret).toString("base64url"),
    message: message(payload),
    reviewMs: REVIEW_MS,
    expiresAt: payload.expiresAt,
  };
}
export function message(payload: Challenge) {
  return [
    "HitBite testnet verification",
    "Simulated review only. This is not real KYC.",
    "No funds are moved by this signature.",
    `Origin: ${payload.origin}`,
    `Wallet: ${payload.address}`,
    `Chain ID: ${payload.chainId}`,
    `Country: ${payload.country}`,
    `Professional investor: ${payload.professional}`,
    `Name digest: ${payload.nameHash}`,
    `Issued: ${payload.issuedAt}`,
    `Expires: ${payload.expiresAt}`,
    `Nonce: ${payload.nonce}`,
  ].join("\n");
}
export function open(
  ticket: unknown,
  secret: string,
  chainId: number,
  origin: string,
  now = Date.now(),
): Challenge {
  if (typeof ticket !== "string" || ticket.length > 3000)
    throw new Error("Invalid verification ticket.");
  const [value, signature, extra] = ticket.split(".");
  if (!value || !signature || extra)
    throw new Error("Invalid verification ticket.");
  const expected = mac(value, secret),
    actual = Buffer.from(signature, "base64url");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual))
    throw new Error("Invalid verification ticket.");
  const p = JSON.parse(Buffer.from(value, "base64url").toString()) as Challenge;
  if (
    p.chainId !== chainId ||
    p.origin !== origin ||
    p.professional !== true ||
    now < p.issuedAt ||
    now > p.expiresAt
  )
    throw new Error(
      "Verification ticket expired or has the wrong origin or chain.",
    );
  if (now - p.issuedAt < REVIEW_MS)
    throw new Error("The 10-second simulated review is still pending.");
  return p;
}
