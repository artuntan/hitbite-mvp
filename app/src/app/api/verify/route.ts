import { NextRequest, NextResponse } from "next/server";
import {
  erc20Abi,
  createWalletClient,
  encodeFunctionData,
  http,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { identityRegistryAbi } from "@hitbite/config/abi";
import { copy } from "@hitbite/config/copy";
import { client, config, deployment } from "@/lib/chain";
import { application, issue, message, open } from "@/lib/verification";

export const runtime = "nodejs";
export const maxDuration = 60;
// Serialize a warm instance. Across instances, pending nonces and confirmed registry
// state remain canonical; collisions return a retriable error, never a false success.
let registrarQueue: Promise<unknown> = Promise.resolve();
const response = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
export async function POST(request: NextRequest) {
  if (!deployment)
    return response({ error: "No testnet deployment is configured." }, 503);
  const origin = new URL(config.appUrl).origin;
  if (request.headers.get("origin") !== origin)
    return response(
      { error: "Verification must start from this app origin." },
      403,
    );
  const secret = process.env.VERIFICATION_SECRET;
  if (!secret || secret.length < 32 || !process.env.REGISTRAR_PRIVATE_KEY)
    return response({ error: "Simulated registrar is not configured." }, 503);
  if (Number(request.headers.get("content-length") || 0) > 8192)
    return response({ error: "Request too large." }, 413);
  let body: Record<string, unknown>;
  try {
    const text = await request.text();
    if (text.length > 8192)
      return response({ error: "Request too large." }, 413);
    body = JSON.parse(text);
  } catch {
    return response({ error: "Invalid request." }, 400);
  }
  try {
    if ((await client.getChainId()) !== config.chain.id)
      return response({ error: "Testnet RPC is unavailable." }, 503);
    const registry = {
      address: deployment.addresses.IdentityRegistry,
      abi: identityRegistryAbi,
    } as const;
    if (body.action === "challenge") {
      const input = application(body);
      if ([840, 792].includes(input.country))
        return response({ error: copy.blockedCountry }, 403);
      if (
        await client.readContract({
          ...registry,
          functionName: "isCountryBlocked",
          args: [input.country],
        })
      )
        return response(
          { error: "This country is currently blocked on the testnet." },
          403,
        );
      if (
        (await client.readContract({
          ...registry,
          functionName: "countryOf",
          args: [input.address],
        })) !== 0
      )
        return response(
          {
            error:
              "This wallet already has a registry record. Refresh its status; a registrar must review any revoked record.",
          },
          409,
        );
      const funds = await client.readContract({
        address: deployment.addresses.USDC,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [input.address],
      });
      if (funds < 50_000n)
        return response(
          {
            error:
              "Add at least 0.05 test USDC from the faucet before starting verification.",
          },
          400,
        );
      return response(issue(input, config.chain.id, origin, secret));
    }
    if (body.action !== "complete")
      return response({ error: "Unknown verification action." }, 400);
    let payload;
    try {
      payload = open(body.ticket, secret, config.chain.id, origin);
    } catch (e) {
      return response(
        { error: e instanceof Error ? e.message : "Invalid ticket." },
        400,
      );
    }
    if (typeof body.signature !== "string" || body.signature.length > 4096)
      return response({ error: "A wallet signature is required." }, 400);
    if (
      !(await client.verifyMessage({
        address: payload.address,
        message: message(payload),
        signature: body.signature as Hex,
      }))
    )
      return response(
        { error: "Wallet signature does not match the application." },
        403,
      );
    if (
      [840, 792].includes(payload.country) ||
      (await client.readContract({
        ...registry,
        functionName: "isCountryBlocked",
        args: [payload.country],
      }))
    )
      return response({ error: copy.blockedCountry }, 403);
    const execute = async () => {
      const [verified, oldCountry] = await Promise.all([
        client.readContract({
          ...registry,
          functionName: "isVerified",
          args: [payload.address],
        }),
        client.readContract({
          ...registry,
          functionName: "countryOf",
          args: [payload.address],
        }),
      ]);
      if (verified)
        return response({
          verified: true,
          alreadyVerified: true,
          address: payload.address,
        });
      if (oldCountry !== 0)
        return response(
          {
            error:
              "This wallet was revoked or blocked. A registrar must review it.",
          },
          403,
        );
      const account = privateKeyToAccount(
        process.env.REGISTRAR_PRIVATE_KEY as Hex,
      );
      const wallet = createWalletClient({
        account,
        chain: config.chain,
        transport: http(process.env.RPC_URL || config.rpcUrl),
      });
      if ((await wallet.getChainId()) !== config.chain.id)
        throw new Error("Registrar RPC chain mismatch.");
      const data = encodeFunctionData({
        abi: identityRegistryAbi,
        functionName: "addVerified",
        args: [payload.address, payload.country],
      });
      const fee = await client.estimateFeesPerGas();
      const floor = config.chainName === "arc-testnet" ? 20_000_000_000n : 0n;
      const fees = {
        maxFeePerGas: fee.maxFeePerGas > floor ? fee.maxFeePerGas : floor,
        maxPriorityFeePerGas: fee.maxPriorityFeePerGas,
      };
      const gas = await client.estimateGas({
        account,
        to: registry.address,
        data,
        ...fees,
      });
      const hash = await wallet.sendTransaction({
        to: registry.address,
        data,
        gas: (gas * 12n) / 10n,
        ...fees,
      });
      const receipt = await client.waitForTransactionReceipt({
        hash,
        timeout: 40000,
      });
      if (
        receipt.status !== "success" ||
        !(await client.readContract({
          ...registry,
          functionName: "isVerified",
          args: [payload.address],
        }))
      )
        throw new Error("Verification was not confirmed.");
      return response({
        verified: true,
        address: payload.address,
        transactionHash: hash,
        blockNumber: receipt.blockNumber.toString(),
        events: ["Verified"],
      });
    };
    const pending = registrarQueue.then(execute, execute);
    registrarQueue = pending.catch(() => undefined);
    return await pending;
  } catch (e) {
    if (
      body.action === "challenge" &&
      e instanceof Error &&
      /application|name between|country from|confirmation|wallet address/.test(
        e.message,
      )
    )
      return response({ error: e.message }, 400);
    return response(
      {
        error:
          "Verification could not be confirmed. Refresh your status, then retry if it is still unverified.",
      },
      503,
    );
  }
}
