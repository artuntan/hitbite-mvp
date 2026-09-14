// GENERATED FILE — DO NOT EDIT.
// Written by web/scripts/sync-contracts.ts; re-run `pnpm sync:contracts` from web/ after `forge build`.
// Committed on purpose: the Vercel build root is web/ and cannot run forge.
// Source: contracts/deployments/anvil.json

/**
 * Deployments keyed by chain id. `deployBlock` is carried through because the event indexer
 * (PLAN.md D10) scans from it rather than from genesis.
 *
 * Only testnet chain ids can appear here: sync-contracts.ts rejects anything else, and
 * `lib/chains.ts` re-checks this object against the `SupportedChainId` union, so a mainnet
 * deployment file fails the build twice over.
 */
export const deployments = {
  /** anvil — recorded 2026-09-14T21:18:10.000Z. */
  31337: {
    chainId: 31337,
    network: "anvil",
    deployBlock: 1,
    timestamp: 1789420690,
    addresses: {
      HBToken: "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0",
      IdentityRegistry: "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512",
      MockUSDC: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
    },
    txHashes: {
      HBToken: "0x5e8ed126a35a187a3706300d6b4cf231dbac1942d71b22aa74a11955811872cb", // allow-secret
      IdentityRegistry: "0x655a04e5c450053f20ab76c44e188ab99c5cb97bf79f17b24134d82cc74b578d", // allow-secret
      MockUSDC: "0x7cb11b44d2b9c6042e400eee24161d536c5c628680d0680f65055ea21d1c63bd", // allow-secret
    },
  },
} as const;

/** Chain ids that actually have a recorded deployment (`never` when none do). */
export type DeployedChainId = keyof typeof deployments;
