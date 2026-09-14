// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {HBToken} from "../../../src/HBToken.sol";
import {IdentityRegistry} from "../../../src/IdentityRegistry.sol";
import {MockUSDC} from "../../../src/MockUSDC.sol";

/// @notice Stateful handler driving `HBToken` for the invariant suite (BUILD_PROMPT 5.5, PLAN.md Phase 2).
///
/// @dev Design rules this handler follows:
///
///      - **Bounded actor set.** Five actors, three verified at start-up, two not. `addVerified` / `removeVerified`
///        / `setCountryBlocked` move accounts in and out of eligibility mid-run, so the fuzzer regularly holds
///        tokens in an account that can no longer send or receive them (D4: it can still redeem and claim).
///      - **No revert storms.** Every action bounds its inputs with `bound()` and returns early when the
///        precondition cannot be met, instead of letting the call revert or leaning on `vm.assume`. The suite runs
///        with `fail_on_revert = true`, so any revert reaching the fuzzer is a genuine finding, and every call the
///        fuzzer makes either changes state or is a deliberate, counted skip.
///      - **Ghost accounting.** `ghostMinted` / `ghostBurned` / `ghostDistributed` / `ghostClaimed` are maintained
///        independently of the contract so the invariants can compare the two.
///      - **Coverage tracking.** `attempted` / `landed` per action plus `totalCalls` / `landedCalls`, so the
///        invariant test can assert at the end of a run that the sequence actually exercised the contract.
///
///      The handler funds actors from its own USDC balance (the invariant test deals it a large balance in
///      `setUp`) rather than from the faucet, whose per-window cap would throttle the run.
contract HBTokenHandler is Test {
    // ------------------------------------------------------------------ system under test
    HBToken public immutable TOKEN;
    MockUSDC public immutable USDC;
    IdentityRegistry public immutable REGISTRY;
    address public immutable ADMIN;
    address public immutable ISSUER;
    address public immutable ORACLE;
    address public immutable REGISTRAR;

    // ------------------------------------------------------------------ bounds
    /// @dev Per-call subscription ceiling: 1,000,000 USDC.
    uint256 internal constant MAX_SUBSCRIBE = 1_000_000e6;
    /// @dev Per-call operational mint ceiling: 1,000,000 hbTRS.
    uint256 internal constant MAX_MINT = 1_000_000e18;
    /// @dev Mirrors HBToken.MAX_INPUT (D28).
    uint256 internal constant MAX_INPUT = type(uint128).max;
    uint256 internal constant TOKEN_SCALE = 1e18;
    uint256 internal constant MAX_BPS = 10_000;
    /// @dev A coupon never pays out more than 1/100 of NAV per token, so NAV stays far from the
    ///      `DistributionExceedsNav` floor however many distributions a run makes.
    uint256 internal constant COUPON_NAV_DIVISOR = 100;
    /// @dev `pause()` only actually pauses on one attempt in 25: a paused contract blocks almost every other
    ///      action, so pausing on every attempt would spend most of the run in a state where nothing lands. Over a
    ///      full campaign this still pauses and unpauses the token dozens of times.
    uint256 internal constant PAUSE_ODDS = 25;
    /// @dev Floor on the number of whitelisted actors; see `removeVerified`.
    uint256 internal constant MIN_VERIFIED_ACTORS = 2;

    // ------------------------------------------------------------------ actors
    /// @dev What an action needs from the actor it picks; see `_scan`.
    enum Requirement {
        Eligible, // the whitelist lets it receive tokens
        Holder, // holds tokens (eligible or not: burns and redemptions are open to de-verified holders, D4)
        EligibleHolder, // holds tokens and may still transfer them
        Owed, // has a claimable coupon
        Registered // has a registry record, blocked country or not
    }

    address[] public actors;
    /// @dev Countries the handler moves actors between. 840 / 792 stay blocked from deployment and are never used.
    uint16[3] public countries = [uint16(276), 784, 826];

    // ------------------------------------------------------------------ ghosts
    uint256 public ghostMinted;
    uint256 public ghostBurned;
    uint256 public ghostDistributed;
    uint256 public ghostClaimed;
    uint256 public ghostSubscribedUsdc;
    uint256 public ghostRedeemedUsdc;

    // ------------------------------------------------------------------ coverage counters
    mapping(bytes32 action => uint256 count) public attempted;
    mapping(bytes32 action => uint256 count) public landed;
    uint256 public totalCalls;
    uint256 public landedCalls;

    constructor(
        HBToken token_,
        MockUSDC usdc_,
        IdentityRegistry registry_,
        address admin_,
        address issuer_,
        address oracle_,
        address registrar_
    ) {
        TOKEN = token_;
        USDC = usdc_;
        REGISTRY = registry_;
        ADMIN = admin_;
        ISSUER = issuer_;
        ORACLE = oracle_;
        REGISTRAR = registrar_;

        for (uint256 i; i < 5; ++i) {
            address actor = makeAddr(string.concat("invariantActor", vm.toString(i)));
            actors.push(actor);
        }
    }

    // ==================================================================
    // investor actions
    // ==================================================================

    function subscribe(uint256 actorSeed, uint256 amount) external {
        _attempt("subscribe");
        if (TOKEN.paused()) return;
        address actor = _eligibleActor(actorSeed);
        if (actor == address(0)) return;

        uint256 minimum = TOKEN.minSubscription();
        uint256 low = minimum == 0 ? 1 : minimum;
        if (low > MAX_SUBSCRIBE) return;
        amount = bound(amount, low, MAX_SUBSCRIBE);
        if (TOKEN.previewSubscribe(amount) == 0) return;
        if (USDC.balanceOf(address(this)) < amount) return;

        USDC.transfer(actor, amount);
        vm.prank(actor);
        USDC.approve(address(TOKEN), amount);
        vm.prank(actor);
        uint256 tokensOut = TOKEN.subscribe(amount);

        ghostMinted += tokensOut;
        ghostSubscribedUsdc += amount;
        _land("subscribe");
    }

    function redeem(uint256 actorSeed, uint256 tokenAmount) external {
        _attempt("redeem");
        if (TOKEN.paused()) return;
        address actor = _holderActor(actorSeed);
        if (actor == address(0)) return;
        uint256 balance = TOKEN.balanceOf(actor);

        // Cap at what the vault can pay without touching the coupon reserve (D6), then bound *inside* that cap so
        // a redemption takes a fuzzed slice rather than always draining the vault. `InsufficientLiquidity` is a
        // unit-tested revert path, not something the fuzzer needs to rediscover.
        uint256 cap = TOKEN.availableLiquidity() * TOKEN_SCALE / TOKEN.nav();
        if (cap == 0) return;
        if (cap > balance) cap = balance;
        if (cap > MAX_INPUT) cap = MAX_INPUT;
        tokenAmount = bound(tokenAmount, 1, cap);
        if (TOKEN.previewRedeem(tokenAmount) == 0) return;

        vm.prank(actor);
        uint256 usdcOut = TOKEN.redeem(tokenAmount);

        ghostBurned += tokenAmount;
        ghostRedeemedUsdc += usdcOut;
        _land("redeem");
    }

    function transfer(uint256 fromSeed, uint256 toSeed, uint256 amount) external {
        _attempt("transfer");
        if (TOKEN.paused()) return;
        address from = _eligibleHolderActor(fromSeed);
        if (from == address(0)) return;
        address to = _eligibleActorOtherThan(toSeed, from);
        if (to == address(0)) return;
        uint256 balance = TOKEN.balanceOf(from);

        vm.prank(from);
        TOKEN.transfer(to, bound(amount, 1, balance));
        _land("transfer");
    }

    function claimCoupon(uint256 actorSeed) external {
        _attempt("claimCoupon");
        if (TOKEN.paused()) return;
        address actor = _owedActor(actorSeed);
        if (actor == address(0)) return;

        vm.prank(actor);
        uint256 paid = TOKEN.claimCoupon();

        ghostClaimed += paid;
        _land("claimCoupon");
    }

    // ==================================================================
    // issuer actions
    // ==================================================================

    function distributeCoupon(uint256 amount) external {
        _attempt("distributeCoupon");
        if (TOKEN.paused()) return;
        uint256 supply = TOKEN.totalSupply();
        if (supply == 0) return;

        uint256 low = (supply + TOKEN_SCALE - 1) / TOKEN_SCALE; // perToken >= 1 (D29)
        uint256 high = (TOKEN.nav() / COUPON_NAV_DIVISOR) * supply / TOKEN_SCALE;
        if (high > MAX_INPUT) high = MAX_INPUT;
        if (high < low) return;

        amount = bound(amount, low, high);
        if (USDC.balanceOf(address(this)) < amount) return;

        USDC.transfer(ISSUER, amount);
        vm.prank(ISSUER);
        USDC.approve(address(TOKEN), amount);
        vm.prank(ISSUER);
        TOKEN.distributeCoupon(amount);

        ghostDistributed += amount;
        _land("distributeCoupon");
    }

    function mint(uint256 actorSeed, uint256 amount) external {
        _attempt("mint");
        if (TOKEN.paused()) return;
        address actor = _eligibleActor(actorSeed);
        if (actor == address(0)) return;

        amount = bound(amount, 1, MAX_MINT);
        vm.prank(ISSUER);
        TOKEN.mint(actor, amount);

        ghostMinted += amount;
        _land("mint");
    }

    function burn(uint256 actorSeed, uint256 amount) external {
        _attempt("burn");
        if (TOKEN.paused()) return;
        address actor = _holderActor(actorSeed);
        if (actor == address(0)) return;
        uint256 balance = TOKEN.balanceOf(actor);

        amount = bound(amount, 1, balance);
        vm.prank(ISSUER);
        TOKEN.burn(actor, amount);

        ghostBurned += amount;
        _land("burn");
    }

    function pause(uint256 seed) external {
        _attempt("pause");
        if (TOKEN.paused()) return;
        if (bound(seed, 0, PAUSE_ODDS - 1) != 0) return;

        vm.prank(ISSUER);
        TOKEN.pause();
        _land("pause");
    }

    function unpause() external {
        _attempt("unpause");
        if (!TOKEN.paused()) return;

        vm.prank(ISSUER);
        TOKEN.unpause();
        _land("unpause");
    }

    // ==================================================================
    // oracle action
    // ==================================================================

    /// @dev Advances the clock by up to 8 h before each update, so a run crosses `RAIL_WINDOW` boundaries and the
    ///      anchor re-anchors the way it does in production. The proposed NAV is bounded to the rail band around
    ///      the anchor the contract will use, so the update always lands (the rail's reject path is fuzzed
    ///      exhaustively in `HBToken.fuzz.t.sol`).
    function setNAV(uint256 navSeed, uint256 timeJump) external {
        _attempt("setNAV");
        vm.warp(block.timestamp + bound(timeJump, 0, 8 hours));

        uint256 anchor = TOKEN.railAnchorNav();
        if (block.timestamp >= uint256(TOKEN.railWindowStart()) + TOKEN.RAIL_WINDOW()) anchor = TOKEN.nav();
        uint256 band = anchor * TOKEN.maxNavMoveBps() / MAX_BPS;
        uint256 low = anchor > band ? anchor - band : 1;
        uint256 high = anchor + band;
        if (high > MAX_INPUT) high = MAX_INPUT;
        if (high < low) return;

        uint256 newNav = bound(navSeed, low, high);
        uint256 reportedAum = TOKEN.totalSupply() * newNav / TOKEN_SCALE;
        if (reportedAum > MAX_INPUT) reportedAum = MAX_INPUT;

        vm.prank(ORACLE);
        TOKEN.setNAV(newNav, reportedAum, false);
        _land("setNAV");
    }

    // ==================================================================
    // registry actions
    // ==================================================================

    function addVerified(uint256 actorSeed, uint256 countrySeed) external {
        _attempt("addVerified");
        address actor = _actor(actorSeed);
        uint16 country = countries[bound(countrySeed, 0, countries.length - 1)];
        if (REGISTRY.isCountryBlocked(country)) return;

        // Read the constant before pranking: an external call in the argument list would consume the prank.
        uint8 professional = REGISTRY.INVESTOR_PROFESSIONAL();
        vm.prank(REGISTRAR);
        REGISTRY.addVerified(actor, country, professional);
        _land("addVerified");
    }

    /// @dev Keeps at least `MIN_VERIFIED_ACTORS` accounts on the whitelist. De-verifying everybody would be a
    ///      legal state, but the run would then spend the rest of its depth unable to mint, subscribe or transfer,
    ///      which proves nothing. Holders still lose eligibility while holding tokens, which is the case D4 is
    ///      about.
    function removeVerified(uint256 actorSeed) external {
        _attempt("removeVerified");
        if (_verifiedCount() <= MIN_VERIFIED_ACTORS) return;
        address actor = _verifiedActor(actorSeed);
        if (actor == address(0)) return;

        vm.prank(REGISTRAR);
        REGISTRY.removeVerified(actor);
        _land("removeVerified");
    }

    /// @dev At most one of the three countries is blocked at a time: blocking all of them would freeze every holder
    ///      and spend the rest of the run in a state where nothing can land. The seed therefore chooses which
    ///      country to block while none is blocked, and releases the blocked one otherwise, so every call is a real
    ///      state change and holders regularly lose and regain eligibility while holding tokens (D4).
    function setCountryBlocked(uint256 countrySeed, bool unblockSooner) external {
        _attempt("setCountryBlocked");
        uint16 country = countries[bound(countrySeed, 0, countries.length - 1)];
        bool blocked = true;
        for (uint256 i; i < countries.length; ++i) {
            if (REGISTRY.isCountryBlocked(countries[i])) {
                // Something is already blocked: release it, unless the seed asks to leave it blocked one more turn.
                if (!unblockSooner && countries[i] != country) return;
                country = countries[i];
                blocked = false;
                break;
            }
        }

        vm.prank(ADMIN);
        REGISTRY.setCountryBlocked(country, blocked);
        _land("setCountryBlocked");
    }

    // ==================================================================
    // views used by the invariants
    // ==================================================================

    function actorList() external view returns (address[] memory) {
        return actors;
    }

    /// @dev Sum of every actor's balance. Tokens can only ever reach an actor (mints and transfers target the actor
    ///      set), so this must equal `totalSupply()`.
    function totalActorBalance() external view returns (uint256 total) {
        uint256 length = actors.length;
        for (uint256 i; i < length; ++i) {
            total += TOKEN.balanceOf(actors[i]);
        }
    }

    /// @dev Sum of every actor's claimable coupon, settled part included.
    function totalPendingCoupon() external view returns (uint256 total) {
        uint256 length = actors.length;
        for (uint256 i; i < length; ++i) {
            total += TOKEN.pendingCoupon(actors[i]);
        }
    }

    // ==================================================================
    // internal
    // ==================================================================

    function _actor(uint256 seed) internal view returns (address) {
        return actors[bound(seed, 0, actors.length - 1)];
    }

    /// @dev The actor set is small, so an action whose precondition the seeded actor happens not to meet would
    ///      waste most of the run. These selectors start at the seeded index and rotate, so the choice stays
    ///      fuzz-driven while the action still lands whenever *some* actor can perform it. Returning
    ///      `address(0)` means no actor qualifies and the action is a genuine skip.
    function _scan(uint256 seed, Requirement requirement) internal view returns (address) {
        uint256 length = actors.length;
        uint256 start = bound(seed, 0, length - 1);
        for (uint256 i; i < length; ++i) {
            address actor = actors[(start + i) % length];
            if (requirement == Requirement.Eligible && REGISTRY.canHold(actor)) return actor;
            if (requirement == Requirement.Holder && TOKEN.balanceOf(actor) > 0) return actor;
            if (requirement == Requirement.EligibleHolder && TOKEN.balanceOf(actor) > 0 && REGISTRY.canHold(actor)) {
                return actor;
            }
            if (requirement == Requirement.Owed && TOKEN.pendingCoupon(actor) > 0) return actor;
            if (requirement == Requirement.Registered && REGISTRY.isVerified(actor)) return actor;
        }
        return address(0);
    }

    function _eligibleActor(uint256 seed) internal view returns (address) {
        return _scan(seed, Requirement.Eligible);
    }

    function _holderActor(uint256 seed) internal view returns (address) {
        return _scan(seed, Requirement.Holder);
    }

    function _eligibleHolderActor(uint256 seed) internal view returns (address) {
        return _scan(seed, Requirement.EligibleHolder);
    }

    function _owedActor(uint256 seed) internal view returns (address) {
        return _scan(seed, Requirement.Owed);
    }

    function _verifiedActor(uint256 seed) internal view returns (address) {
        return _scan(seed, Requirement.Registered);
    }

    /// @dev An eligible actor that is not `excluded`, for the receiving side of a transfer.
    function _eligibleActorOtherThan(uint256 seed, address excluded) internal view returns (address) {
        uint256 length = actors.length;
        uint256 start = bound(seed, 0, length - 1);
        for (uint256 i; i < length; ++i) {
            address actor = actors[(start + i) % length];
            if (actor != excluded && REGISTRY.canHold(actor)) return actor;
        }
        return address(0);
    }

    function _verifiedCount() internal view returns (uint256 count) {
        uint256 length = actors.length;
        for (uint256 i; i < length; ++i) {
            if (REGISTRY.isVerified(actors[i])) ++count;
        }
    }

    function _attempt(bytes32 action) internal {
        ++attempted[action];
        ++totalCalls;
    }

    function _land(bytes32 action) internal {
        ++landed[action];
        ++landedCalls;
    }
}
