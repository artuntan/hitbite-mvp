import { Container } from "@/components/layout/container";
import { Card, CardContent, Stat, StatList } from "@/components/ui/card";
import type { Metric } from "@/components/overview/view-model";

interface KeyMetricsProps {
  metrics: Metric[];
}

/**
 * The headline figures: NAV, weighted YTM, modified duration, trailing
 * distribution yield. Each carries its unit and its as-of date.
 *
 * A metric the engine has not produced yet shows why, not a zero — "0.00%"
 * would read as "this fund pays nothing", which is a different claim from
 * "there is not enough history to annualise yet".
 */
export function KeyMetrics({ metrics }: KeyMetricsProps) {
  const notes = metrics.filter((metric) => metric.value === null && metric.note);

  return (
    <Container className="pb-2">
      <Card>
        <CardContent className="p-5 sm:p-6">
          <h2 className="sr-only">Key metrics</h2>
          <StatList className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {metrics.map((metric) => (
              <Stat
                key={metric.key}
                label={metric.label}
                value={
                  metric.value ?? (
                    <span className="text-muted font-sans text-lg font-medium">
                      {metric.unavailable ?? "Not yet available"}
                    </span>
                  )
                }
                hint={metric.hint}
              />
            ))}
          </StatList>

          {notes.length > 0 ? (
            <div className="border-border mt-6 flex flex-col gap-2 border-t pt-4">
              {notes.map((metric) => (
                <p key={metric.key} className="text-muted text-xs leading-relaxed">
                  <span className="text-ink font-medium">{metric.label}:</span> {metric.note}
                </p>
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </Container>
  );
}
