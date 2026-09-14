import { Container } from "@/components/layout/container";
import { Badge } from "@/components/ui/badge";
import { PRODUCT_SUMMARY, TOKEN } from "@/lib/copy";
import { formatDate, formatDateTimeUtc, formatIsoDate } from "@/lib/format";

interface HeroProps {
  /** `as_of` from nav.json. */
  asOf: string;
  /** `generated_at` from nav.json. */
  generatedAt: string;
  chainLabel: string;
}

/**
 * The product in two sentences.
 *
 * `PRODUCT_SUMMARY` is BUILD_PROMPT section 15 copy and is rendered verbatim
 * from `lib/copy.ts`; it is never retyped here.
 */
export function Hero({ asOf, generatedAt, chainLabel }: HeroProps) {
  return (
    <Container as="header" className="pt-10 pb-2 sm:pt-14">
      <div className="flex max-w-3xl flex-col gap-5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="accent">
            <span className="num">{TOKEN.symbol}</span>
          </Badge>
          <Badge tone="warning">Simulated portfolio</Badge>
          <Badge tone="neutral">{chainLabel}</Badge>
        </div>

        <h1 className="text-ink text-3xl leading-tight font-semibold tracking-tight sm:text-4xl">
          {TOKEN.name}
        </h1>

        <p className="text-ink text-base leading-relaxed sm:text-lg">{PRODUCT_SUMMARY}</p>

        <p className="text-muted text-xs">
          Portfolio data as of{" "}
          <time dateTime={formatIsoDate(asOf)} className="num">
            {formatDate(asOf)}
          </time>
          , generated{" "}
          <time dateTime={generatedAt} className="num">
            {formatDateTimeUtc(generatedAt)}
          </time>
          .
        </p>
      </div>
    </Container>
  );
}
