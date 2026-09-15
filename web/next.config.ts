import type { NextConfig } from "next";
import path from "node:path";

/**
 * RainbowKit's entry point imports `wagmi/connectors`, whose barrel reaches `@base-org/account`
 * and then `@coinbase/cdp-sdk`. That SDK statically imports four `@x402/*` packages it declares as
 * **optional** peer dependencies, so pnpm does not install them and webpack cannot resolve them:
 * `next build` fails with "Module not found" the moment any route imports the wallet layer.
 *
 * Nothing in this app uses the x402 payment paths, and the Base Account wallet they belong to is
 * not in `lib/wagmi.ts`'s connector list, so the modules are aliased to `false` (webpack's
 * "resolve to an empty module"). Documented in `components/wallet/providers.tsx`.
 */
const X402_OPTIONAL_PEERS = [
  "@x402/core/client",
  "@x402/evm",
  "@x402/evm/exact/client",
  "@x402/evm/upto/client",
  "@x402/svm/exact/client",
] as const;

const nextConfig: NextConfig = {
  // This app is a sub-project of a monorepo; pin the tracing root so Next does not guess from stray lockfiles.
  outputFileTracingRoot: path.join(__dirname),
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      ...Object.fromEntries(X402_OPTIONAL_PEERS.map((id) => [id, false])),
    };
    return config;
  },
};

export default nextConfig;
