import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TOKEN } from "@/lib/copy";

import type { SupplyModel } from "./view-model";

interface SupplyCardProps {
  model: SupplyModel;
}

const AGREEMENT = {
  match: {
    tone: "success",
    label: "Agrees with the contract",
    sentence:
      "The supply folded from Transfer logs equals totalSupply() on the token, as integers. That is the check that catches a hole in the index: a missing Transfer would move one side and not the other.",
  },
  mismatch: {
    tone: "danger",
    label: "Does not agree",
    sentence:
      "The supply folded from Transfer logs does not equal totalSupply() on the token. That means this index is missing logs, not that the contract is wrong — the contract is the authority here, and the holder count below should be read as a floor.",
  },
  unchecked: {
    tone: "neutral",
    label: "Not checked",
    sentence:
      "The token contract was not read, so there is nothing to compare the folded supply against. Read this as not checked, not as a pass.",
  },
} as const;

/**
 * Supply and holders, the two figures BUILD_PROMPT 7.2 names first.
 *
 * Both come from `Transfer`, and from nothing else. Subscriptions, redemptions
 * and the issuer's operational mint and burn all move tokens through ERC-20
 * `_update`, so each already emits a `Transfer` with the zero address on one
 * side; folding `Subscribed` or `OperationalMint` as well would count every one
 * of them twice.
 *
 * The contract's own `totalSupply()` sits beside the folded figure with a
 * verdict on whether they agree, because the point of folding a supply the
 * contract already publishes is precisely to find out whether the index saw
 * everything.
 */
export function SupplyCard({ model }: SupplyCardProps) {
  const agreement = AGREEMENT[model.agreement];

  return (
    <Card data-testid="stats-supply" data-state={model.agreement}>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle as="h3">Supply and holders</CardTitle>
          <Badge tone={agreement.tone}>{agreement.label}</Badge>
        </div>
        <CardDescription>
          Folded from every {TOKEN.symbol} <code className="addr text-xs">Transfer</code> the token
          has emitted since its deploy block. The token keeps no holder list — iterating one would
          not scale, and coupons are distributed by a cumulative index precisely so nobody has to.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        <Table aria-label="Supply and holders">
          <TableCaption srOnly>
            Total supply on the contract, the supply folded from Transfer logs, mints, burns and the
            holder count.
          </TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>Figure</TableHead>
              <TableHead numeric>Value</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell>
                Total supply
                <span className="text-muted block text-xs">
                  <code className="addr">totalSupply()</code> on the token contract
                </span>
              </TableCell>
              <TableCell numeric data-testid="supply-onchain">
                {model.onchain ?? <span className="text-muted font-sans">Not read</span>}
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell>
                Supply folded from logs
                <span className="text-muted block text-xs">minted minus burned</span>
              </TableCell>
              <TableCell numeric data-testid="supply-from-events">
                {model.fromEvents}
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell>Minted</TableCell>
              <TableCell numeric>{model.minted}</TableCell>
            </TableRow>
            <TableRow>
              <TableCell>Burned</TableCell>
              <TableCell numeric>{model.burned}</TableCell>
            </TableRow>
            <TableRow>
              <TableCell>Transfers indexed</TableCell>
              <TableCell numeric>{model.transfers}</TableCell>
            </TableRow>
            <TableRow>
              <TableCell>
                Holders
                <span className="text-muted block text-xs">
                  addresses with a non-zero balance right now
                </span>
              </TableCell>
              <TableCell numeric data-testid="holders-count">
                {model.holders}
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell>
                Addresses that ever held
                <span className="text-muted block text-xs">whether or not they still hold any</span>
              </TableCell>
              <TableCell numeric data-testid="holders-ever">
                {model.everHeld}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>

        <div className="text-muted flex flex-col gap-2 text-xs leading-relaxed">
          <p data-testid="holders-basis">
            <span className="text-ink font-medium">
              The holder count excludes the zero address.
            </span>{" "}
            The zero address is the ERC-20 mint and burn sentinel, not an account: every
            subscription mints from it and every redemption burns to it, so counting it would put
            the total one too high from the first subscription onwards.
          </p>
          <p>{agreement.sentence}</p>
          {model.negative > 0 ? (
            <p className="text-danger">
              {model.negative} address(es) fold to a negative balance, which is arithmetically
              impossible on a complete log set. The index is missing transfers, and the holder count
              is a floor rather than an answer.
            </p>
          ) : null}
          {!model.holdersComplete && model.negative === 0 ? (
            <p>
              The scan did not cover the whole range, so the holder count is a floor: an address
              whose only transfer sits in an unread block is not counted.
            </p>
          ) : null}
          <p>
            Amounts are shown to six of the token&rsquo;s eighteen decimals. The exact integers are
            in <code className="addr">/api/stats</code>.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
