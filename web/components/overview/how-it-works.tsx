import { Card, CardContent } from "@/components/ui/card";
import { HOW_IT_WORKS_STEPS } from "@/lib/copy";

/**
 * "How it works" in five steps.
 *
 * The wording is BUILD_PROMPT section 15 copy, rendered verbatim from
 * `lib/copy.ts` — `HOW_IT_WORKS_STEPS` is the same sentence run with only the
 * leading numerals lifted out so the list can number itself.
 */
export function HowItWorks() {
  return (
    <Card>
      <CardContent className="p-5 sm:p-6">
        <ol className="grid gap-5 sm:grid-cols-2 lg:grid-cols-5 lg:gap-6">
          {HOW_IT_WORKS_STEPS.map((step) => (
            <li key={step.step} className="flex flex-col gap-2">
              <span
                aria-hidden="true"
                className="border-border-strong text-muted num flex size-7 items-center justify-center rounded-full border text-xs font-medium"
              >
                {step.step}
              </span>
              <p className="text-ink text-sm leading-relaxed">{step.text}</p>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
