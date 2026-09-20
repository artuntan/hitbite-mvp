import type { Browser } from "@playwright/test";
import { createWalletClient, type Address, type Hex } from "viem";
import { accountFor, context, readDeployment } from "../../scripts/runtime.ts";

/** Test-only injected provider. Keys stay in the Node process; browser receives no key. */
export async function walletPage(
  browser: Browser,
  variable: string,
  baseUrl: string,
) {
  const ctx = await context();
  const account = accountFor(variable);
  const deployment = readDeployment(ctx.name);
  const wallet = createWalletClient({
    account,
    chain: ctx.chain,
    transport: ctx.transport,
  });
  const browserContext = await browser.newContext({
    viewport: { width: 1440, height: 1050 },
  });
  const page = await browserContext.newPage();
  const transactions: Hex[] = [];
  await page.exposeBinding(
    "testWalletRequest",
    async ({ frame }, input: { method: string; params?: unknown[] }) => {
      if (new URL(frame.url()).origin !== new URL(baseUrl).origin)
        throw new Error("Untrusted test page origin.");
      const params = input.params ?? [];
      switch (input.method) {
        case "eth_chainId":
          return "0x" + ctx.chain.id.toString(16);
        case "eth_accounts":
        case "eth_requestAccounts":
          return [account.address];
        case "wallet_requestPermissions":
          return [{ parentCapability: "eth_accounts" }];
        case "wallet_revokePermissions":
          return null;
        case "wallet_switchEthereumChain":
        case "wallet_addEthereumChain": {
          const chain = params[0] as { chainId: string };
          if (Number(chain.chainId) !== ctx.chain.id)
            throw new Error("Only the selected testnet is allowed.");
          return null;
        }
        case "personal_sign": {
          const [data, address] = params as [Hex, Address];
          if (address.toLowerCase() !== account.address.toLowerCase())
            throw new Error("Wrong signer.");
          return await account.signMessage({ message: { raw: data } });
        }
        case "eth_sendTransaction": {
          const tx = params[0] as {
            from: Address;
            to: Address;
            data: Hex;
            value?: Hex;
            gas?: Hex;
            maxFeePerGas?: Hex;
            maxPriorityFeePerGas?: Hex;
          };
          if (
            tx.from.toLowerCase() !== account.address.toLowerCase() ||
            !Object.values(deployment.addresses).some(
              (a) => a.toLowerCase() === tx.to.toLowerCase(),
            ) ||
            BigInt(tx.value ?? "0") !== 0n
          )
            throw new Error("Test transaction outside the deployed contracts.");
          const hash = await wallet.sendTransaction({
            to: tx.to,
            data: tx.data,
            gas: tx.gas ? BigInt(tx.gas) : undefined,
            maxFeePerGas: tx.maxFeePerGas ? BigInt(tx.maxFeePerGas) : undefined,
            maxPriorityFeePerGas: tx.maxPriorityFeePerGas
              ? BigInt(tx.maxPriorityFeePerGas)
              : undefined,
          });
          transactions.push(hash);
          return hash;
        }
        case "eth_getBalance":
        case "eth_getCode":
        case "eth_getTransactionReceipt":
        case "eth_getTransactionByHash":
        case "eth_blockNumber":
        case "eth_call":
        case "eth_estimateGas":
        case "eth_getTransactionCount":
        case "eth_getBlockByNumber":
        case "eth_gasPrice":
        case "eth_maxPriorityFeePerGas":
          return await ctx.client.request({
            method: input.method,
            params,
          } as Parameters<typeof ctx.client.request>[0]);
        default:
          throw new Error("Unsupported test wallet method: " + input.method);
      }
    },
  );
  await page.addInitScript({
    content: `
    (() => {
      const listeners = new Map();
      window.ethereum = {
        isMetaMask: true,
        isConnected: () => true,
        request: (input) => window.testWalletRequest(input),
        on: (name, fn) => { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); },
        removeListener: (name, fn) => listeners.get(name)?.delete(fn)
      };
    })();
  `,
  });
  return { page, browserContext, account, ctx, deployment, transactions };
}
