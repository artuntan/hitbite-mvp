"use client";

/**
 * Set NAV, with the rail warning arriving before the signature (BUILD_PROMPT 7.2, PLAN.md D5/D27).
 *
 * The whole point of this card is the order of events. The rail check is the contract's own integer
 * comparison, run against `railAnchorNav` and `maxNavMoveBps` read from the deployed token, and it
 * runs as the number is typed — so an operator learns that a move breaches the rail while they can
 * still change it, not from a reverted transaction.
 *
 * `force` is treated as what it is: a DEFAULT_ADMIN_ROLE override that skips the rail, emits
 * `NAVForced` with the sender's address, and restarts the 24-hour window anchored at the new value.
 * Turning it on changes the card's tone, its action (a different role), and its confirmation (a
 * typed phrase), because the interface should make it feel as serious as it is.
 */

import * as React from "react";

import { encodeCall, type EncodeResult } from "@/components/admin/calldata";
import {
  NAV_FORCE_NOTE,
  NAV_INTRO,
  NAV_PAUSED_NOTE,
  NAV_RAIL_NOTE,
  NAV_WINDOW_ROLL_NOTE,
} from "@/components/admin/copy";
import { ActionCard, RuleNote } from "@/components/admin/action-card";
import { ConfirmDialog } from "@/components/admin/confirm-dialog";
import {
  AdminCheckbox,
  AdminField,
  AdminInput,
  FactList,
  FactRow,
  QuickFills,
} from "@/components/admin/fields";
import {
  assessNavMove,
  checkNavInput,
  checkReportedAumInput,
  suggestedReportedAum6,
  type RailAssessment,
} from "@/components/admin/nav-rail";
import { getAction, permissionFor, type RoleHoldings } from "@/components/admin/roles";
import { useNowSeconds } from "@/components/admin/use-now";
import type { AdminChainState } from "@/components/admin/use-admin-chain";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/badge";
import { useTx } from "@/components/wallet/use-tx";
import { hbTokenAbi } from "@/lib/generated/abis";
import {
  MAX_INPUT,
  formatBasisPoints,
  formatFixed,
  formatUsdc,
  formatUsdcExact,
  formatUnixSeconds,
  parseAmount,
} from "@/lib/format";

const FORCE_PHRASE = "FORCE NAV";

export interface NavCardProps {
  chain: AdminChainState;
  holdings: RoleHoldings;
  walletConnected: boolean;
  canSign: boolean;
}

export function NavCard({ chain, holdings, walletConnected, canSign }: NavCardProps) {
  const nowSeconds = useNowSeconds();
  const token = chain.token;

  const [navText, setNavText] = React.useState("");
  const [aumText, setAumText] = React.useState("");
  const [force, setForce] = React.useState(false);
  const [confirming, setConfirming] = React.useState(false);

  const action = getAction(force ? "force-nav" : "set-nav");
  const permission = permissionFor(action, holdings);

  const tx = useTx({
    action: force ? "Forced NAV update" : "NAV update",
    contract: "HBToken",
    successTitle: "NAV updated",
    onConfirmed: () => {
      setConfirming(false);
      chain.refresh();
    },
  });

  // ---- what was typed ---------------------------------------------------------------------------
  const navParsed = parseAmount(navText, 6);
  const aumParsed = parseAmount(aumText, 6);
  const nav6 = navParsed.ok ? navParsed.value : null;
  const aum6 = aumParsed.ok ? aumParsed.value : null;

  const navInput = nav6 === null ? null : checkNavInput(nav6);
  const navError = !navParsed.ok
    ? navText.trim() === ""
      ? null
      : navParsed.error
    : navInput && !navInput.ok
      ? navInput.reason
      : null;
  const aumError = !aumParsed.ok
    ? aumText.trim() === ""
      ? null
      : aumParsed.error
    : aum6 !== null && !checkReportedAumInput(aum6)
      ? `reportedAUM is bounded by MAX_INPUT (${MAX_INPUT.toString()} units), above which setNAV reverts AmountTooLarge.`
      : null;

  // ---- the rail ---------------------------------------------------------------------------------
  const railReadable =
    token.nav6 !== null &&
    token.anchor6 !== null &&
    token.windowStart !== null &&
    token.railWindow !== null &&
    token.maxBps !== null &&
    nowSeconds !== null;

  const rail: RailAssessment | null =
    railReadable && nav6 !== null && navInput?.ok === true
      ? assessNavMove(nav6, {
          nav6: token.nav6!,
          anchor6: token.anchor6!,
          windowStart: token.windowStart!,
          railWindow: token.railWindow!,
          maxBps: token.maxBps!,
          nowSeconds: nowSeconds!,
        })
      : null;

  const breaches = rail !== null && rail.verdict !== "inside";
  const railBlocks = breaches && !force;

  // ---- the call ---------------------------------------------------------------------------------
  const encoded: EncodeResult | null =
    nav6 === null || aum6 === null || navError !== null || aumError !== null
      ? null
      : encodeCall({
          contract: "HBToken",
          address: chain.addresses?.token ?? null,
          abi: hbTokenAbi,
          functionName: "setNAV",
          args: [
            { value: nav6, display: `${formatUsdcExact(nav6)} USDC per token` },
            { value: aum6, display: `${formatUsdc(aum6)} USDC reported AUM` },
            { value: force, display: force ? "skip the rail (NAVForced)" : "rail enforced" },
          ],
        });

  /**
   * Where the write goes. `null` when this network has no recorded deployment: the calldata above
   * is still real, but there is nowhere to send it, so nothing can be signed.
   */
  const to = encoded?.ok ? encoded.call.address : null;

  const ready = canSign && permission === "allowed" && to !== null && !railBlocks && !tx.isBusy;

  const send = () => {
    if (to === null || nav6 === null || aum6 === null) return;
    void tx.send({
      address: to,
      abi: hbTokenAbi,
      functionName: "setNAV",
      args: [nav6, aum6, force],
    });
  };

  const suggestion =
    token.supply18 !== null && nav6 !== null ? suggestedReportedAum6(nav6, token.supply18) : null;

  return (
    <>
      <ActionCard
        id="set-nav"
        action={action}
        permission={permission}
        walletConnected={walletConnected}
        title="Set NAV"
        description={NAV_INTRO}
        encoded={encoded}
        tx={tx}
        confirmPhrase={force ? FORCE_PHRASE : null}
        footer={
          <>
            <Button
              variant={force ? "danger" : "primary"}
              disabled={!ready}
              onClick={() => setConfirming(true)}
            >
              {force ? "Force NAV past the rail" : "Set NAV"}
            </Button>
            {railBlocks ? (
              <span className="text-danger text-xs">
                This move breaches the rail. Change the value, or force it with DEFAULT_ADMIN_ROLE.
              </span>
            ) : null}
          </>
        }
      >
        <FactList className="border-border bg-surface-sunken rounded-md border p-3">
          <FactRow
            label="NAV now"
            value={token.nav6 === null ? "—" : `${formatUsdcExact(token.nav6)} USDC`}
          />
          <FactRow
            label="Rail anchor"
            value={token.anchor6 === null ? "—" : `${formatUsdcExact(token.anchor6)} USDC`}
          />
          <FactRow
            label="Rail width"
            value={token.maxBps === null ? "—" : formatBasisPoints(token.maxBps)}
          />
          <FactRow
            label="Window opened"
            value={token.windowStart === null ? "—" : formatUnixSeconds(token.windowStart)}
          />
          <FactRow
            label="Window rolls"
            value={
              token.windowStart === null || token.railWindow === null
                ? "—"
                : formatUnixSeconds(token.windowStart + token.railWindow)
            }
          />
          <FactRow
            label="Last update"
            value={token.navUpdatedAt === null ? "—" : formatUnixSeconds(token.navUpdatedAt)}
          />
          <FactRow
            label="Reported AUM"
            value={token.reportedAum6 === null ? "—" : `${formatUsdc(token.reportedAum6)} USDC`}
          />
          <FactRow
            label="Supply"
            value={
              token.supply18 === null
                ? "—"
                : `${formatFixed(token.supply18, 18, { displayDecimals: 4, rounding: "trunc" })} hbTRS`
            }
          />
        </FactList>

        <AdminField
          id="admin-nav"
          label="New NAV per token"
          error={navError}
          hint="Six decimals, the integer the contract stores and the engine publishes. Anything finer is dropped, never rounded."
          control={(props) => (
            <AdminInput
              {...props}
              suffix="USDC"
              placeholder="1.003061"
              inputMode="decimal"
              value={navText}
              invalid={navError !== null}
              onChange={(event) => setNavText(event.target.value)}
            />
          )}
        >
          <QuickFills>
            {token.nav6 !== null ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setNavText(formatUsdcExact(token.nav6!))}
              >
                Current ({formatUsdcExact(token.nav6)})
              </Button>
            ) : null}
            {rail !== null ? (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setNavText(formatUsdcExact(rail.band.min6))}
                >
                  Rail floor ({formatUsdcExact(rail.band.min6)})
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setNavText(formatUsdcExact(rail.band.max6))}
                >
                  Rail ceiling ({formatUsdcExact(rail.band.max6)})
                </Button>
              </>
            ) : null}
          </QuickFills>
        </AdminField>

        <AdminField
          id="admin-aum"
          label="Reported AUM"
          error={aumError}
          hint="Stored beside the NAV and published by /api/stats. One token is one reference unit (PLAN.md D19), so this is normally NAV × supply."
          control={(props) => (
            <AdminInput
              {...props}
              suffix="USDC"
              placeholder="0.00"
              inputMode="decimal"
              value={aumText}
              invalid={aumError !== null}
              onChange={(event) => setAumText(event.target.value)}
            />
          )}
        >
          <QuickFills>
            {suggestion !== null ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setAumText(formatUsdcExact(suggestion))}
              >
                NAV × supply ({formatUsdc(suggestion)})
              </Button>
            ) : null}
            {token.reportedAum6 !== null ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setAumText(formatUsdcExact(token.reportedAum6!))}
              >
                Unchanged ({formatUsdc(token.reportedAum6)})
              </Button>
            ) : null}
          </QuickFills>
        </AdminField>

        <RailPanel rail={rail} readable={railReadable} navTyped={nav6 !== null} />

        <AdminCheckbox
          id="admin-nav-force"
          tone="danger"
          checked={force}
          onCheckedChange={setForce}
          label="Force this update past the rail (DEFAULT_ADMIN_ROLE)"
          description={NAV_FORCE_NOTE}
        />

        <RuleNote title="The rail">{NAV_RAIL_NOTE}</RuleNote>
        {token.paused === true ? <RuleNote tone="warning">{NAV_PAUSED_NOTE}</RuleNote> : null}
      </ActionCard>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={force ? "Force NAV past the rail" : "Set NAV"}
        description={
          force
            ? "This skips the rail, records who did it, and moves the window."
            : "This changes the price every subscription and redemption settles at."
        }
        tone={force ? "danger" : "warning"}
        phrase={force ? FORCE_PHRASE : null}
        confirmLabel={force ? "Force the NAV" : "Send the update"}
        encoded={encoded}
        busy={tx.isBusy}
        consequences={[
          nav6 !== null && token.nav6 !== null ? (
            <>
              NAV moves from <span className="num">{formatUsdcExact(token.nav6)}</span> to{" "}
              <span className="num">{formatUsdcExact(nav6)}</span> USDC per token.
            </>
          ) : null,
          "Every subscription and redemption from the next block settles at the new value.",
          force
            ? "NAVForced is emitted with your address, and the 24-hour rail window restarts anchored here — the next oracle update is measured from this value."
            : "The rail window is unchanged; the anchor stays where it is until the window rolls.",
          force ? "The rail exists to stop exactly this. Use it to correct, not to push." : null,
        ].filter(Boolean)}
        onConfirm={send}
      />
    </>
  );
}

/** The rail check, as a panel that changes shape rather than a colour that changes hue. */
function RailPanel({
  rail,
  readable,
  navTyped,
}: {
  rail: RailAssessment | null;
  readable: boolean;
  navTyped: boolean;
}) {
  if (!readable) {
    return (
      <RuleNote tone="warning" title="The rail cannot be checked">
        The token did not answer with <span className="addr">railAnchorNav</span>,{" "}
        <span className="addr">railWindowStart</span> or <span className="addr">maxNavMoveBps</span>
        , so this page cannot tell you whether a move breaches it. The contract still enforces it.
      </RuleNote>
    );
  }
  if (rail === null) {
    return (
      <RuleNote title="The rail">
        {navTyped
          ? "Fix the value above and the rail check appears here."
          : "Type a NAV and the rail check appears here, before anything is signed."}
      </RuleNote>
    );
  }

  const tone =
    rail.verdict === "inside" ? "info" : rail.verdict === "partial" ? "warning" : "danger";

  return (
    <div data-testid="rail-check">
      <RuleNote tone={tone}>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <StatusBadge
            tone={
              rail.verdict === "inside"
                ? "success"
                : rail.verdict === "partial"
                  ? "warning"
                  : "danger"
            }
          >
            {rail.verdict === "inside"
              ? "Inside the rail"
              : rail.verdict === "partial"
                ? "Depends on the block"
                : "Breaches the rail"}
          </StatusBadge>
          <span className="text-muted text-xs">
            Safe band {formatUsdcExact(rail.band.min6)} &ndash; {formatUsdcExact(rail.band.max6)}{" "}
            USDC
          </span>
        </div>

        <ul className="flex flex-col gap-1">
          {rail.checks.map((check) => (
            <li key={check.anchor.label}>
              Against <span className="num">{formatUsdcExact(check.anchor.anchor6)}</span> &mdash;{" "}
              {check.anchor.label} &mdash; the move is{" "}
              <span className="num">{formatFixed(check.deltaBpsHundredths, 2)}</span> bp, and the
              contract {check.breaches ? "reverts NavMoveExceedsRail" : "accepts it"}.
            </li>
          ))}
        </ul>

        {rail.windowRollsSoon ? <p className="mt-2">{NAV_WINDOW_ROLL_NOTE}</p> : null}
        {rail.windowRolled ? (
          <p className="mt-2">
            The 24-hour window has already elapsed, so this call rolls it and re-anchors on the
            current NAV before the check.
          </p>
        ) : null}
      </RuleNote>
    </div>
  );
}
