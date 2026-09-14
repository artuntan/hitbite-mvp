"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";
import type { NavItem } from "@/components/layout/nav-items";

/**
 * A header link that marks itself `aria-current="page"` when active. This is
 * the only client component in the shell besides the theme toggle; it pulls in
 * nothing beyond `next/navigation`, so public pages stay light.
 */
export function NavLink({ item }: { item: NavItem }) {
  const pathname = usePathname();
  const isActive = item.matchPrefix
    ? pathname === item.href || pathname.startsWith(`${item.href}/`)
    : pathname === item.href;

  return (
    <Link
      href={item.href}
      aria-current={isActive ? "page" : undefined}
      className={cn(
        "rounded px-1 py-1 text-sm transition-colors",
        "focus-visible:outline-ring focus-visible:outline-2 focus-visible:outline-offset-2",
        isActive
          ? "text-ink decoration-accent font-medium underline decoration-2 underline-offset-8"
          : "text-muted hover:text-ink",
      )}
    >
      {item.label}
    </Link>
  );
}
