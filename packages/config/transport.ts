import { fallback, http } from "viem";
import { chains, type ChainName } from "./chains.ts";

/** Explicit custom RPCs stay isolated; public Arc defaults can fail over. */
export function rpcTransport(name: ChainName, url?: string) {
  const primary = chains[name].rpcUrls.default.http[0];
  const usesPublicDefault = !url || new URL(url).href === new URL(primary).href;
  const urls = usesPublicDefault ? chains[name].rpcUrls.default.http : [url!];
  const transports = urls.map((endpoint) =>
    http(endpoint, {
      batch: { wait: 25, batchSize: 25 },
      timeout: 12000,
      retryCount: 1,
    }),
  );
  return fallback(transports, { rank: false, retryCount: 1 });
}
