import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { createWalletClient, http, keccak256, type Chain, type Hex } from 'viem';
import { identityRegistryAbi } from '../packages/config/abi.ts';
import { accountFor, context, fees, json, readDeployment, safeError, transact } from './runtime.ts';
const ctx=await context('arc-testnet');
const d=readDeployment(ctx.name);
const account=accountFor('DEPLOYER_PRIVATE_KEY');
const wallet=createWalletClient({account,chain:ctx.chain as Chain,transport:http(ctx.rpcUrl)});
const verified=await ctx.client.readContract({address:d.addresses.IdentityRegistry,abi:identityRegistryAbi,functionName:'isVerified',args:[account.address]});
if(!verified) await transact(ctx,'REGISTRAR_PRIVATE_KEY',d.addresses.IdentityRegistry,identityRegistryAbi,'addVerified',[account.address,826]);
const records=[];
for(const [address,signature,args] of [
 [d.addresses.USDC,'approve(address,uint256)',[d.addresses.HBToken,'500000']],
 [d.addresses.HBToken,'subscribe(uint256)',['500000']],
] as const) {
 const encoded=spawnSync('cast',['calldata',signature,...args],{encoding:'utf8'});
 if(encoded.status!==0) throw new Error('cast calldata failed');
 const data=encoded.stdout.trim() as Hex;
 const request=await wallet.prepareTransactionRequest({to:address,data,...await fees(ctx)});
 const signed=await wallet.signTransaction(request);
 // Only the signed public transaction enters argv. The signing key stays in env/memory.
 const sent=spawnSync('cast',['publish','--async','--rpc-url',ctx.rpcUrl,signed],{encoding:'utf8'});
 if(sent.status!==0) throw new Error(safeError(sent.stderr||sent.stdout));
 const receipt=await ctx.client.waitForTransactionReceipt({hash:keccak256(signed)});
 if(receipt.status!=='success') throw new Error('cast-published transaction reverted');
 records.push({step:signature,hash:receipt.transactionHash,block:Number(receipt.blockNumber)});
}
writeFileSync('.context/arc-cast-smoke.json',json(records));
console.log(json(records));
