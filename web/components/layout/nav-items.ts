/**
 * Primary navigation.
 *
 * Only routes that exist are listed: a 404 from the header is worse than a
 * missing link, and "no dead links" is an explicit review item
 * (BUILD_PROMPT 16.5). When a page in `PLANNED_ROUTES` lands, move its entry
 * into `NAV_ITEMS` in the same commit that adds the page — the header and the
 * footer both read this one array.
 */
export interface NavItem {
  href: string;
  label: string;
  /** Used by the header for `aria-current` on nested routes. */
  matchPrefix?: boolean;
}

export const NAV_ITEMS: readonly NavItem[] = [{ href: "/", label: "Overview" }];

/**
 * Routes specified in BUILD_PROMPT 7.2 that are not built yet, with the phase
 * (PLAN.md Section 4) that delivers them. Kept here so the next agent has one
 * place to look.
 */
export const PLANNED_ROUTES: readonly (NavItem & { phase: string })[] = [
  { href: "/transparency", label: "Transparency", phase: "Phase 6" },
  { href: "/verify", label: "Verify", phase: "Phase 7" },
  { href: "/subscribe", label: "Subscribe", phase: "Phase 7" },
  { href: "/portfolio", label: "Portfolio", phase: "Phase 8" },
  { href: "/stats", label: "Stats", phase: "Phase 8" },
  { href: "/rules", label: "Rules", phase: "Phase 9" },
  { href: "/risks", label: "Risks", phase: "Phase 9" },
];
