export const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL || "https://hitbite-testnet-v2.vercel.app";
export const contactEmail = "hello@hitbite.com";
export const landingCopy = {
  headline: "Türkiye's sovereign bonds, on-chain.",
  paragraph:
    "A licensed fund manager in Abu Dhabi issues a regulated fund that holds the bonds. Our token represents units in that fund. Daily NAV, coupon pass-through and signed attestations, all on-chain.",
  disclaimer: "Testnet only. Simulated portfolio. Not an offer of securities.",
  description:
    "Compliant on-chain access to Türkiye's USD sovereign bonds through a licensed fund manager in ADGM. Testnet live on Arc. Not an offer of securities.",
} as const;
