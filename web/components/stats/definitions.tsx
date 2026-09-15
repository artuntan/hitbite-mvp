import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Each figure on this page, defined once. Rendered whether or not there is
 * anything to count: it is what makes the empty state legible, and it is the
 * part a reader has to agree with before the numbers mean anything.
 */
const DEFINITIONS: readonly { term: string; text: string }[] = [
  {
    term: "Holders",
    text: "Addresses with a strictly positive balance right now, folded from every Transfer the token has emitted since its deploy block. The zero address is never counted: it is the ERC-20 mint and burn sentinel, not an account. Only Transfer is folded — subscriptions, redemptions and the issuer's operational mint and burn each already emit one, so folding their own events as well would count every one of them twice.",
  },
  {
    term: "Supply",
    text: "totalSupply() on the token contract, with mints minus burns from Transfer logs beside it as a cross-check. They are compared as integers; a disagreement means this index is missing logs, not that the contract is wrong.",
  },
  {
    term: "Distributions to date",
    text: "The USDC the issuer paid into the vault, summed over every CouponDistributed in the indexed range. The amount the cumulative index attributed to holders is slightly smaller, and the difference — the D29 truncation remainder — stays in the vault as ordinary liquidity rather than being locked in the coupon reserve. Both numbers, and the difference, are on the distributions card.",
  },
  {
    term: "NAV history",
    text: "Every NAVUpdated the contract emitted: oracle pushes, and the ex-distribution drop applied when a coupon is paid, because NAV falls by the per-token coupon at the moment of distribution exactly as a fund's NAV drops on its ex-distribution date. A change forced past the oracle rail by an admin is marked as forced.",
  },
  {
    term: "Subscriptions and redemptions over time",
    text: "Subscribed and Redeemed events bucketed by UTC day and summed as integers. An event whose block timestamp has not been resolved belongs to no day and is counted separately rather than guessed into one.",
  },
] as const;

export function Definitions() {
  return (
    <Card data-testid="stats-definitions">
      <CardHeader>
        <CardTitle as="h2" className="text-lg">
          What this page counts
        </CardTitle>
        <CardDescription>
          Every figure here is folded from contract logs, so each one is only as precise as its
          definition. These are the definitions.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="flex flex-col gap-4">
          {DEFINITIONS.map((definition) => (
            <div key={definition.term} className="flex flex-col gap-1">
              <dt className="text-ink text-sm font-semibold">{definition.term}</dt>
              <dd className="text-muted text-sm leading-relaxed">{definition.text}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}
