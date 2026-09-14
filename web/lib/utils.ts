import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merge conditional class names and resolve conflicting Tailwind utilities,
 * so a caller's `className` always wins over a component's defaults.
 *
 *   cn("px-3 text-muted", isActive && "text-ink", className)
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
