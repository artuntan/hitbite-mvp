import assert from "node:assert/strict";
import { test } from "node:test";
import { assertChainId, chains, parseChainName, ARC_USDC_ADDRESS, USDC_DECIMALS } from "../../packages/config/chains.ts";
import { readPublicConfig } from "../../packages/config/env.ts";

test("default configuration uses Arc's single USDC asset with distinct gas and ERC-20 units", () => {
  const config = readPublicConfig({});
  assert.equal(config.chain.id, 5042002);
  assert.equal(config.chain.nativeCurrency.symbol, "USDC");
  assert.equal(config.chain.nativeCurrency.decimals, 18);
  assert.equal(USDC_DECIMALS, 6);
  assert.equal(ARC_USDC_ADDRESS, "0x3600000000000000000000000000000000000000");
});

test("fallback changes configuration using only the selected environment value", () => {
  assert.equal(readPublicConfig({ NEXT_PUBLIC_CHAIN: "base-sepolia" }).chain.id, 84532);
  assert.equal(readPublicConfig({ NEXT_PUBLIC_CHAIN: "local" }).rpcUrl, "http://127.0.0.1:8545/");
  for (const [name, chain] of Object.entries(chains)) {
    assert.equal(chain.testnet, true);
    assert.doesNotThrow(() => assertChainId(chain.id, parseChainName(name)));
  }
});

test("unknown, production and prototype-property chain selections fail closed", () => {
  for (const value of ["mainnet", "base", "arc", "1", "5042", "__proto__", "constructor", "toString", "ARC-TESTNET"]) {
    assert.throws(() => readPublicConfig({ NEXT_PUBLIC_CHAIN: value }), /NEXT_PUBLIC_CHAIN/);
  }
  for (const id of [1, 5042, 8453, 84532, 31337, NaN]) {
    assert.throws(() => assertChainId(id, "arc-testnet"), /does not match/);
  }
});

test("RPC overrides retain the explicit selected-chain check", () => {
  const config = readPublicConfig({ NEXT_PUBLIC_RPC_URL: "https://rpc.drpc.testnet.arc.io" });
  assert.equal(config.rpcUrl, "https://rpc.drpc.testnet.arc.io/");
  assert.throws(() => assertChainId(5042, config.chainName));
});

test("invalid public URLs reject without echoing embedded credentials", () => {
  const marker = "private-value-do-not-print";
  for (const value of [`https://user:${marker}@example.com`, `ftp://example.com/${marker}`, marker, "http://remote.example.com"]) {
    assert.throws(() => readPublicConfig({ NEXT_PUBLIC_RPC_URL: value }), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.ok(error.message.includes("NEXT_PUBLIC_RPC_URL"));
      assert.ok(!error.message.includes(marker));
      return true;
    });
  }
  assert.throws(() => readPublicConfig({ NEXT_PUBLIC_RPC_URL: "http://localhost:8545" }));
  assert.doesNotThrow(() => readPublicConfig({ NEXT_PUBLIC_CHAIN: "local", NEXT_PUBLIC_RPC_URL: "http://localhost:8545" }));
});

test("public config never returns unrelated private environment fields", () => {
  const env = { NEXT_PUBLIC_CHAIN: "arc-testnet", ORACLE_PRIVATE_KEY: "do-not-copy" };
  assert.ok(!JSON.stringify(readPublicConfig(env)).includes("do-not-copy"));
});

test("attestation signer accepts a public address and rejects zero or malformed addresses", () => {
  assert.doesNotThrow(() => readPublicConfig({ NEXT_PUBLIC_ATTESTOR_ADDRESS: ARC_USDC_ADDRESS }));
  for (const address of ["invalid", `0x${"0".repeat(40)}`]) {
    assert.throws(() => readPublicConfig({ NEXT_PUBLIC_ATTESTOR_ADDRESS: address }), /ATTESTOR_ADDRESS/);
  }
});
