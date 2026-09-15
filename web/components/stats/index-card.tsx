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

import type { CoverageModel, EventCountRow } from "./view-model";

interface IndexCardProps {
  coverage: CoverageModel;
  eventCounts: EventCountRow[];
  totalEvents: string;
  /** `coverageLimitations()` — facts about this build, rendered as written. */
  limitations: string[];
  tokenAddress: string;
  registryAddress: string;
}

/**
 * What the scan actually read, and what it did not.
 *
 * Every number above this card is only as good as this one. A holder count from
 * a log set with a hole in it is a floor; a distribution total from a truncated
 * range is a lower bound. So the range, the gaps, the request budget and the age
 * of the index are stated here rather than implied, and the `limitations` list is
 * the indexer's own account of this build — derived from what happened, not a
 * fixed disclaimer.
 */
export function IndexCard({
  coverage,
  eventCounts,
  totalEvents,
  limitations,
  tokenAddress,
  registryAddress,
}: IndexCardProps) {
  const state = coverage.headBehindDeploy
    ? { tone: "danger" as const, label: "Nothing scanned" }
    : !coverage.complete
      ? { tone: "warning" as const, label: "Incomplete scan" }
      : coverage.stale
        ? { tone: "warning" as const, label: "Serving a stale index" }
        : { tone: "success" as const, label: "Complete scan" };

  return (
    <Card data-testid="stats-index" data-state={coverage.complete ? "complete" : "incomplete"}>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle as="h3">What this page read</CardTitle>
          <Badge tone={state.tone}>{state.label}</Badge>
        </div>
        <CardDescription>
          There is no database (PLAN.md D10). The index is rebuilt from the deploy block on demand,
          in 10,000-block <code className="addr text-xs">eth_getLogs</code> chunks, and held in
          memory for {coverage.cacheTtlSeconds} seconds.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-6">
        <Table aria-label="Index coverage">
          <TableCaption srOnly>
            The block range scanned, the node&rsquo;s head, how many events were indexed, how many
            requests it took and when the index was built.
          </TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>Measure</TableHead>
              <TableHead numeric>Value</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell>
                Blocks scanned
                <span className="text-muted block text-xs">
                  from {coverage.fromBlock} to {coverage.toBlock}, inclusive
                </span>
              </TableCell>
              <TableCell numeric data-testid="coverage-blocks">
                {coverage.blocksScanned}
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell>
                Node head block
                <span className="text-muted block text-xs">
                  contracts recorded at deploy block {coverage.deployBlock}
                </span>
              </TableCell>
              <TableCell numeric>{coverage.headBlock}</TableCell>
            </TableRow>
            <TableRow>
              <TableCell>Events indexed</TableCell>
              <TableCell numeric data-testid="coverage-events">
                {totalEvents}
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell>
                <code className="addr">eth_getLogs</code> calls
                <span className="text-muted block text-xs">
                  retries and range splits included, {coverage.chunkSize} blocks per chunk
                </span>
              </TableCell>
              <TableCell numeric>{coverage.logRequests}</TableCell>
            </TableRow>
            <TableRow>
              <TableCell>
                Block timestamps resolved
                <span className="text-muted block text-xs">
                  {coverage.blocksWithoutTimestamp} block(s) still unresolved
                </span>
              </TableCell>
              <TableCell numeric>{coverage.blocksTimestamped}</TableCell>
            </TableRow>
            <TableRow>
              <TableCell>
                Reorg conflicts
                <span className="text-muted block text-xs">
                  log slots that held a different transaction on a later read. Also dropped:{" "}
                  {coverage.duplicates} duplicate(s), {coverage.removedLogs} marked removed by the
                  node, {coverage.undecodableLogs} that would not decode
                </span>
              </TableCell>
              <TableCell numeric>{coverage.reorgConflicts}</TableCell>
            </TableRow>
            <TableRow>
              <TableCell>
                Index built
                <span className="text-muted block text-xs">
                  {coverage.cacheAgeSeconds} second(s) old, rebuilt after {coverage.cacheTtlSeconds}
                </span>
              </TableCell>
              <TableCell numeric>{coverage.indexedAt}</TableCell>
            </TableRow>
          </TableBody>
        </Table>

        {coverage.gaps.length > 0 ? (
          <div className="flex flex-col gap-2">
            <h4 className="text-ink text-sm font-semibold">
              Ranges that could not be read ({coverage.gapBlocks} blocks)
            </h4>
            <Table aria-label="Block ranges the scan could not read">
              <TableHeader>
                <TableRow>
                  <TableHead>Blocks</TableHead>
                  <TableHead numeric>Count</TableHead>
                  <TableHead>Reason</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {coverage.gaps.map((gap) => (
                  <TableRow key={gap.key}>
                    <TableCell className="num">{gap.range}</TableCell>
                    <TableCell numeric>{gap.blocks}</TableCell>
                    <TableCell className="text-muted text-xs">{gap.reason}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : null}

        <div className="flex flex-col gap-2">
          <h4 className="text-ink text-sm font-semibold">Events in the index</h4>
          <Table aria-label="Indexed events by name">
            <TableCaption srOnly>
              Each product event the indexer decodes, and how many of them are in this index.
            </TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead>Event</TableHead>
                <TableHead numeric>Count</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {eventCounts.map((row) => (
                <TableRow key={row.name}>
                  <TableCell className="addr text-xs">{row.name}</TableCell>
                  <TableCell numeric className={row.zero ? "text-muted" : undefined}>
                    {row.count}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="text-muted text-xs leading-relaxed">
            Read from <span className="addr text-ink">{tokenAddress}</span> and{" "}
            <span className="addr text-ink">{registryAddress}</span>. ERC-20{" "}
            <code className="addr">Approval</code>, the AccessControl role events and the MockUSDC
            faucet event carry no product meaning and are not indexed.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <h4 className="text-ink text-sm font-semibold">What this index does not tell you</h4>
          <ul className="text-muted flex list-disc flex-col gap-1.5 pl-5 text-xs leading-relaxed">
            {limitations.map((limitation) => (
              <li key={limitation}>{limitation}</li>
            ))}
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}
