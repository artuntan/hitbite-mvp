"use client";
import { useState } from "react";
import { useAccount, useSignMessage } from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import countryData from "@hitbite/config/countries";
import { copy } from "@hitbite/config/copy";
import { client, short } from "@/lib/chain";
import { type Hex, type TransactionReceipt } from "viem";
import { Caption, Status } from "./ui";
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
    <div>
      <div className="section-heading">
        <h2>Verify your eligibility.</h2>
        <Status tone={verified ? "good" : pending ? "pending" : "neutral"}>
          {verified ? "Verified" : pending ? "Pending" : "Not verified"}
        </Status>
      </div>
      <p className="muted">
        A short, simulated review links eligibility to your wallet. This is not
        real identity verification.
      </p>
      <Caption>
        Only verified wallets can subscribe or receive hbTRS. Your name stays
        off-chain.
      </Caption>
      {verified ? (
        <>
          <div className="success-panel">
            <span className="check-mark">✓</span>
            <div>
              <h3>Your wallet is verified.</h3>
              <p className="muted">
                {short(address!)} can subscribe and receive tokens.
              </p>
            </div>
          </div>
          {receipt && <Receipt receipt={receipt} />}
          <button onClick={onNext}>Continue to subscribe →</button>
        </>
      ) : country !== 0 ? (
        <div className="notice">
          This wallet has a revoked or blocked registry record. A registrar must
          review it. You can still redeem existing tokens or claim accrued
          coupons while the token is unpaused.
        </div>
      ) : (
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
                I confirm that I am a professional investor for this simulated
                testnet review.
              </span>
            </label>
          </fieldset>
          {blocked && (
            <p className="error" role="alert">
              {copy.blockedCountry}
            </p>
          )}
          <section className="action-card">
            <div className="action-heading">
              <h3>Request verification</h3>
              <span className="mono caption">
                IdentityRegistry.addVerified()
              </span>
            </div>
            <span className="eyebrow small">What will happen</span>
            <p>
              You sign an eligibility statement. After the simulated review, the
              registrar pays the gas to verify your wallet on-chain.
            </p>
            <div className="sign-row">
              <span className="eyebrow small">Sign</span>
              <button
                type="submit"
                disabled={
                  !professional ||
                  !name.trim() ||
                  !selected ||
                  blocked ||
                  pending
                }
              >
                {pending ? "Review in progress…" : "Sign & start review"}
              </button>
            </div>
            <p className="caption muted" aria-live="polite">
              {stage ||
                "The signature moves no funds. Review takes at least 10 seconds."}
            </p>
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
            {receipt ? (
              <Receipt receipt={receipt} />
            ) : (
              <p className="caption muted receipt-empty">
                Receipt · Appears after the registrar confirms verification
              </p>
            )}
          </section>
        </form>
      )}
    </div>
  );
}
