# `demo/` — the end-to-end demo runner

One command drives a live deployment through the whole product and writes down what happened:

```sh
make demo                     # CHAIN=anvil by default
make demo CHAIN=base-sepolia  # against the public testnet, with the founders' keys
```

It runs the eight-step scenario in [`BUILD_PROMPT.md` section 9](../BUILD_PROMPT.md), asserts the
outcome of every step against exact integers, and writes [`REPORT.md`](./REPORT.md) — every
transaction hash, the balances before and after, each assertion with its expected and actual value,
and the timing. That report, not a green tick in a terminal, is the artefact a reviewer reads.

TypeScript and [viem](https://viem.sh) run through [`tsx`](https://tsx.is) (PLAN.md D11), with its
own `package.json` so nothing here can affect the web app's dependency tree.

## The eight steps, and what each one proves

| #   | What happens                                                                                                                                                | What is asserted                                                                                                                                                                                                            |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | The registrar verifies wallet A (784, United Arab Emirates) and wallet B (276, Germany) as professional investors, then tries wallet C (840, United States) | Both records read back from the registry; the third attempt reverts `CountryBlocked(840)` **on chain**, and wallet C is still unverified                                                                                    |
| 2   | The `MockUSDC` faucet funds A and B                                                                                                                         | Each wallet holds at least what it is about to subscribe                                                                                                                                                                    |
| 3   | A subscribes 1,000 USDC, B subscribes 500 USDC at NAV 1.000000                                                                                              | `previewSubscribe` and the minted amount agree: exactly 1,000 and 500 hbTRS, for exactly 1,000.000000 and 500.000000 USDC; supply is 1,500 hbTRS                                                                            |
| 4   | The oracle publishes NAV 1.0043                                                                                                                             | On-chain NAV is `1004300`; the +43 bp move sits inside the 500 bp rail without `force`                                                                                                                                      |
| 5   | The issuer distributes a 12.00 USDC coupon; A and B claim                                                                                                   | The coupon index rises by exactly 0.008000 USDC per token; A accrues **8.000000** and B **4.000000** USDC — exactly 2:1 — both claims pay exactly that, the two sum to 12.000000, and NAV drops to 0.996300 ex-distribution |
| 6   | A transfers 100 hbTRS to B, then tries the same to C                                                                                                        | Both balances move by exactly 100 hbTRS; the transfer to C reverts `NotEligible(C)` on chain and C still holds nothing                                                                                                      |
| 7   | B redeems 200 hbTRS                                                                                                                                         | `previewRedeem` quotes 199.260000 USDC at the post-distribution NAV, and the USDC that arrives equals that quote exactly                                                                                                    |
| 8   | Write the report                                                                                                                                            | —                                                                                                                                                                                                                           |

A revert in steps 1 and 6 is the _result_, not an error. The runner simulates the call to decode the
custom error by name and argument, then sends the transaction anyway with an explicit gas limit, so
the chain holds a real reverted transaction the report can point at.

Step 5 is the heart of it. The whole scenario is arranged so that the coupon split is a pair of
exact integers rather than an approximation, and the assertion is `===` on those integers.

## Re-running it

The run is idempotent (PLAN.md D11). A **preflight** brings the deployment to the state the scenario
starts from and reports, line by line, what it had to undo:

- a wallet already verified with the same country and investor type is not verified again;
- a wallet that already holds enough test USDC does not call the faucet, and one that does not is
  topped up by the difference, inside the faucet's 10,000 USDC per-address 24 h cap (PLAN.md D14);
- any coupon an earlier run left unclaimed is claimed, and any hbTRS still held is redeemed, so both
  demo wallets start flat — otherwise step 5's exact split would drift with each run;
- the on-chain NAV is put back to the opening 1.000000, exactly what `make seed` does with
  `SEED_NAV`. The oracle does it when the 5% rail allows; when repeated runs inside one 24 h window
  have walked the rail anchor too far for step 4's move (each distribution lowers the anchor by the
  per-token coupon, PLAN.md D26/D27), the admin re-anchors the window with `force` instead.

On a freshly deployed chain every one of those is a no-op, and the report says so. The consequence
is worth stating plainly: **every run asserts the same expected integers** — 1,000 and 500 hbTRS
minted, 8.000000 and 4.000000 USDC claimed, 199.260000 USDC redeemed — rather than whatever the
chain happens to hold that day.

The preflight refuses to continue, before sending anything, if: the token is paused; a role key does
not hold its role; a signing account has no gas; wallets A, B and C are not three distinct
addresses; wallet C can hold hbTRS; or hbTRS is held by anyone other than the demo wallets (the 2:1
split assertion only holds when A and B are the only holders — give the demo a deployment of its
own).

## Configuration

Everything comes from the environment; see [`.env.example`](../.env.example). Nothing is read from,
or written to, a file in this directory.

| Variable                                                            | Used for                                                                                                                 |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `CHAIN`                                                             | `anvil` (default) or `base-sepolia`. Any other value aborts before a client is built.                                    |
| `DEMO_RPC_URL`                                                      | Endpoint override. `make demo` passes the Makefile's `RPC_URL` here.                                                     |
| `ANVIL_RPC_URL`, `ANVIL_HOST`, `ANVIL_PORT`                         | Endpoint for `CHAIN=anvil` (default `http://127.0.0.1:8545`).                                                            |
| `BASE_SEPOLIA_RPC_URL`                                              | Endpoint for `CHAIN=base-sepolia`. Required there.                                                                       |
| `DEMO_WALLET_A_PRIVATE_KEY`, `..._B_...`, `..._C_...`               | The three investor wallets. Wallet C never signs and needs no gas: it only ever appears as a rejected counterparty.      |
| `REGISTRAR_PRIVATE_KEY`, `ISSUER_PRIVATE_KEY`, `ORACLE_PRIVATE_KEY` | The three role signers; each falls back to `DEPLOYER_PRIVATE_KEY`.                                                       |
| `DEPLOYER_PRIVATE_KEY`                                              | Fallback for the role keys, and the DEFAULT_ADMIN_ROLE signer the preflight uses to re-anchor the oracle rail. Optional. |

Contract addresses are read from `contracts/deployments/<chain>.json`, written by
`make deploy CHAIN=<chain>`. The runner checks that the record's `chainId` matches the chain the
endpoint reports, that `HBToken` really points at the registry and USDC recorded next to it, and
that the chain id is neither a mainnet nor anything other than 31337 or 84532 — three times, before
anything is sent (BUILD_PROMPT section 2, PLAN.md D32).

**On Anvil only**, an unset key falls back to one of the node's published development accounts,
which are used _by address_ over `eth_sendTransaction`: the runner never holds a key at all, and no
private key appears in any file in this repository. Off Anvil, a missing key is an error that names
the variable.

Only the _host_ of the endpoint is written to the report: a provider URL can carry an API key, and
the report is committed.

Every transaction is sent with a fixed 500,000 gas limit rather than an estimate. The heaviest call
in the scenario uses about 152,000, and an estimate is computed against the state before the
transaction is mined: one Anvil run was handed 62,790 gas for a `setNAV` that needs 65,315 and died
`OutOfGas` on a call that had just simulated cleanly. Only gas actually burned is paid for, and the
report shows the real `gasUsed` from each receipt.

## Running it without `make`

```sh
pnpm -C demo install --frozen-lockfile
CHAIN=anvil DEMO_RPC_URL=http://127.0.0.1:8545 pnpm -C demo demo
```

Other scripts: `pnpm -C demo typecheck` (`tsc --noEmit`), `pnpm -C demo lint` (Prettier + types),
`pnpm -C demo format`.

## When it fails

An assertion that does not hold stops the run immediately, prints the expected and actual values,
**still writes `REPORT.md`** with the failure and everything that had already happened, and exits
non-zero. A configuration problem does the same before anything is sent. A demo that can only
produce a green report is not evidence of anything.

## Files

| File                                        |                                                                                 |
| ------------------------------------------- | ------------------------------------------------------------------------------- |
| `run.ts`                                    | Entry point: configure, preflight, run the eight steps, always write the report |
| `steps/preflight.ts`                        | Checks, and the restoration that makes a re-run identical                       |
| `steps/01-verify.ts` … `steps/07-redeem.ts` | One file per step                                                               |
| `report.ts`                                 | The run's ledger, the assertion helpers, and the Markdown renderer              |
| `context.ts`                                | Clients, `confirm`, `expectRevert`, balance snapshots                           |
| `config.ts`                                 | Environment, chain guards, deployment record, actor resolution                  |
| `spec.ts`                                   | The exact integers section 9 fixes, with the arithmetic behind each one         |
| `abi.ts`                                    | The slice of each contract's interface the runner uses, custom errors included  |

---

Testnet demonstration. Simulated portfolio and attestation. Not an offer of securities.
