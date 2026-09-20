import type { NextConfig } from "next";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readPublicConfig } from "@hitbite/config/env";

// Fail before a build/server starts if public configuration is invalid.
// Never pass server secrets through Next's `env` option into the browser.
readPublicConfig({
  NEXT_PUBLIC_CHAIN: process.env.NEXT_PUBLIC_CHAIN,
  NEXT_PUBLIC_RPC_URL: process.env.NEXT_PUBLIC_RPC_URL,
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID:
    process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID,
  NEXT_PUBLIC_ATTESTOR_ADDRESS: process.env.NEXT_PUBLIC_ATTESTOR_ADDRESS,
});

const workspaceRoot = resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "..",
);

const config: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  experimental: { inlineCss: true },
  transpilePackages: ["@hitbite/config"],
  turbopack: { root: workspaceRoot },
  outputFileTracingRoot: workspaceRoot,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Strict-Transport-Security", value: "max-age=31536000" },
        ],
      },
    ];
  },
  async redirects() {
    return [
      {
        source: "/:path*",
        has: [{ type: "host", value: "www.hitbite.markets" }],
        destination: "https://hitbite.markets/:path*",
        permanent: true,
      },
    ];
  },
};

export default config;
