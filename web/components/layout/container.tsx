import * as React from "react";

import { cn } from "@/lib/utils";

interface ContainerProps extends React.HTMLAttributes<HTMLDivElement> {
  /** `prose` narrows the measure for long-form copy (rules, risks). */
  width?: "default" | "prose" | "wide";
  as?: "div" | "section" | "header" | "footer" | "main";
}

const widths = {
  default: "max-w-6xl",
  prose: "max-w-3xl",
  wide: "max-w-[90rem]",
} as const;

/** The one horizontal rhythm every page uses. */
const Container = React.forwardRef<HTMLDivElement, ContainerProps>(function Container(
  { className, width = "default", as: Comp = "div", ...props },
  ref,
) {
  return (
    <Comp
      ref={ref}
      className={cn("mx-auto w-full px-4 sm:px-6 lg:px-8", widths[width], className)}
      {...props}
    />
  );
});

export { Container };
