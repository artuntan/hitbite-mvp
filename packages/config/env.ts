import { isAddress } from "viem";
import { chains, parseChainName } from "./chains.ts";

type PublicEnvironment = Readonly<{
  NEXT_PUBLIC_CHAIN?: string;
  NEXT_PUBLIC_RPC_URL?: string;
  NEXT_PUBLIC_APP_URL?: string;
  NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID?: string;
  NEXT_PUBLIC_ATTESTOR_ADDRESS?: string;
}>;

function publicUrl(
  value: string,
  variable: string,
  allowLocalHttp: boolean,
): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${variable} must be a valid HTTP(S) URL.`);
  }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(
    parsed.hostname,
  );
  if (
    parsed.protocol !== "https:" &&
    !(allowLocalHttp && loopback && parsed.protocol === "http:")
  ) {
    throw new Error(
      `${variable} requires HTTPS, except local loopback development URLs.`,
    );
  }
  if (parsed.username || parsed.password || parsed.hash) {
    throw new Error(`${variable} cannot contain credentials or a fragment.`);
  }
  return parsed.toString();
}

/** Return only explicitly public fields; never copy process.env into a client. */
export function readPublicConfig(env: PublicEnvironment) {
  const chainName = parseChainName(env.NEXT_PUBLIC_CHAIN);
  const chain = chains[chainName];
  const rpcUrl = publicUrl(
    env.NEXT_PUBLIC_RPC_URL || chain.rpcUrls.default.http[0],
    "NEXT_PUBLIC_RPC_URL",
    chainName === "local",
  );
  const appUrl = publicUrl(
    env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
    "NEXT_PUBLIC_APP_URL",
    true,
  );
  const attestorAddress = env.NEXT_PUBLIC_ATTESTOR_ADDRESS || undefined;
  if (
    attestorAddress &&
    (!isAddress(attestorAddress) || /^0x0{40}$/i.test(attestorAddress))
  ) {
    throw new Error(
      "NEXT_PUBLIC_ATTESTOR_ADDRESS must be a nonzero EVM address.",
    );
  }
  return Object.freeze({
    chainName,
    chain,
    rpcUrl,
    appUrl,
    walletConnectProjectId:
      env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || undefined,
    attestorAddress,
  });
}
