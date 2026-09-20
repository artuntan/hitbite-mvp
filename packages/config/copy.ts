export const repositoryUrl = "https://github.com/artuntan/hitbite-mvp";

// BUILD_PROMPT_V2.md §10: keep these strings verbatim.
export const copy = {
  testnetBanner: "Testnet. Simulated portfolio. Not an offer of securities.",
  blockedCountry: "Not available to residents of the United States or Türkiye on this testnet.",
  vaultNotice: "Redemptions on the testnet are paid from a vault the admin funds. There is no liquidity guarantee.",
  attestationLabel: "Simulated attestor. Replaced by an independent firm in production.",
  gasNotice: "Gas on Arc is paid in USDC. Keep a small balance for fees.",
  footer: "Not an offer of securities. Testnet only.",
} as const;

// BUILD_PROMPT_V2.md §7. Production describes the intended partner model.
export const productionMapping = [
  ["Legal issuer", "none (simulation)", "Licensed ADGM fund manager's fund"],
  ["KYC / whitelist", "10-second simulated review", "Partner's KYC vendor writes to the registry"],
  ["Money", "testnet USDC on Arc", "Fiat/USDC into the fund's account via the partner"],
  ["Custody", "none", "Bonds at broker/Euroclear; tokens with a licensed digital custodian"],
  ["Token contract", "ours", "Vendor's audited contract implementing this behaviour"],
  ["NAV", "our Python job", "Fund administrator's NAV, published by us"],
  ["Attestation", "simulated signer", "Independent firm, monthly"],
  ["App and transparency", "ours", "ours, fronting the partner's flow"],
] as const;
