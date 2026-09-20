import { test } from "node:test";
import assert from "node:assert/strict";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  application,
  issue,
  open,
  REVIEW_MS,
} from "../../app/src/lib/verification.ts";
import {
  canonical,
  verifyAttestation,
  type Attestation,
} from "../../app/src/lib/attestation.ts";
const account = privateKeyToAccount(generatePrivateKey());
const origin = "https://test.example";
const secret = generatePrivateKey();
const now = 1_800_000_000_000;
const input = application({
  address: account.address,
  country: 826,
  name: "Test Applicant",
  professional: true,
});
test("server review cannot be bypassed by submitting before ten seconds", () => {
  const challenge = issue(input, 5042002, origin, secret, now);
  assert.throws(
    () => open(challenge.ticket, secret, 5042002, origin, now + REVIEW_MS - 1),
    /still pending/,
  );
  assert.equal(
    open(challenge.ticket, secret, 5042002, origin, now + REVIEW_MS).address,
    account.address,
  );
  assert.ok(!challenge.message.includes("Test Applicant"));
});
test("verification rejects altered, expired and wrong-origin/chain tickets", () => {
  const c = issue(input, 5042002, origin, secret, now);
  assert.throws(() =>
    open(c.ticket + "x", secret, 5042002, origin, now + REVIEW_MS),
  );
  assert.throws(
    () => open(c.ticket, secret, 84532, origin, now + REVIEW_MS),
    /wrong origin or chain/,
  );
  assert.throws(
    () =>
      open(c.ticket, secret, 5042002, "https://evil.example", now + REVIEW_MS),
    /wrong origin or chain/,
  );
  assert.throws(
    () => open(c.ticket, secret, 5042002, origin, now + 300001),
    /expired/,
  );
  const parts = c.ticket.split(".");
  const p = JSON.parse(Buffer.from(parts[0]!, "base64url").toString());
  p.country = 250;
  assert.throws(
    () =>
      open(
        Buffer.from(JSON.stringify(p)).toString("base64url") + "." + parts[1],
        secret,
        5042002,
        origin,
        now + REVIEW_MS,
      ),
    /Invalid/,
  );
});
test("verification inputs require actual country, nonzero wallet and consent", () => {
  assert.throws(() => application({ ...input, country: 999 }));
  assert.throws(() => application({ ...input, professional: false }));
  assert.throws(() => application({ ...input, name: " " }));
});
test("attestation verifies payload and independent trust anchor, rejecting tampering", async () => {
  const payload = {
    schema: "hitbite.attestation.v2",
    simulated: true,
    chain_id: 5042002,
    token: account.address,
    nav_units: "1000000",
    label: "Türkiye",
  };
  const message = canonical(payload);
  const a: Attestation = {
    payload,
    message,
    signature: await account.signMessage({ message }),
    signer: account.address,
    public_key: account.publicKey,
  };
  assert.equal(
    await verifyAttestation(
      a,
      account.address,
      5042002,
      account.address,
      "1000000",
    ),
    true,
  );
  await assert.rejects(
    verifyAttestation(
      { ...a, payload: { ...payload, nav_units: "2000000" } },
      account.address,
      5042002,
      account.address,
    ),
    /displayed payload/,
  );
  await assert.rejects(
    verifyAttestation(
      a,
      privateKeyToAccount(generatePrivateKey()).address,
      5042002,
      account.address,
    ),
    /trust anchor/,
  );
  await assert.rejects(
    verifyAttestation(a, account.address, 84532, account.address),
    /scope/,
  );
  await assert.rejects(
    verifyAttestation(a, account.address, 5042002, account.address, "2000000"),
    /differs/,
  );
});
