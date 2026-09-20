import { chains, parseChainName } from "@hitbite/config/chains";

export default function OverviewShell() {
  const chain = chains[parseChainName(process.env.NEXT_PUBLIC_CHAIN)];
  return (
    <main>
      <p className="eyebrow">{chain.name}</p>
      <h1>HitBite</h1>
      <p>This testnet reference application is under construction.</p>
    </main>
  );
}
