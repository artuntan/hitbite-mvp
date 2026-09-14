/**
 * Axis domains and ticks, computed as integers.
 *
 * Every money figure in this app is carried as a 6-decimal integer (PLAN.md D22)
 * and formatted from that integer. Axis ticks are no exception: Recharts would
 * otherwise pick its own tick values as floats, and `formatFixed` — which takes a
 * bigint — could not render them exactly. So the domain and the tick values are
 * chosen here, as integers on the same 6-decimal scale, and passed to the chart.
 *
 * `number` rather than `bigint` because the values cross a server/client
 * boundary as props and have to be JSON-serialisable. A 6-decimal USD integer
 * stays far below Number.MAX_SAFE_INTEGER (9.0e15) until about 9 billion USD, so
 * the round trip is exact for anything this fund can hold.
 */

export interface AxisScale {
  /** `[min, max]` for the axis, in the same integer units as the data. */
  domain: [number, number];
  /** Tick values, ascending, every one an integer. */
  ticks: number[];
}

/** 1 / 2 / 2.5 / 5 / 10 x a power of ten — the step sizes that read as "round". */
const STEP_MULTIPLES = [1, 2, 2.5, 5, 10] as const;

/**
 * A domain and 3–6 round ticks covering `[min, max]`.
 *
 * @param min lowest value in the series (ignored when `zeroBased`)
 * @param max highest value in the series
 * @param targetIntervals how many gaps between ticks to aim for
 * @param zeroBased force the axis to start at zero — mandatory for bars, whose
 * length is the value; a truncated bar axis is a lie about magnitude
 */
export function integerAxisScale(
  min: number,
  max: number,
  {
    targetIntervals = 4,
    zeroBased = false,
  }: { targetIntervals?: number; zeroBased?: boolean } = {},
): AxisScale {
  const lowInput = zeroBased ? 0 : min;
  const highInput = Math.max(max, lowInput);

  // A flat series still needs an axis; give it one unit of room either side.
  const span = highInput - lowInput;
  if (!Number.isFinite(span) || span <= 0) {
    const low = zeroBased ? 0 : lowInput - 1;
    const high = highInput + 1;
    return { domain: [low, high], ticks: [low, high] };
  }

  const rawStep = span / Math.max(1, targetIntervals);
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  let step = magnitude;
  for (const multiple of STEP_MULTIPLES) {
    step = multiple * magnitude;
    if (step >= rawStep) break;
  }
  // Ticks must land on integers so they can be formatted from a bigint.
  step = Math.max(1, Math.round(step));

  const low = Math.floor(lowInput / step) * step;
  const high = Math.ceil(highInput / step) * step;
  const ticks: number[] = [];
  for (let value = low; value <= high; value += step) ticks.push(value);

  return { domain: [low, high], ticks };
}
