// Scales and tick generation. Small, pure, dependency free.
export const linear = (d0, d1, r0, r1) => {
  const k = (r1 - r0) / (d1 - d0 || 1);
  const f = (v) => r0 + (v - d0) * k;
  f.invert = (p) => d0 + (p - r0) / k;
  f.domain = [d0, d1];
  f.range = [r0, r1];
  return f;
};

const NICE = [1, 2, 2.5, 5, 10];
const niceStep = (span, count) => {
  const raw = span / count;
  const p = 10 ** Math.floor(Math.log10(raw));
  return (NICE.find((n) => n >= raw / p - 1e-9) ?? 10) * p;
};

export const niceDomain = (min, max, count = 5) => {
  const hi = min === max ? min + 1 : max;
  const step = niceStep(hi - min, count);
  const lo = Math.floor(min / step) * step;
  const top = Math.ceil(hi / step) * step;
  const ticks = [];
  for (let v = lo; v <= top + step / 2; v += step) ticks.push(+v.toFixed(10));
  return { min: lo, max: top, ticks };
};

const MIN = 60_000;
const STEPS = [1, 5, 15, 30, 60, 180, 360, 720, 1440, 2880, 10080].map((m) => m * MIN);
export const timeTicks = (min, max, count = 5) => {
  const step = STEPS.find((x) => (max - min) / x <= count) ?? STEPS.at(-1);
  const ticks = [];
  for (let v = Math.ceil(min / step) * step; v <= max; v += step) ticks.push(v);
  return ticks;
};

/** Evenly spaced bands for categories. */
export const band = (count, r0, r1, padding = 0.2) => {
  const step = (r1 - r0) / Math.max(count, 1);
  const width = step * (1 - padding);
  const at = (i) => r0 + step * i + (step - width) / 2;
  at.width = width;
  at.step = step;
  return at;
};

export const extent = (values) => {
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return [min, max];
};
