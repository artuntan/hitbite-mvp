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

export const NAV_ITEMS: readonly NavItem[] = [
  { href: "/", label: "Overview" },
  { href: "/transparency", label: "Transparency", matchPrefix: true },
  { href: "/verify", label: "Verify", matchPrefix: true },
  { href: "/subscribe", label: "Subscribe", matchPrefix: true },
  { href: "/portfolio", label: "Portfolio", matchPrefix: true },
  { href: "/stats", label: "Stats", matchPrefix: true },
];

/**
 * Reference material and the operator console. These live in the footer rather
 * than the header: ten links across the top stops being navigation and becomes
 * a list. They are real routes and must never be treated as unbuilt.
 */
export const SECONDARY_NAV_ITEMS: readonly NavItem[] = [
  { href: "/rules", label: "Rules", matchPrefix: true },
  { href: "/risks", label: "Risks", matchPrefix: true },
  { href: "/developers", label: "Developers", matchPrefix: true },
  { href: "/admin", label: "Admin", matchPrefix: true },
];

/** Every route the app links, for a dead-link check. */
export const ALL_NAV_ITEMS: readonly NavItem[] = [...NAV_ITEMS, ...SECONDARY_NAV_ITEMS];

/**
 * Routes specified in BUILD_PROMPT 7.2 that are not built yet, with the phase
 * (PLAN.md Section 4) that delivers them. Empty now that Phase 9 has landed;
 * kept so the next page has somewhere to be listed before it exists.
 */
export const PLANNED_ROUTES: readonly (NavItem & { phase: string })[] = [];
