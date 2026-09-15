/**
 * The two poles of the diverging flow encoding, as CSS custom-property
 * references.
 *
 * Same convention as `components/charts/palette.ts`: a colour is a plain string
 * a server component can hand to a client chart, and the browser resolves it per
 * theme with no JavaScript. The hexes, the reasoning and the validator output
 * live in `./flow-theme.css`.
 */

/** USDC into the vault — the cool pole, the app accent. */
export const FLOW_IN = "var(--hb-flow-in)";

/** USDC out of the vault — the warm pole. */
export const FLOW_OUT = "var(--hb-flow-out)";

/** The zero rule between them. Neutral grey: the diverging midpoint is never a hue. */
export const FLOW_ZERO = "var(--hb-flow-zero)";
