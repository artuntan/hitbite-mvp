"use client";

import * as React from "react";
import { ThemeProvider as NextThemesProvider } from "next-themes";

/**
 * Light and dark are both first-class. `attribute="class"` puts `.dark` on
 * <html>, which is what the token overrides in globals.css key off; next-themes
 * injects a blocking inline script so the class is set before first paint and
 * the page never flashes the wrong theme.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}
