import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // This app is a sub-project of a monorepo; pin the tracing root so Next does not guess from stray lockfiles.
  outputFileTracingRoot: path.join(__dirname),
};

export default nextConfig;
