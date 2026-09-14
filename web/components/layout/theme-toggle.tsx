"use client";

import * as React from "react";
import { useTheme } from "next-themes";
import { Monitor, Moon, Sun } from "lucide-react";

import { cn } from "@/lib/utils";

const OPTIONS = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "system", label: "System", Icon: Monitor },
  { value: "dark", label: "Dark", Icon: Moon },
] as const;

/**
 * Light / System / Dark, as three native radios in a segmented control.
 *
 * No popover library: this is the only interactive control the shell ships to
 * every public page, and a Radix dropdown here costs ~88 kB of JavaScript on
 * pages that are graded on Lighthouse performance. Native radios also give the
 * roving arrow-key behaviour and the group semantics for free.
 *
 * Nothing flashes: next-themes sets the class on <html> from a blocking inline
 * script, so the first paint is already in the right theme. The selected pip is
 * only drawn once `mounted` is true, which keeps the hydration render identical
 * to the server render (the server cannot know the visitor's stored choice).
 */
export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => setMounted(true), []);

  return (
    <fieldset className="border-border bg-surface-sunken flex items-center gap-0.5 rounded-md border p-0.5">
      <legend className="sr-only">Colour theme</legend>
      {OPTIONS.map(({ value, label, Icon }) => {
        const checked = mounted && theme === value;
        return (
          <label
            key={value}
            title={label}
            className={cn(
              "flex size-7 cursor-pointer items-center justify-center rounded transition-colors",
              "has-[:focus-visible]:outline-ring has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2",
              checked ? "bg-surface text-ink shadow-raised" : "text-muted hover:text-ink",
            )}
          >
            <input
              type="radio"
              name="hitbite-theme"
              value={value}
              checked={checked}
              onChange={() => setTheme(value)}
              className="sr-only"
            />
            <Icon aria-hidden="true" className="size-4" />
            <span className="sr-only">{label}</span>
          </label>
        );
      })}
    </fieldset>
  );
}
