"use client";

/**
 * Mint and burn — operational corrections only.
 *
 * Production issuance goes through `subscribe` and production exit goes through `redeem`. These two
 * exist to fix mistakes, they emit their own events so they are auditable, and each one has a
 * consequence that is invisible in the form:
 *
 *  - **mint** creates tokens and no USDC, so `supplyBackedRatio()` falls the instant it lands. The
 *    transparency page will show the lower number on its next read, and it will be right.
 *  - **burn** destroys tokens and pays nothing for them. It is not a redemption, and the holder
 *    does not get USDC. What they do keep is their accrued coupon: the token settles the account
 *    before it changes the balance, so the entitlement survives the burn.
 *
 * Both read the chain about the address that was typed — `canHold` for a mint, the balance and the
 * pending coupon for a burn — so the gate that would revert is explained before the signature.
 */

import * as React from "react";
import { getAddress, isAddress, type Address } from "viem";
import { useReadContract } from "wagmi";

import { encodeCall, type EncodeResult } from "@/components/admin/calldata";
import { ActionCard, RuleNote } from "@/components/admin/action-card";
import { ConfirmDialog } from "@/components/admin/confirm-dialog";
import {
  BURN_NO_ELIGIBILITY_NOTE,
  BURN_WARNING,
  MINT_BACKING_WARNING,
  MINT_ELIGIBILITY_NOTE,
  SUPPLY_INTRO,
} from "@/components/admin/copy";
import { AdminField, AdminInput, FactList, FactRow } from "@/components/admin/fields";
import { getAction, permissionFor, type RoleHoldings } from "@/components/admin/roles";
import type { AdminChainState } from "@/components/admin/use-admin-chain";
import { Button } from "@/components/ui/button";
import { useTx } from "@/components/wallet/use-tx";
import { hbTokenAbi, identityRegistryAbi } from "@/lib/generated/abis";
import {
  MAX_INPUT,
  formatFixed,
  formatRatio1e18,
  formatTokens,
  formatTokensExact,
  formatUsdcExact,
  parseAmount,
} from "@/lib/format";
import { REQUIRED_CHAIN_ID } from "@/lib/wagmi";

export type SupplyMode = "mint" | "burn";

export interface SupplyCardProps {
  mode: SupplyMode;
  chain: AdminChainState;
  holdings: RoleHoldings;
  walletConnected: boolean;
  canSign: boolean;
}

export function SupplyCard({ mode, chain, holdings, walletConnected, canSign }: SupplyCardProps) {
  const minting = mode === "mint";
  const action = getAction(minting ? "mint" : "burn");
  const permission = permissionFor(action, holdings);
  const phrase = minting ? "MINT" : "BURN";

  const [addressText, setAddressText] = React.useState("");
  const [amountText, setAmountText] = React.useState("");
  const [confirming, setConfirming] = React.useState(false);

  const tx = useTx({
    action: minting ? "Mint" : "Burn",
    contract: "HBToken",
    successTitle: minting ? "Tokens minted" : "Tokens burned",
    onConfirmed: () => {
      setConfirming(false);
      chain.refresh();
    },
  });

  const trimmed = addressText.trim();
  const target: Address | null = isAddress(trimmed, { strict: false }) ? getAddress(trimmed) : null;
  const addressError =
    trimmed === "" || target !== null
      ? null
      : "Enter a 20-byte address: 0x followed by 40 hex characters.";

  const parsed = parseAmount(amountText, 18);
  const amount18 = parsed.ok ? parsed.value : null;
  const amountError = !parsed.ok
    ? amountText.trim() === ""
      ? null
      : parsed.error
    : amount18 === 0n
      ? "Enter an amount above zero."
      : // `burn` has no upper bound of its own — the holder's balance is the bound — but `mint`
        // rejects anything above the uint128 input bound before it touches the supply (PLAN.md D28).
        minting && amount18 !== null && amount18 > MAX_INPUT
        ? `mint reverts AmountTooLarge above MAX_INPUT (${MAX_INPUT.toString()} units).`
        : null;

  // ---- what the chain says about the address that was typed ------------------------------------
  const canHold = useReadContract({
    address: chain.addresses?.registry,
    abi: identityRegistryAbi,
    functionName: "canHold",
    args: target ? [target] : undefined,
    chainId: REQUIRED_CHAIN_ID,
    query: { enabled: minting && target !== null && chain.addresses !== null },
  });
  const balance = useReadContract({
    address: chain.addresses?.token,
    abi: hbTokenAbi,
    functionName: "balanceOf",
    args: target ? [target] : undefined,
    chainId: REQUIRED_CHAIN_ID,
    query: { enabled: !minting && target !== null && chain.addresses !== null },
  });
  const pendingCoupon = useReadContract({
    address: chain.addresses?.token,
    abi: hbTokenAbi,
    functionName: "pendingCoupon",
    args: target ? [target] : undefined,
    chainId: REQUIRED_CHAIN_ID,
    query: { enabled: !minting && target !== null && chain.addresses !== null },
  });

  const notEligible = minting && canHold.data === false;
  const overBalance =
    !minting && amount18 !== null && balance.data !== undefined && amount18 > balance.data;

  const paused = chain.token.paused === true;

  const encoded: EncodeResult | null =
    target === null || amount18 === null || amount18 === 0n || amountError !== null
      ? null
      : encodeCall({
          contract: "HBToken",
          address: chain.addresses?.token ?? null,
          abi: hbTokenAbi,
          functionName: minting ? "mint" : "burn",
          args: [
            { value: target, display: minting ? "recipient" : "holder" },
            { value: amount18, display: `${formatTokens(amount18, 6)} hbTRS` },
          ],
        });

  /**
   * Where the write goes. `null` when this network has no recorded deployment: the calldata above
   * is still real, but there is nowhere to send it, so nothing can be signed.
   */
  const to = encoded?.ok ? encoded.call.address : null;

  const ready =
    canSign &&
    permission === "allowed" &&
    to !== null &&
    !paused &&
    !notEligible &&
    !overBalance &&
    !tx.isBusy;

  return (
    <>
      <ActionCard
        id={minting ? "mint" : "burn"}
        action={action}
        permission={permission}
        walletConnected={walletConnected}
        title={minting ? "Mint a correction" : "Burn a correction"}
        description={SUPPLY_INTRO}
        encoded={encoded}
        tx={tx}
        confirmPhrase={phrase}
        footer={
          <>
            <Button variant="danger" disabled={!ready} onClick={() => setConfirming(true)}>
              {minting ? "Mint" : "Burn"}
            </Button>
            {paused ? (
              <span className="text-danger text-xs">
                The token is paused, so {minting ? "mint" : "burn"} reverts EnforcedPause. Unpause,
                correct, re-pause.
              </span>
            ) : null}
          </>
        }
      >
        <AdminField
          id={`admin-${mode}-address`}
          label={minting ? "Recipient" : "Holder"}
          error={addressError}
          hint={
            minting
              ? "Must satisfy canHold(to) — verified in the registry and not in a blocked country."
              : "No eligibility check applies to a burn, so a de-verified or newly blocked holder can still be corrected."
          }
          control={(props) => (
            <AdminInput
              {...props}
              mono="addr"
              placeholder="0x0000000000000000000000000000000000000000"
              value={addressText}
              invalid={addressError !== null}
              onChange={(event) => setAddressText(event.target.value)}
            />
          )}
        />

        <AdminField
          id={`admin-${mode}-amount`}
          label="Amount"
          error={amountError}
          hint="Eighteen decimals, the integer the token stores."
          control={(props) => (
            <AdminInput
              {...props}
              suffix="hbTRS"
              placeholder="1.0"
              inputMode="decimal"
              value={amountText}
              invalid={amountError !== null}
              onChange={(event) => setAmountText(event.target.value)}
            />
          )}
        />

        <FactList className="border-border bg-surface-sunken rounded-md border p-3">
          <FactRow
            label="Supply"
            value={
              chain.token.supply18 === null
                ? "—"
                : `${formatFixed(chain.token.supply18, 18, { displayDecimals: 4, rounding: "trunc" })} hbTRS`
            }
          />
          <FactRow
            label="Supply-backed ratio"
            value={
              chain.token.supplyBackedRatio18 === null
                ? "—"
                : formatRatio1e18(chain.token.supplyBackedRatio18)
            }
            tone={minting ? "warning" : undefined}
          />
          <FactRow
            label="Vault balance"
            value={
              chain.token.vaultBalance6 === null
                ? "—"
                : `${formatUsdcExact(chain.token.vaultBalance6)} USDC`
            }
          />
          {!minting && target !== null ? (
            <>
              <FactRow
                label="Holder balance"
                value={
                  balance.data === undefined ? "—" : `${formatTokensExact(balance.data)} hbTRS`
                }
                tone={overBalance ? "danger" : undefined}
              />
              <FactRow
                label="Holder pending coupon"
                value={
                  pendingCoupon.data === undefined
                    ? "—"
                    : `${formatUsdcExact(pendingCoupon.data)} USDC`
                }
              />
            </>
          ) : null}
          {minting && target !== null ? (
            <FactRow
              label="canHold(recipient)"
              value={canHold.data === undefined ? "—" : canHold.data ? "true" : "false"}
              tone={canHold.data === false ? "danger" : undefined}
              mono="addr"
            />
          ) : null}
        </FactList>

        {minting ? (
          <>
            <RuleNote tone="danger" title="Minting creates no USDC">
              {MINT_BACKING_WARNING}
            </RuleNote>
            <RuleNote>{MINT_ELIGIBILITY_NOTE}</RuleNote>
            {notEligible ? (
              <RuleNote tone="danger" title="The registry would refuse this recipient">
                <span className="addr">canHold</span> is false for this address, so{" "}
                <span className="addr">_update</span> reverts NotEligible. Verify it on{" "}
                <span className="addr">/verify</span>, or unblock its country, first.
              </RuleNote>
            ) : null}
          </>
        ) : (
          <>
            <RuleNote tone="danger" title="A burn is not a redemption">
              {BURN_WARNING}
            </RuleNote>
            <RuleNote>{BURN_NO_ELIGIBILITY_NOTE}</RuleNote>
            {overBalance && balance.data !== undefined ? (
              <RuleNote tone="danger" title="More than the holder has">
                This address holds {formatTokensExact(balance.data)} hbTRS, so the burn reverts
                ERC20InsufficientBalance.
              </RuleNote>
            ) : null}
          </>
        )}
      </ActionCard>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={minting ? "Mint a correction" : "Burn a correction"}
        description={
          minting
            ? "This creates tokens against no money."
            : "This destroys tokens and pays nothing for them."
        }
        tone="danger"
        phrase={phrase}
        confirmLabel={minting ? "Mint the tokens" : "Burn the tokens"}
        encoded={encoded}
        busy={tx.isBusy}
        consequences={[
          amount18 !== null && target !== null ? (
            <>
              <span className="num">{formatTokensExact(amount18)}</span> hbTRS{" "}
              {minting ? "are created for" : "are destroyed from"}{" "}
              <span className="addr">{target}</span>.
            </>
          ) : null,
          minting ? (
            <>
              No USDC is created. supplyBackedRatio() falls immediately and the transparency page
              will show the lower number on its next read.
            </>
          ) : (
            <>
              The holder receives nothing. Their accrued coupon is settled first and stays
              claimable.
            </>
          ),
          minting
            ? "OperationalMint is emitted, so this is auditable as a correction rather than a subscription."
            : "OperationalBurn is emitted, so this is auditable as a correction rather than a redemption.",
          "Production issuance goes through subscribe and production exit through redeem. This is neither.",
        ].filter(Boolean)}
        onConfirm={() => {
          if (to === null || target === null || amount18 === null) return;
          void tx.send({
            address: to,
            abi: hbTokenAbi,
            functionName: minting ? "mint" : "burn",
            args: [target, amount18],
          });
        }}
      />
    </>
  );
}
