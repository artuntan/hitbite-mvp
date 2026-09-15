import { Card, CardContent, Stat, StatList } from "@/components/ui/card";

import type { Figure } from "./view-model";

interface StatsFiguresProps {
  figures: Figure[];
}

/**
 * The five figures BUILD_PROMPT 7.2 leads `/stats` with: holders, supply,
 * subscriptions, redemptions and distributions to date.
 *
 * Every one is a count or a sum of contract logs, so every one carries its basis
 * in the hint rather than leaving the reader to guess what it counts. A figure
 * the index can only bound from below is written `≥ n`, because a floor that
 * looks like an answer is the failure mode this page exists to avoid.
 */
export function StatsFigures({ figures }: StatsFiguresProps) {
  return (
    <Card data-testid="stats-figures">
      <CardContent className="p-5 sm:p-6">
        <h3 className="sr-only">Headline figures</h3>
        <StatList className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {figures.map((figure) => (
            <Stat
              key={figure.key}
              data-testid={`figure-${figure.key}`}
              label={figure.label}
              value={figure.value}
              hint={figure.hint}
            />
          ))}
        </StatList>
      </CardContent>
    </Card>
  );
}
