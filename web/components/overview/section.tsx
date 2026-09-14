import * as React from "react";

import { Container } from "@/components/layout/container";
import { cn } from "@/lib/utils";

interface SectionProps {
  /** Id of the `<h2>`; the section is labelled by it. */
  id: string;
  title: string;
  description?: React.ReactNode;
  /** Right-hand slot on the heading row, e.g. an as-of line. */
  aside?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

/** One vertical rhythm and one heading shape for every band of the Overview. */
export function Section({ id, title, description, aside, children, className }: SectionProps) {
  return (
    <Container as="section" aria-labelledby={id} className={cn("py-8 sm:py-10", className)}>
      <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1.5">
          <h2 id={id} className="text-ink text-xl font-semibold tracking-tight">
            {title}
          </h2>
          {description ? (
            <p className="text-muted max-w-2xl text-sm leading-relaxed">{description}</p>
          ) : null}
        </div>
        {aside ? <div className="text-muted shrink-0 text-xs sm:text-right">{aside}</div> : null}
      </div>
      {children}
    </Container>
  );
}
