"use client";
import { useState } from "react";
import { useAccount, useSignMessage } from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import countryData from "@hitbite/config/countries";
import { copy } from "@hitbite/config/copy";
import { client, short } from "@/lib/chain";
import { type Hex, type TransactionReceipt } from "viem";
import { Caption, Icon } from "./ui";
import { Receipt } from "./action";
export function Verify({
  verified,
  country,
  onNext,
}: {
  verified: boolean;
  country: number;
  onNext: () => void;
}) {
  const { address, chainId } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const query = useQueryClient();
  const [name, setName] = useState("");
  const [selected, setCountry] = useState("");
  const [professional, setProfessional] = useState(false);
  const [pending, setPending] = useState(false);
  const [stage, setStage] = useState("");
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState<TransactionReceipt>();
  const blocked = [840, 792].includes(Number(selected));
  async function submit() {
    if (!address) return;
    setPending(true);
    setError("");
    setReceipt(undefined);
    try {
      const request = async (body: unknown) => {
        const r = await fetch("/api/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const json = await r.json();
        if (!r.ok)
          throw new Error(json.error || "Verification is unavailable.");
        return json;
      };
      setStage("Preparing your wallet signature…");
      const challenge = await request({
        action: "challenge",
        address,
        country: Number(selected),
        name,
        professional,
      });
      const signature = await signMessageAsync({ message: challenge.message });
      setStage("Pending · 10-second simulated review");
      await new Promise((resolve) => setTimeout(resolve, challenge.reviewMs));
      if ((await client.getChainId()) !== chainId)
        throw new Error("Switch back to the selected testnet.");
      setStage("Review complete · waiting for the registry receipt…");
      const result = await request({
        action: "complete",
        ticket: challenge.ticket,
        signature,
      });
      if (result.transactionHash)
        setReceipt(
          await client.getTransactionReceipt({
            hash: result.transactionHash as Hex,
          }),
        );
      await query.invalidateQueries({ queryKey: ["chain"] });
      await query.invalidateQueries({ queryKey: ["activity"] });
    } catch (e) {
      setError(
        e instanceof Error
          ? /reject|denied/i.test(e.message)
            ? "Signature declined. Nothing was submitted."
            : e.message
          : "Verification could not complete.",
      );
    } finally {
      setPending(false);
      setStage("");
    }
  }
  return (
    <div className="verify-step">
      {verified ? (
        <div className="completion">
          <span className="completion-icon">
            <Icon name="check" />
          </span>
          <h2>Your wallet is verified.</h2>
          <p className="step-description">
            You’re ready to subscribe to hbTRS.
          </p>
          <p className="caption muted mono">{short(address!)}</p>
          {receipt && <Receipt receipt={receipt} />}
          <button className="primary-action" onClick={onNext}>
            Continue to subscribe <Icon name="arrow" />
          </button>
        </div>
      ) : country !== 0 ? (
        <>
          <h2>Verification needs review.</h2>
          <p className="step-description">
            A registrar must review this wallet’s revoked or blocked record.
          </p>
          <p className="notice">
            You can still redeem existing tokens and claim accrued coupons while
            the token is unpaused.
          </p>
        </>
      ) : (
        <>
          <h2>Verify your eligibility.</h2>
          <p className="step-description">
            A 10-second simulated review. No documents needed.
          </p>
          <Caption>
            Your name stays off-chain. This is not real identity verification.
          </Caption>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <fieldset disabled={pending}>
              <label>
                Full name
                <input
                  name="name"
                  autoComplete="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  minLength={2}
                  maxLength={100}
                  required
                  placeholder="Your full name"
                />
              </label>
              <label>
                Country of residence
                <select
                  value={selected}
                  onChange={(e) => setCountry(e.target.value)}
                  required
                >
                  <option value="">Select your country</option>
                  {countryData.countries.map((c) => (
                    <option key={c.numeric} value={c.numeric}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={professional}
                  onChange={(e) => setProfessional(e.target.checked)}
                  required
                />
                <span>
                  I confirm I’m a professional investor for this testnet
                  simulation.
                </span>
              </label>
            </fieldset>
            {blocked && (
              <p className="error" role="alert">
                {copy.blockedCountry}
              </p>
            )}
            <button
              className="primary-action"
              type="submit"
              disabled={
                !professional ||
                name.trim().length < 2 ||
                !selected ||
                blocked ||
                pending
              }
            >
              {pending ? "Review in progress…" : "Sign & start review"}
              {!pending && <Icon name="arrow" />}
            </button>
            <p className="action-note" aria-live="polite">
              {stage || "This signature moves no funds."}
            </p>
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
            {receipt && <Receipt receipt={receipt} />}
          </form>
        </>
      )}
    </div>
  );
}
