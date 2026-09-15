/**
 * abi — the slice of each contract's interface the demo actually uses.
 *
 * Hand-written rather than generated, for two reasons. The runner must stay runnable from a clone
 * that has never executed `forge build` (there is no `contracts/out/` in a fresh checkout), and a
 * small explicit ABI is easier to read next to the steps that use it than a 400-entry JSON blob.
 *
 * Every entry below was taken from `forge inspect <contract> methodIdentifiers|errors` against
 * `contracts/src/`, including the custom errors: without the error fragments viem cannot decode a
 * revert, and two of the eight demo steps exist precisely to show a revert by name
 * (`CountryBlocked(840)` in step 1, `NotEligible(C)` in step 6). `preflight` re-reads the three
 * addresses from the chain and cross-checks them against the deployment record, so an ABI that has
 * drifted from the deployed bytecode fails immediately and loudly instead of half-way through.
 */

/** `contracts/src/HBToken.sol` — hbTRS, the NAV-priced share class. */
export const hbTokenAbi = [
  // --- constants and configuration
  {
    type: "function",
    name: "NAV_SCALE",
    inputs: [],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "TOKEN_SCALE",
    inputs: [],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "MAX_BPS",
    inputs: [],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "RAIL_WINDOW",
    inputs: [],
    outputs: [{ type: "uint64" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "ISSUER_ROLE",
    inputs: [],
    outputs: [{ type: "bytes32" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "ORACLE_ROLE",
    inputs: [],
    outputs: [{ type: "bytes32" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "DEFAULT_ADMIN_ROLE",
    inputs: [],
    outputs: [{ type: "bytes32" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "hasRole",
    inputs: [{ type: "bytes32" }, { type: "address" }],
    outputs: [{ type: "bool" }],
    stateMutability: "view",
  },
  // --- ERC20 surface
  {
    type: "function",
    name: "name",
    inputs: [],
    outputs: [{ type: "string" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "symbol",
    inputs: [],
    outputs: [{ type: "string" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "decimals",
    inputs: [],
    outputs: [{ type: "uint8" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "totalSupply",
    inputs: [],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "balanceOf",
    inputs: [{ type: "address" }],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "transfer",
    inputs: [
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
    stateMutability: "nonpayable",
  },
  // --- NAV and the oracle rail
  {
    type: "function",
    name: "nav",
    inputs: [],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "reportedAUM",
    inputs: [],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "navUpdatedAt",
    inputs: [],
    outputs: [{ type: "uint64" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "railAnchorNav",
    inputs: [],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "railWindowStart",
    inputs: [],
    outputs: [{ type: "uint64" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "maxNavMoveBps",
    inputs: [],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "setNAV",
    inputs: [
      { name: "newNav", type: "uint256" },
      { name: "newReportedAUM", type: "uint256" },
      { name: "force", type: "bool" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  // --- investor entry points
  {
    type: "function",
    name: "minSubscription",
    inputs: [],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "subscribe",
    inputs: [{ name: "usdcAmount", type: "uint256" }],
    outputs: [{ name: "tokensOut", type: "uint256" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "redeem",
    inputs: [{ name: "tokenAmount", type: "uint256" }],
    outputs: [{ name: "usdcOut", type: "uint256" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "claimCoupon",
    inputs: [],
    outputs: [{ name: "usdcPaid", type: "uint256" }],
    stateMutability: "nonpayable",
  },
  // --- issuer entry points
  {
    type: "function",
    name: "distributeCoupon",
    inputs: [{ name: "usdcAmount", type: "uint256" }],
    outputs: [{ name: "distributionId", type: "uint256" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "paused",
    inputs: [],
    outputs: [{ type: "bool" }],
    stateMutability: "view",
  },
  // --- coupon accounting
  {
    type: "function",
    name: "couponIndex",
    inputs: [],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "totalDistributed",
    inputs: [],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "totalAllocated",
    inputs: [],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "totalClaimed",
    inputs: [],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "distributionCount",
    inputs: [],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "pendingCoupon",
    inputs: [{ type: "address" }],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
  // --- views the UI and this runner price against
  {
    type: "function",
    name: "registry",
    inputs: [],
    outputs: [{ type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "usdc",
    inputs: [],
    outputs: [{ type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "previewSubscribe",
    inputs: [{ name: "usdcAmount", type: "uint256" }],
    outputs: [{ name: "tokensOut", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "previewRedeem",
    inputs: [{ name: "tokenAmount", type: "uint256" }],
    outputs: [{ name: "usdcOut", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "vaultBalance",
    inputs: [],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "couponReserve",
    inputs: [],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "availableLiquidity",
    inputs: [],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "supplyBackedRatio",
    inputs: [],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
  // --- custom errors (viem decodes a revert only when its fragment is present)
  { type: "error", name: "NotEligible", inputs: [{ name: "account", type: "address" }] },
  {
    type: "error",
    name: "InsufficientLiquidity",
    inputs: [
      { name: "available", type: "uint256" },
      { name: "requested", type: "uint256" },
    ],
  },
  {
    type: "error",
    name: "BelowMinimum",
    inputs: [
      { name: "minimum", type: "uint256" },
      { name: "provided", type: "uint256" },
    ],
  },
  {
    type: "error",
    name: "NavMoveExceedsRail",
    inputs: [
      { name: "anchorNav", type: "uint256" },
      { name: "newNav", type: "uint256" },
      { name: "maxBps", type: "uint256" },
    ],
  },
  {
    type: "error",
    name: "DistributionExceedsNav",
    inputs: [
      { name: "perToken", type: "uint256" },
      { name: "nav", type: "uint256" },
    ],
  },
  {
    type: "error",
    name: "DistributionTooSmall",
    inputs: [
      { name: "usdcAmount", type: "uint256" },
      { name: "minimum", type: "uint256" },
    ],
  },
  { type: "error", name: "AmountTooLarge", inputs: [{ name: "amount", type: "uint256" }] },
  { type: "error", name: "InvalidNav", inputs: [] },
  { type: "error", name: "NoSupply", inputs: [] },
  { type: "error", name: "NothingToClaim", inputs: [] },
  { type: "error", name: "ZeroAmount", inputs: [] },
  { type: "error", name: "ZeroTokens", inputs: [] },
  { type: "error", name: "EnforcedPause", inputs: [] },
  {
    type: "error",
    name: "AccessControlUnauthorizedAccount",
    inputs: [
      { name: "account", type: "address" },
      { name: "neededRole", type: "bytes32" },
    ],
  },
  {
    type: "error",
    name: "ERC20InsufficientBalance",
    inputs: [
      { name: "sender", type: "address" },
      { name: "balance", type: "uint256" },
      { name: "needed", type: "uint256" },
    ],
  },
  {
    type: "error",
    name: "ERC20InsufficientAllowance",
    inputs: [
      { name: "spender", type: "address" },
      { name: "allowance", type: "uint256" },
      { name: "needed", type: "uint256" },
    ],
  },
] as const;

/** `contracts/src/IdentityRegistry.sol` — the on-chain whitelist. */
export const identityRegistryAbi = [
  {
    type: "function",
    name: "REGISTRAR_ROLE",
    inputs: [],
    outputs: [{ type: "bytes32" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "INVESTOR_PROFESSIONAL",
    inputs: [],
    outputs: [{ type: "uint8" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "hasRole",
    inputs: [{ type: "bytes32" }, { type: "address" }],
    outputs: [{ type: "bool" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "addVerified",
    inputs: [
      { name: "account", type: "address" },
      { name: "country", type: "uint16" },
      { name: "investorType", type: "uint8" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "isVerified",
    inputs: [{ type: "address" }],
    outputs: [{ type: "bool" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "canHold",
    inputs: [{ type: "address" }],
    outputs: [{ type: "bool" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "isCountryBlocked",
    inputs: [{ type: "uint16" }],
    outputs: [{ type: "bool" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "identityOf",
    inputs: [{ type: "address" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "verified", type: "bool" },
          { name: "country", type: "uint16" },
          { name: "investorType", type: "uint8" },
          { name: "verifiedAt", type: "uint64" },
        ],
      },
    ],
    stateMutability: "view",
  },
  { type: "error", name: "CountryBlocked", inputs: [{ name: "country", type: "uint16" }] },
  { type: "error", name: "InvalidCountry", inputs: [{ name: "country", type: "uint16" }] },
  { type: "error", name: "InvalidInvestorType", inputs: [{ name: "investorType", type: "uint8" }] },
  { type: "error", name: "RetailNotAllowed", inputs: [] },
  { type: "error", name: "NotRegistrar", inputs: [] },
  { type: "error", name: "NotVerified", inputs: [{ name: "account", type: "address" }] },
  { type: "error", name: "ZeroAddress", inputs: [] },
] as const;

/** `contracts/src/MockUSDC.sol` — six-decimal test settlement asset with a capped public faucet. */
export const mockUsdcAbi = [
  {
    type: "function",
    name: "name",
    inputs: [],
    outputs: [{ type: "string" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "symbol",
    inputs: [],
    outputs: [{ type: "string" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "decimals",
    inputs: [],
    outputs: [{ type: "uint8" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "FAUCET_CAP",
    inputs: [],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "balanceOf",
    inputs: [{ type: "address" }],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "allowance",
    inputs: [{ type: "address" }, { type: "address" }],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "faucetRemaining",
    inputs: [{ type: "address" }],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "approve",
    inputs: [
      { name: "spender", type: "address" },
      { name: "value", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "faucet",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "error",
    name: "FaucetAmountTooLarge",
    inputs: [
      { name: "amount", type: "uint256" },
      { name: "cap", type: "uint256" },
    ],
  },
  {
    type: "error",
    name: "FaucetDailyCapExceeded",
    inputs: [{ name: "remaining", type: "uint256" }],
  },
  { type: "error", name: "ZeroAmount", inputs: [] },
] as const;
