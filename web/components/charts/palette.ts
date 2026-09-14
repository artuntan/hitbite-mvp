/**
 * Chart colour roles, as CSS custom-property references.
 *
 * Every value here is a `var(--hb-...)` string, so a colour is a plain,
 * serialisable string that a server component can compute and hand to a client
 * chart, and the browser resolves it per theme with no JavaScript. The hexes,
 * the reasoning and the validator output live in `./chart-theme.css`.
 */

/** Number of steps in the ordinal ramp defined by `chart-theme.css`. */
export const RAMP_STEPS = 5;

/** Most segments a composition chart will colour individually before folding a tail into "Other". */
export const MAX_ORDINAL_SEGMENTS = RAMP_STEPS;

/** Chart chrome. */
export const CHART_SURFACE = "var(--hb-viz-surface)";
export const CHART_GRID = "var(--hb-viz-grid)";
export const CHART_AXIS = "var(--hb-viz-axis)";
export const CHART_LABEL = "var(--hb-viz-label)";
export const CHART_HOVER = "var(--hb-viz-hover)";

/** Single-series fill/stroke: the app accent, so one-series charts read as part of the UI. */
export const CHART_SERIES = "var(--hb-viz-series)";

/** "Not a bond" buckets. Never used for a bond position. */
export const CHART_NEUTRAL = "var(--hb-viz-neutral)";
export const CHART_NEUTRAL_2 = "var(--hb-viz-neutral-2)";

/**
 * `n` evenly spaced steps of the ordinal ramp, least prominent first.
 *
 * Even spacing (rather than "the first n") keeps the lightness gaps at or above
 * the ramp's own 0.075 step, which is why the 3- and 4-step subsets still clear
 * the validator's 0.06 adjacent-delta-L floor in both themes.
 *
 * @throws RangeError when `n` is outside 1..RAMP_STEPS — the caller must fold
 * the tail of a longer list into an "Other" bucket rather than invent a hue.
 */
export function rampScale(n: number): string[] {
  if (!Number.isInteger(n) || n < 1 || n > RAMP_STEPS) {
    throw new RangeError(`rampScale: expected 1..${RAMP_STEPS} steps, got ${n}`);
  }
  if (n === 1) return [`var(--hb-ramp-${RAMP_STEPS})`];
  return Array.from({ length: n }, (_, i) => {
    const step = 1 + Math.round((i * (RAMP_STEPS - 1)) / (n - 1));
    return `var(--hb-ramp-${step})`;
  });
}
