"use client";

/**
 * `/subscribe` — BUILD_PROMPT 7.2.
 *
 * The whole flow in one place: read the chain, quote the mint, explain every gate, approve, then
 * subscribe.
 *
 * Three decisions are worth knowing before reading the code.
 *
 *  1. **The chain is the authority, and when it is silent the page says so.** The minimum, the NAV
 *     and the pause flag are read from the deployed token, never assumed from a constant. Where the
 *     active chain has no deployment, or the RPC will not answer, the actions are disabled and the
 *     quote is relabelled *indicative* against the engine's published NAV — visible arithmetic, no
 *     pretence that anything can be signed.
 *  2. **Approval is remembered by the chain, not by the browser.** `allowance` is a read, so a
 *     reload between the two transactions resumes exactly where it stopped, and somebody who
 *     already has a sufficient allowance is never asked to approve again. The amount box is kept in
 *     `sessionStorage` so the reload does not cost them their typing either.
 *  3. **A gate is a sentence, not a disabled button.** `buildGates` produces the whole checklist,
 *     passing and failing alike, each row naming the contract rule behind it.
 */

import * as React from "react";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { parseEventLogs } from "viem";
import { useAccount } from "wagmi";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AmountField } from "@/components/subscribe/amount-field";
import { FaucetCard } from "@/components/subscribe/faucet-card";
import { GateList } from "@/components/subscribe/gate-list";
import { QuoteCard } from "@/components/subscribe/quote-card";
import { SuccessCard, type SettledSubscription } from "@/components/subscribe/success-card";
import {
  buildGates,
  buildQuote,
  publishedNav,
  readAmount,
  readFaucet,
  readiness,
  resolveNav,
  type PublishedFacts,
  type ReadState,
} from "@/components/subscribe/quote";
import {
  DEPLOYED_ADDRESSES,
  HAS_DEPLOYMENT,
  useSubscribeChainState,
} from "@/components/subscribe/use-chain-state";
import { WalletConnectButton } from "@/components/wallet/connect-button";
import {
  ConnectPrompt,
  WrongNetworkAlert,
  useNetworkStatus,
  type NetworkStatus,
} from "@/components/wallet/network-guard";
import { TxStatus, TxStepList, type TxStep } from "@/components/wallet/tx-status";
import { useTx } from "@/components/wallet/use-tx";
import { ACTIVE_CHAIN } from "@/lib/chains";
import { TOKEN } from "@/lib/copy";
import { getCountryByNumeric } from "@/lib/countries";
import { formatUsdcExact } from "@/lib/format";
import { hbTokenAbi, mockUsdcAbi } from "@/lib/generated/abis";

/** Survives a reload between approve and subscribe. Session-scoped: an amount is not a preference. */
const AMOUNT_STORAGE_KEY = "hitbite.subscribe.amount";

export interface SubscribeFlowProps {
  published: PublishedFacts;
}

export function SubscribeFlow({ published }: SubscribeFlowProps) {
  const network = useNetworkStatus();
  const { address } = useAccount();
  const { state: chain, refresh } = useSubscribeChainState(address);

  const amountRef = React.useRef<HTMLInputElement | null>(null);

  // ---- the amount, restored after a reload ------------------------------------------------------
  const [amountText, setAmountText] = React.useState("");
  const [restored, setRestored] = React.useState(false);

  React.useEffect(() => {
    try {
      const saved = window.sessionStorage.getItem(AMOUNT_STORAGE_KEY);
      if (saved !== null) setAmountText(saved);
    } catch {
      // A browser with storage disabled loses the draft and nothing else.
    }
    setRestored(true);
  }, []);

  React.useEffect(() => {
    if (!restored) return;
    try {
      if (amountText.trim() === "") window.sessionStorage.removeItem(AMOUNT_STORAGE_KEY);
      else window.sessionStorage.setItem(AMOUNT_STORAGE_KEY, amountText);
    } catch {
      // ditto
    }
  }, [amountText, restored]);

  // ---- a clock the faucet window can be compared against ---------------------------------------
  // `null` until mounted: a server render has no meaningful "now" to compare a window against, and
  // guessing one would make the first client paint disagree with the server's.
  const [nowSec, setNowSec] = React.useState<bigint | null>(null);
  React.useEffect(() => {
    const tick = () => setNowSec(BigInt(Math.floor(Date.now() / 1000)));
    tick();
    const timer = window.setInterval(tick, 30_000);
    return () => window.clearInterval(timer);
  }, []);

  // ---- quote and gates --------------------------------------------------------------------------
  const amount = readAmount(amountText);
  const nav = resolveNav(chain, publishedNav(BigInt(published.navUsdc6), published.asOf));
  const quote = buildQuote(amount, nav);
  const gates = buildGates({
    network: network.status,
    requiredChainLabel: network.requiredChainLabel,
    currentChainLabel: network.currentChainLabel,
    currentChainId: network.chainId,
    chain,
    amount,
  });
  const ready = readiness(gates);
  const faucet = readFaucet(chain, nowSec);

  // ---- the three writes -------------------------------------------------------------------------
  const countryName = React.useCallback(
    (code: number) => getCountryByNumeric(code)?.name ?? null,
    [],
  );

  const faucetTx = useTx({
    action: "Faucet",
    contract: "MockUSDC",
    successTitle: "Test USDC minted",
    onConfirmed: refresh,
  });

  const approve = useTx({
    action: "Approve USDC",
    contract: "MockUSDC",
    successTitle: "Allowance approved",
    successMessage: "The token contract may now move exactly this amount of your test USDC.",
    onConfirmed: refresh,
    countryName,
  });

  const subscribe = useTx({
    action: "Subscribe",
    contract: "HBToken",
    successTitle: "Subscription confirmed",
    onConfirmed: refresh,
    countryName,
  });

  const busy = approve.isBusy || subscribe.isBusy;

  const onFaucet = React.useCallback(() => {
    const mintable = faucet.mintable6;
    if (!DEPLOYED_ADDRESSES || address === undefined || mintable === null || mintable <= 0n) return;
    void faucetTx.send({
      address: DEPLOYED_ADDRESSES.usdc,
      abi: mockUsdcAbi,
      functionName: "faucet",
      args: [address, mintable],
    });
  }, [address, faucet.mintable6, faucetTx]);

  const onApprove = React.useCallback(() => {
    if (!DEPLOYED_ADDRESSES || amount.value6 === null) return;
    void approve.send({
      address: DEPLOYED_ADDRESSES.usdc,
      abi: mockUsdcAbi,
      functionName: "approve",
      // Exactly the amount being subscribed. An unlimited approval would be one less click and a
      // standing permission to move every test dollar in the wallet; on a demo whose whole point is
      // the compliance model, the narrower allowance is the honest default.
      args: [DEPLOYED_ADDRESSES.token, amount.value6],
    });
  }, [amount.value6, approve]);

  const onSubscribe = React.useCallback(() => {
    if (!DEPLOYED_ADDRESSES || amount.value6 === null) return;
    void subscribe.send({
      address: DEPLOYED_ADDRESSES.token,
      abi: hbTokenAbi,
      functionName: "subscribe",
      args: [amount.value6],
    });
  }, [amount.value6, subscribe]);

  const onFocusAmount = React.useCallback(() => amountRef.current?.focus(), []);

  const onSubscribeAgain = React.useCallback(() => {
    approve.reset();
    subscribe.reset();
    setAmountText("");
    refresh();
  }, [approve, subscribe, refresh]);

  // ---- what actually settled --------------------------------------------------------------------
  const settled = React.useMemo<SettledSubscription | null>(() => {
    const receipt = subscribe.receipt;
    if (!receipt || !DEPLOYED_ADDRESSES) return null;
    const token = DEPLOYED_ADDRESSES.token.toLowerCase();
    const logs = parseEventLogs({ abi: hbTokenAbi, eventName: "Subscribed", logs: receipt.logs });
    const mine = logs.find((log) => log.address.toLowerCase() === token);
    if (!mine) return null;
    return {
      usdcIn6: mine.args.usdcIn,
      tokensOut18: mine.args.tokensOut,
      nav6: mine.args.nav,
    };
  }, [subscribe.receipt]);

  // ---- the two steps ----------------------------------------------------------------------------
  const amountLabel =
    amount.value6 === null ? "the amount" : `${formatUsdcExact(amount.value6)} USDC`;

  // Until a wallet is connected the allowance is unknown, and the honest default is to present the
  // flow as the two transactions it is for a first-time subscriber. Showing one step and a
  // "Subscribe" button would imply a single signature and then grow a second one on connect.
  const approveFirst = ready.needsApproval || chain.allowance6 === null;
  const showApproveStep = approveFirst || approve.phase !== "idle";

  const steps: TxStep[] = [
    ...(showApproveStep
      ? [
          {
            id: "approve",
            label: "Approve USDC",
            description: `Lets the ${TOKEN.symbol} contract move ${amountLabel} out of your wallet. ERC-20 allowances are per spender and persist, so this is signed once per amount, not once per session.`,
            state: approve.state,
            link: approve.link,
          },
        ]
      : []),
    {
      id: "subscribe",
      label: "Subscribe",
      description: `Sends ${amountLabel} into the vault and mints ${TOKEN.symbol} to your address at the NAV in the block that includes it.`,
      state: subscribe.state,
      link: subscribe.link,
    },
  ];

  const confirmed = subscribe.isConfirmed;
  const flowDisabledReason = chainIsUnusable(chain.reads) ? chain.reason : null;

  return (
    <div className="flex flex-col gap-6">
      {flowDisabledReason ? (
        <Alert tone="warning" data-testid="chain-unavailable">
          <AlertTitle>
            {chain.reads === "no-deployment"
              ? `hbTRS is not deployed on ${ACTIVE_CHAIN.label}`
              : `The contracts on ${ACTIVE_CHAIN.label} could not be read`}
          </AlertTitle>
          <AlertDescription>
            <p>{flowDisabledReason}</p>
            <p className="mt-2">
              Nothing here can be signed. The quote below is kept visible and marked{" "}
              <strong>indicative</strong>: it is computed from the NAV the engine published for{" "}
              {published.asOf}, with the same truncating arithmetic the contract uses, so the
              numbers can still be checked — but it is not a price anything would settle at.
            </p>
          </AlertDescription>
        </Alert>
      ) : null}

      {network.status === "disconnected" ? <ConnectPrompt purpose="to subscribe" /> : null}
      {network.status === "wrong-network" ? <WrongNetworkAlert network={network} /> : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle as="h2">Subscribe in test USDC</CardTitle>
              <CardDescription>
                Subscriptions settle at the net asset value in the block that includes them. Two
                transactions the first time — an ERC-20 approval, then the subscription itself.
              </CardDescription>
            </CardHeader>

            <CardContent className="flex flex-col gap-5">
              <AmountField
                value={amountText}
                onChange={setAmountText}
                reading={amount}
                inputRef={amountRef}
                minimum6={chain.minSubscription6}
                balance6={chain.usdcBalance6}
                disabled={confirmed}
              />

              {confirmed ? (
                <SuccessCard
                  settled={settled}
                  hash={subscribe.hash}
                  link={subscribe.link}
                  onSubscribeAgain={onSubscribeAgain}
                />
              ) : (
                <>
                  {!ready.needsApproval &&
                  chain.allowance6 !== null &&
                  chain.allowance6 > 0n &&
                  amount.value6 !== null ? (
                    <Alert tone="info" data-testid="allowance-covers">
                      <AlertTitle>No approval needed</AlertTitle>
                      <AlertDescription>
                        An allowance of {formatUsdcExact(chain.allowance6)} USDC is already on chain
                        for the {TOKEN.symbol} contract, so this is a one-transaction subscription.
                        That is read from the chain rather than remembered here, which is why
                        reloading this page — or coming back to it tomorrow — never makes you
                        approve twice.
                      </AlertDescription>
                    </Alert>
                  ) : null}

                  <div className="flex flex-wrap items-center gap-3">
                    {approveFirst ? (
                      <Button
                        variant="primary"
                        size="lg"
                        onClick={onApprove}
                        disabled={!ready.canApprove || busy}
                        data-testid="primary-action"
                        data-action="approve"
                      >
                        Approve {amountLabel}
                        <ArrowRight aria-hidden="true" />
                      </Button>
                    ) : (
                      <Button
                        variant="primary"
                        size="lg"
                        onClick={onSubscribe}
                        disabled={!ready.canSubscribe || busy}
                        data-testid="primary-action"
                        data-action="subscribe"
                      >
                        Subscribe {amountLabel}
                        <ArrowRight aria-hidden="true" />
                      </Button>
                    )}

                    {ready.blockers.length > 0 ? (
                      <p className="text-muted text-sm" data-testid="blocker-summary">
                        {describeBlockers(ready.blockers.map((gate) => gate.label))}
                      </p>
                    ) : null}
                  </div>

                  <TxStepList steps={steps} />

                  <TxStatus
                    tx={approve}
                    onRetry={onApprove}
                    retryLabel="Approve again"
                    onReset={approve.reset}
                  />
                  <TxStatus
                    tx={subscribe}
                    onRetry={onSubscribe}
                    retryLabel="Subscribe again"
                    onReset={subscribe.reset}
                  />
                </>
              )}
            </CardContent>
          </Card>

          <Card data-testid="gate-card">
            <CardHeader>
              <CardTitle as="h2">What has to be true</CardTitle>
              <CardDescription>
                Every condition <span className="num">subscribe</span> imposes, in the order the
                contract checks them. All of them are enforced on-chain; this list only reads them
                back so nothing has to be learned from a reverted transaction.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <GateList
                gates={gates}
                onSwitchNetwork={network.switchToRequiredChain}
                onFaucet={faucet.status === "available" ? onFaucet : undefined}
                onFocusAmount={onFocusAmount}
                connectControl={<WalletConnectButton size="sm" showNetwork={false} />}
              />
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col gap-6">
          <QuoteCard quote={quote} minimum6={chain.minSubscription6} published={published} />

          <FaucetCard
            faucet={faucet}
            balance6={chain.usdcBalance6}
            tx={faucetTx}
            onMint={onFaucet}
            onReset={faucetTx.reset}
            busy={faucetTx.isBusy}
            enabled={HAS_DEPLOYMENT && network.status === "ready"}
            disabledReason={faucetDisabledReason(network.status)}
          />

          <Card>
            <CardHeader>
              <CardTitle as="h3">Not verified yet?</CardTitle>
              <CardDescription>
                hbTRS is whitelisted on-chain. An address has to be in the identity registry before
                it can receive a single token, and that is checked inside the contract, not here.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild variant="secondary">
                <Link href="/verify">Go to verification</Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function chainIsUnusable(reads: ReadState): boolean {
  return reads === "no-deployment" || reads === "error";
}

function faucetDisabledReason(status: NetworkStatus): string | null {
  if (!HAS_DEPLOYMENT) {
    return `There is no test USDC contract recorded on ${ACTIVE_CHAIN.label}, so there is nothing to mint from.`;
  }
  if (status === "disconnected" || status === "connecting") {
    return "Connect a wallet to mint test USDC to its address.";
  }
  if (status === "wrong-network") {
    return `Switch to ${ACTIVE_CHAIN.label} first — the faucet lives on that chain.`;
  }
  return null;
}

/**
 * "Waiting on 2 things: wallet connected, enough test USDC." — the button's reason, in words.
 *
 * Only the first letter is lowered. Lowercasing the whole label would turn "Connected to Anvil
 * (local)" into "connected to anvil (local)", and a chain name is a proper noun.
 */
function describeBlockers(labels: readonly string[]): string {
  if (labels.length === 0) return "";
  const listed = labels.map(uncapitalise).join(", ");
  if (labels.length === 1) return `Waiting on one thing: ${listed}.`;
  return `Waiting on ${labels.length} things: ${listed}.`;
}

function uncapitalise(label: string): string {
  return label.charAt(0).toLowerCase() + label.slice(1);
}
