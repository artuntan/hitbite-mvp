"use client";

/**
 * `/portfolio` — BUILD_PROMPT 7.2.
 *
 * Balance, value at NAV, cost basis from events, the pending coupon and its claim, a redemption with
 * a preview and a liquidity check, the history with filters, and the CSV export.
 *
 * Four decisions are worth knowing before reading the code.
 *
 *  1. **Every number is the chain's or an event's.** `balanceOf`, `nav`, `pendingCoupon`,
 *     `availableLiquidity`, `vaultBalance` and `couponReserve` are read from the deployed token;
 *     the cost basis is folded from this address's own `Subscribed` events. Nothing is carried over
 *     from the published documents: with no deployment there is no balance to value, and the page
 *     says so rather than quoting a NAV against a position it cannot read.
 *  2. **Getting out is never gated on eligibility.** `redeem` and `claimCoupon` are open to a
 *     de-verified holder by design (PLAN.md D4, COMPLIANCE_RULES section 4). This page reads
 *     `canHold` to *explain* an address's status and never to disable an exit.
 *  3. **The liquidity check happens before the signature.** `previewRedeem` and
 *     `availableLiquidity()` are both read while the amount is being typed, so somebody asking for
 *     more than the vault can pay is told with both numbers instead of paying gas for
 *     `InsufficientLiquidity` to tell them.
 *  4. **The history is fetched once and everything else is a view of it.** The cost basis folds the
 *     same array the table paints and the CSV exports, so the three cannot disagree.
 */

import * as React from "react";
import Link from "next/link";
import { parseEventLogs, type Address } from "viem";
import { useAccount } from "wagmi";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AddressPicker } from "@/components/portfolio/address-picker";
import { costBasisFor } from "@/components/portfolio/cost-basis";
import { CostBasisCard } from "@/components/portfolio/cost-basis-card";
import { CouponCard } from "@/components/portfolio/coupon-card";
import { HistoryCard } from "@/components/portfolio/history-card";
import { PositionCard } from "@/components/portfolio/position-card";
import { RedeemCard, type SettledRedemption } from "@/components/portfolio/redeem-card";
import {
  buildRedeemGates,
  buildRedeemQuote,
  claimReadiness,
  maxRedeemableTokens18,
  readTokenAmount,
  redeemReadiness,
  tokenAmountText,
} from "@/components/portfolio/position";
import {
  DEPLOYED_ADDRESSES,
  usePortfolioChainState,
  usePreviewRedeem,
} from "@/components/portfolio/use-portfolio-chain";
import { useAccountHistory } from "@/components/portfolio/use-account-history";
import { WalletConnectButton } from "@/components/wallet/connect-button";
import {
  ConnectPrompt,
  WrongNetworkAlert,
  useNetworkStatus,
} from "@/components/wallet/network-guard";
import { useTx } from "@/components/wallet/use-tx";
import { ACTIVE_CHAIN, ACTIVE_CHAIN_ID } from "@/lib/chains";
import { TOKEN } from "@/lib/copy";
import { getCountryByNumeric } from "@/lib/countries";
import { formatAddress } from "@/lib/format";
import { hbTokenAbi } from "@/lib/generated/abis";

/** An `eth_call` per distinct amount, so the box is allowed to settle first. */
const PREVIEW_DEBOUNCE_MS = 300;

export interface PortfolioViewProps {
  /** `?address=0x…`, already validated by the server component. */
  initialAddress: string | null;
}

export function PortfolioView({ initialAddress }: PortfolioViewProps) {
  const network = useNetworkStatus();
  const { address } = useAccount();
  const [viewing, setViewing] = React.useState<string | null>(initialAddress);

  const account = (viewing ?? address ?? null) as Address | null;
  const ownAddress =
    account !== null && address !== undefined && account.toLowerCase() === address.toLowerCase();

  const { state: chain, refresh } = usePortfolioChainState(account ?? undefined);
  const history = useAccountHistory(account);
  const { reload } = history;

  // ---- the address in the URL -------------------------------------------------------------------
  // `history.replaceState` rather than the router: the address is a view of this page, not a new
  // one, and a shareable URL should not cost a server round trip on every look-up.
  const setViewedAddress = React.useCallback((next: string | null) => {
    setViewing(next);
    try {
      const url = new URL(window.location.href);
      if (next === null) url.searchParams.delete("address");
      else url.searchParams.set("address", next);
      window.history.replaceState(null, "", url.toString());
    } catch {
      // A browser that refuses the history API still gets the right view; only the URL lags.
    }
  }, []);

  // ---- cost basis -------------------------------------------------------------------------------
  const basis = React.useMemo(
    () =>
      account === null || history.phase !== "ready"
        ? null
        : costBasisFor(history.events, account, {
            balance18: chain.balance18,
            nav6: chain.nav6,
            historyComplete: history.complete,
          }),
    [account, history.phase, history.events, history.complete, chain.balance18, chain.nav6],
  );

  // ---- the redeem box ---------------------------------------------------------------------------
  const [amountText, setAmountText] = React.useState("");
  const amount = readTokenAmount(amountText);

  const [debounced, setDebounced] = React.useState<bigint | null>(null);
  const amountValue18 = amount.value18;
  React.useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(amountValue18), PREVIEW_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [amountValue18]);

  const preview6 = usePreviewRedeem(debounced);
  // Only quote the chain's answer when it is an answer about the amount currently in the box.
  const chainPreview6 = debounced !== null && debounced === amountValue18 ? preview6 : null;

  const quote = buildRedeemQuote(amount, chain, chainPreview6);
  const maxRedeemable18 = maxRedeemableTokens18(
    chain.availableLiquidity6,
    chain.nav6,
    chain.balance18,
  );
  const gates = buildRedeemGates({
    network: network.status,
    requiredChainLabel: network.requiredChainLabel,
    currentChainLabel: network.currentChainLabel,
    currentChainId: network.chainId,
    chain,
    amount,
    quote,
    ownAddress,
  });
  const redeemReady = redeemReadiness(gates);
  const claimReady = claimReadiness(chain, network.status, ownAddress);

  // ---- the two writes ---------------------------------------------------------------------------
  const countryName = React.useCallback(
    (code: number) => getCountryByNumeric(code)?.name ?? null,
    [],
  );

  const onWriteConfirmed = React.useCallback(() => {
    refresh();
    reload();
  }, [refresh, reload]);

  const claimTx = useTx({
    action: "Claim coupon",
    contract: "HBToken",
    successTitle: "Coupon claimed",
    onConfirmed: onWriteConfirmed,
    countryName,
  });

  const redeemTx = useTx({
    action: "Redeem",
    contract: "HBToken",
    successTitle: "Redemption confirmed",
    onConfirmed: onWriteConfirmed,
    countryName,
  });

  const onClaim = React.useCallback(() => {
    if (!DEPLOYED_ADDRESSES) return;
    void claimTx.send({
      address: DEPLOYED_ADDRESSES.token,
      abi: hbTokenAbi,
      functionName: "claimCoupon",
    });
  }, [claimTx]);

  const onRedeem = React.useCallback(() => {
    if (!DEPLOYED_ADDRESSES || amount.value18 === null) return;
    void redeemTx.send({
      address: DEPLOYED_ADDRESSES.token,
      abi: hbTokenAbi,
      functionName: "redeem",
      args: [amount.value18],
    });
  }, [amount.value18, redeemTx]);

  const onRedeemReset = React.useCallback(() => {
    redeemTx.reset();
    setAmountText("");
    refresh();
  }, [redeemTx, refresh]);

  // ---- what actually settled (PLAN.md D66: read the log, never echo the quote) -------------------
  const claimedUsdc6 = React.useMemo(() => {
    const receipt = claimTx.receipt;
    if (!receipt || !DEPLOYED_ADDRESSES) return null;
    const token = DEPLOYED_ADDRESSES.token.toLowerCase();
    const logs = parseEventLogs({
      abi: hbTokenAbi,
      eventName: "CouponClaimed",
      logs: receipt.logs,
    });
    const mine = logs.find((log) => log.address.toLowerCase() === token);
    return mine ? mine.args.usdcAmount : null;
  }, [claimTx.receipt]);

  const settledRedemption = React.useMemo<SettledRedemption | null>(() => {
    const receipt = redeemTx.receipt;
    if (!receipt || !DEPLOYED_ADDRESSES) return null;
    const token = DEPLOYED_ADDRESSES.token.toLowerCase();
    const logs = parseEventLogs({ abi: hbTokenAbi, eventName: "Redeemed", logs: receipt.logs });
    const mine = logs.find((log) => log.address.toLowerCase() === token);
    if (!mine) return null;
    return { tokensIn18: mine.args.tokensIn, usdcOut6: mine.args.usdcOut, nav6: mine.args.nav };
  }, [redeemTx.receipt]);

  // ---- render ------------------------------------------------------------------------------------
  const chainUnusable = chain.reads === "no-deployment" || chain.reads === "error";

  return (
    <div className="flex flex-col gap-6">
      {chainUnusable && chain.reason !== null ? (
        <Alert tone="warning" data-testid="chain-unavailable">
          <AlertTitle>
            {chain.reads === "no-deployment"
              ? `${TOKEN.symbol} is not deployed on ${ACTIVE_CHAIN.label}`
              : `The contracts on ${ACTIVE_CHAIN.label} could not be read`}
          </AlertTitle>
          <AlertDescription>
            <p>{chain.reason}</p>
            <p className="mt-2">
              Nothing here can be signed, and no balance, coupon or liquidity figure can be shown.
              There is no published document that could stand in for them: a position is an address
              on a chain, and without the chain there is nothing to report.
            </p>
          </AlertDescription>
        </Alert>
      ) : null}

      {network.status === "wrong-network" ? <WrongNetworkAlert network={network} /> : null}

      <Card>
        <CardHeader>
          <CardTitle as="h2">Whose position</CardTitle>
          <CardDescription>
            {account === null
              ? "Connect a wallet, or look up any address — every figure on this page is public chain state."
              : ownAddress
                ? "Showing the connected wallet."
                : "Showing an address you are not connected as. Read-only."}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {account !== null ? (
            <p className="addr text-ink text-sm" data-testid="viewed-address">
              {account}
            </p>
          ) : null}
          <AddressPicker
            viewing={viewing}
            connected={address}
            onView={setViewedAddress}
            onClear={() => setViewedAddress(null)}
          />
        </CardContent>
      </Card>

      {account === null ? (
        <>
          <ConnectPrompt purpose="to see what it holds, what it is owed and what it cost" />
          <Card data-testid="no-wallet-explainer">
            <CardHeader>
              <CardTitle as="h2">What this page shows once there is an address</CardTitle>
              <CardDescription>
                Nothing here is stored: every figure is read from the chain or folded from this
                address&rsquo;s own events, on demand.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="text-muted list-disc space-y-2 pl-5 text-sm">
                <li>
                  The {TOKEN.symbol} balance from <span className="num">balanceOf</span>, and its
                  value as <span className="num">balance × nav / 1e18</span> — the contract&rsquo;s
                  own arithmetic.
                </li>
                <li>
                  The pending coupon from <span className="num">pendingCoupon(address)</span>, and a
                  claim. The contract settles coupons lazily, so this figure is read, never
                  recomputed here.
                </li>
                <li>
                  A cost basis folded from this address&rsquo;s{" "}
                  <span className="num">Subscribed</span> events, with what it excludes stated
                  beside it.
                </li>
                <li>
                  A redemption, quoted with <span className="num">previewRedeem</span> and checked
                  against <span className="num">availableLiquidity()</span> before your wallet is
                  asked for anything.
                </li>
                <li>Every event naming the address, filterable, with a CSV export.</li>
              </ul>
            </CardContent>
          </Card>
        </>
      ) : (
        <>
          {!ownAddress ? (
            <Alert tone="info" data-testid="read-only-banner">
              <AlertTitle>Read-only view of {formatAddress(account)}</AlertTitle>
              <AlertDescription>
                Balances, coupons, cost basis and history are public chain state, so they are all
                shown. Claiming and redeeming are not offered:{" "}
                <span className="num">claimCoupon</span> pays the caller and{" "}
                <span className="num">redeem</span> burns from the signer, so only the wallet
                holding this position can act on it.
              </AlertDescription>
            </Alert>
          ) : null}

          {chain.canHold === false ? (
            <Alert tone="warning" data-testid="not-verified-notice">
              <AlertTitle>This address is not currently verified</AlertTitle>
              <AlertDescription>
                <p>
                  The registry says it cannot receive {TOKEN.symbol}
                  {chain.identity && chain.identity.country !== 0
                    ? ` (recorded country ${chain.identity.country}${
                        getCountryByNumeric(chain.identity.country)
                          ? `, ${getCountryByNumeric(chain.identity.country)?.name}`
                          : ""
                      })`
                    : ""}
                  , so it cannot subscribe or be sent tokens.{" "}
                  <strong>It can still redeem and claim.</strong> The token skips the eligibility
                  check on a burn and <span className="num">claimCoupon</span> checks nothing at
                  all: receiving is the restriction that matters for a whitelisted security, and
                  trapping somebody&rsquo;s money because a record was removed is never the right
                  outcome (COMPLIANCE_RULES section 4).
                </p>
                <p className="mt-2">
                  <Button asChild variant="secondary" size="sm">
                    <Link href="/verify">Request verification</Link>
                  </Button>
                </p>
              </AlertDescription>
            </Alert>
          ) : null}

          <PositionCard chain={chain} basis={basis} historyReady={history.phase === "ready"} />

          <div className="grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
            <RedeemCard
              chain={chain}
              amountText={amountText}
              onAmountChange={setAmountText}
              amount={amount}
              quote={quote}
              gates={gates}
              readiness={redeemReady}
              maxRedeemable18={maxRedeemable18}
              tx={redeemTx}
              busy={redeemTx.isBusy}
              confirmed={redeemTx.isConfirmed}
              settled={settledRedemption}
              onRedeem={onRedeem}
              onReset={onRedeemReset}
              onSwitchNetwork={network.switchToRequiredChain}
              onUseBalance={() =>
                setAmountText(chain.balance18 === null ? "" : tokenAmountText(chain.balance18))
              }
              onUseMaxLiquidity={() =>
                setAmountText(maxRedeemable18 === null ? "" : tokenAmountText(maxRedeemable18))
              }
              connectControl={<WalletConnectButton size="sm" showNetwork={false} />}
            />

            <CouponCard
              pending6={chain.pendingCoupon6}
              readiness={claimReady}
              tx={claimTx}
              busy={claimTx.isBusy}
              confirmed={claimTx.isConfirmed}
              settled6={claimedUsdc6}
              onClaim={onClaim}
              onReset={claimTx.reset}
            />
          </div>

          {basis !== null ? (
            <CostBasisCard basis={basis} complete={basis.complete} />
          ) : (
            <Card data-testid="cost-basis-pending">
              <CardHeader>
                <CardTitle as="h2">Cost basis</CardTitle>
                <CardDescription>
                  {history.phase === "loading"
                    ? "Folding this address's Subscribed events."
                    : "A cost basis needs the event history, and the index could not be read on this chain. Nothing is shown rather than a figure built on a partial fold."}
                </CardDescription>
              </CardHeader>
            </Card>
          )}

          <HistoryCard history={history} account={account} chainId={ACTIVE_CHAIN_ID} />
        </>
      )}
    </div>
  );
}
