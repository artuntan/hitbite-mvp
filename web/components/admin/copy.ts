/**
 * Every sentence `/admin` says about a contract rule, in one place.
 *
 * An operator console is mostly copy. The buttons are trivial — one `writeContract` each — and the
 * thing that makes the difference between a safe operator and an unsafe one is whether the page
 * told them, before they signed, what the transaction is actually going to do. So the rules live
 * here as named constants, each traceable to the contract or to a numbered decision in PLAN.md,
 * rather than being scattered as JSX prose that nobody can grep for when the contract changes.
 *
 * Nothing in this file may claim a fact the contracts do not hold. Where a sentence states a
 * number, that number is read from the chain at render time and interpolated by the caller.
 */

/** The heading sentence: this console is a convenience layer, and says so. */
export const GATE_IS_NOT_A_BOUNDARY =
  "This console shows you only the actions your connected wallet holds the role for. That is a " +
  "convenience, not a security boundary. Nothing here protects the contracts: AccessControl does, " +
  "on chain, for every caller including one that never loads this page. Hiding a button stops a " +
  "mistake, not an attacker.";

export const CONSOLE_INTRO =
  "Operational controls for the hbTRS token and the identity registry. Every action below shows " +
  "the exact calldata it will send before you sign it, and the destructive ones ask you to type a " +
  "confirmation phrase first.";

/** Why the console can be opened by anybody. */
export const PUBLIC_PAGE_NOTE =
  "This page is public, like the contracts it talks to. A reader without a wallet sees the rules " +
  "and the roles each action needs; a reader with the wrong wallet sees the same and can sign " +
  "nothing that the contract would accept.";

// --------------------------------------------------------------------------- verification queue

export const QUEUE_INTRO =
  "Verification requests submitted through /verify and still waiting. Approving hands the address " +
  "to the registrar worker, the same server key and the same code path that the auto-approval " +
  "countdown uses; this console never calls addVerified itself.";

export const QUEUE_PRIVACY_NOTE =
  "A request holds an address, a declared ISO 3166-1 country code, an investor type and two " +
  "declarations. It holds no name and no other personal data (PLAN.md D59), and every field in it " +
  "becomes public on chain in the IdentityVerified event the moment it is approved.";

export const QUEUE_APPROVE_NOTE =
  "Approve runs the worker for this one address. The worker re-reads the country against the " +
  "registry before it signs, so a country blocked since the request was made is recorded as " +
  "blocked instead of sent, and an address the registry already holds is closed out with no " +
  "transaction at all.";

export const QUEUE_REJECT_NOTE =
  "Reject closes the request off chain. It sends no transaction and it does not touch the " +
  "registry: an address that is already verified stays verified. Rejecting is authorised by a " +
  "signature from a wallet holding REGISTRAR_ROLE, checked by the server against the registry, " +
  "because unlike every other action on this page there is no contract behind it to refuse a " +
  "caller who should not be here.";

export const QUEUE_NOT_DUE_NOTE =
  "The worker will not touch a request until AUTO_APPROVE_DELAY_MS has elapsed since it was " +
  "submitted. Until then, approving is a no-op that reports zero requests due.";

// --------------------------------------------------------------------------- blocklist

export const BLOCKLIST_INTRO =
  "IdentityRegistry.setCountryBlocked(country, blocked). The registry stores one ISO 3166-1 " +
  "numeric code per verified address and refuses addVerified for a blocked one.";

/** The surprising part, and the reason this card exists rather than a line in COMPLIANCE_RULES. */
export const BLOCKLIST_EXISTING_HOLDERS =
  "Blocking a country does not delete the records that already name it. Those addresses stay in " +
  "the registry with verified = true, but canHold becomes false for every one of them: they can " +
  "no longer receive a transfer or subscribe. They can still redeem and still claim coupons, " +
  "because the token deliberately does not check canHold on the way out (PLAN.md D4). Nothing is " +
  "trapped; receiving is what stops.";

export const BLOCKLIST_RANGE_NOTE =
  "Codes run 1 to 999. The registry reverts InvalidCountry outside that range, and it emits " +
  "CountryBlockStatusChanged on every write, including one that sets a code to the value it " +
  "already holds.";

// --------------------------------------------------------------------------- NAV

export const NAV_INTRO =
  "HBToken.setNAV(newNav, reportedAUM, force). NAV is a 6-decimal integer, the same integer the " +
  "engine publishes in nav.json and the same one every figure in this app is formatted from.";

export const NAV_RAIL_NOTE =
  "A non-forced update is checked against railAnchorNav — the NAV at the start of the current " +
  "24-hour window, not the previous call — so several small updates inside one window cannot " +
  "compound past the rail (PLAN.md D27). The move is computed below before you sign; the contract " +
  "reverts NavMoveExceedsRail if it breaches.";

export const NAV_WINDOW_ROLL_NOTE =
  "The window is about to roll. Whether the rail is measured against the current anchor or " +
  "against the current NAV depends on which block mines this transaction, and you cannot know " +
  "that in advance, so a move is only safe here if it clears both (PLAN.md D31).";

export const NAV_FORCE_NOTE =
  "force = true skips the rail entirely. It is DEFAULT_ADMIN_ROLE only, it emits NAVForced with " +
  "your address beside the old and new values, and it restarts the 24-hour rail window anchored " +
  "at the value you just wrote — so the next oracle update is measured from here, and the rail " +
  "you just stepped over is gone for the next day. Use it to correct a bad NAV, never to push one " +
  "the oracle refused. Ticking this changes the confirmation: the console asks you to type " +
  "FORCE NAV before it sends anything.";

export const NAV_PAUSED_NOTE =
  "setNAV works while the token is paused. It is deliberately outside the pause (PLAN.md D3): a " +
  "halted token still has to be able to report an honest value.";

// --------------------------------------------------------------------------- distribution

export const DISTRIBUTE_INTRO =
  "HBToken.distributeCoupon(usdcAmount) pulls test USDC from your wallet into the vault and " +
  "raises the cumulative coupon index so every holder can claim pro rata. You must approve the " +
  "token contract for the amount first.";

export const DISTRIBUTE_NAV_DROP =
  "NAV falls by the per-token amount at the moment of distribution, exactly as a fund's NAV falls " +
  "on the ex-distribution date (PLAN.md D26). reportedAUM falls by the USDC pulled, and the rail " +
  "anchor falls by the same per-token amount so the distribution does not consume the oracle's " +
  "rail budget for the day. This is not optional and it is not reversible.";

export const DISTRIBUTE_TRUNCATION_NOTE =
  "perToken = usdcAmount * 1e18 / totalSupply truncates, so a few units of USDC are never " +
  "allocated. Those stay in the vault as ordinary liquidity rather than in the coupon reserve " +
  "(PLAN.md D29).";

export const DISTRIBUTE_PAUSED_NOTE =
  "Distribution is blocked while the token is paused, and so is claiming.";

// --------------------------------------------------------------------------- pause

/** D3, in the order the contract enforces it. */
export const PAUSE_STOPS: readonly string[] = [
  "transfer — every holder-to-holder move",
  "subscribe — no new money in",
  "redeem — no money out",
  "mint and burn — including the issuer corrections on this page",
  "distributeCoupon — no new coupon can be paid in",
  "claimCoupon — holders cannot take coupons they are already owed",
];

export const PAUSE_KEEPS: readonly string[] = [
  "setNAV — the oracle keeps reporting, forced or not",
  "every IdentityRegistry change — addVerified, removeVerified, setCountryBlocked",
  "every view — balances, NAV, pendingCoupon and the transparency figures stay readable",
];

export const PAUSE_CLAIM_WARNING =
  "The part an operator must understand before clicking: a paused token will not let a holder " +
  "claim a coupon that is already accrued to them. Their money is safe in the vault and the index " +
  "still remembers it, but the claim reverts until you unpause. Pausing is a decision about other " +
  "people's access to their own coupons, not only about transfers.";

export const PAUSE_ISSUER_BURN_NOTE =
  "Issuer burns are not exempt from the pause (PLAN.md D3). To correct a balance on a paused " +
  "token: unpause, burn, re-pause.";

// --------------------------------------------------------------------------- mint / burn

export const SUPPLY_INTRO =
  "HBToken.mint and HBToken.burn are operational corrections — reversing a mistaken subscription, " +
  "fixing a balance after an off-chain error. Production issuance goes through subscribe and " +
  "production exit goes through redeem; neither of those is on this page.";

export const MINT_BACKING_WARNING =
  "Minting creates tokens and no USDC. The vault does not grow, liabilities do, and " +
  "supplyBackedRatio() falls the instant this transaction lands — the transparency page will show " +
  "the lower number on its next read. Mint only against money that arrived somewhere this " +
  "contract cannot see, and say where in your own records.";

export const MINT_ELIGIBILITY_NOTE =
  "mint goes through the same _update hook as a transfer, so the recipient must satisfy " +
  "canHold(to): verified in the registry and not in a blocked country. An unverified recipient " +
  "reverts NotEligible.";

export const BURN_WARNING =
  "Burn destroys tokens from an address without paying anything for them. The holder receives no " +
  "USDC — this is not a redemption. Their accrued coupon entitlement is settled first and stays " +
  "claimable, because the token settles the account before it changes the balance.";

export const BURN_NO_ELIGIBILITY_NOTE =
  "A burn does not check canHold on the holder (PLAN.md D4), so a de-verified or newly blocked " +
  "address can still be corrected.";

// --------------------------------------------------------------------------- the encoded call

export const ENCODED_CALL_NOTE =
  "This is the exact transaction data your wallet will be asked to sign, encoded here with viem " +
  "from the contract's own ABI. Check the selector and the arguments against the contract before " +
  "you confirm; a wallet that shows you something different is showing you a different " +
  "transaction.";

export const SIMULATION_NOTE =
  "Every write is simulated with eth_call against the current state before your wallet is asked " +
  "for anything, so a rule that would refuse this transaction is reported as a sentence rather " +
  "than as a failed transaction you paid for.";
