import { num, timeFormatter } from "../format.js";

export const linear = (d0, d1, r0, r1) => {
  const span = d1 - d0 || 1;
  return (v) => r0 + ((v - d0) / span) * (r1 - r0);
};

const niceStep = (span, count) => {
  const raw = span / Math.max(1, count);
  const p = 10 ** Math.floor(Math.log10(raw));
  const f = raw / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
};

/** A padded domain snapped to round values, and the ticks inside it. */
export const niceScale = (min, max, count = 5) => {
  let lo = min;
  let hi = max;
  if (lo === hi) {
    const pad = lo === 0 ? 1 : Math.abs(lo) * 0.1;
    lo -= pad;
    hi += pad;
  }
  const step = niceStep(hi - lo, count);
  const d0 = Math.floor(lo / step) * step;
  const d1 = Math.ceil(hi / step) * step;
  const ticks = [];
  for (let i = 0; d0 + i * step <= d1 + step / 2; i++) ticks.push(Math.round((d0 + i * step) / step) * step);
  return { domain: [d0, d1], ticks, label: (v) => num(v) };
};

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const STEPS = [MIN, 5 * MIN, 15 * MIN, 30 * MIN, HOUR, 3 * HOUR, 6 * HOUR, 12 * HOUR, DAY, 2 * DAY, 7 * DAY, 30 * DAY, 90 * DAY, 365 * DAY];

/** Ticks for a continuous x axis: time (UTC) or plain numbers. Domain is the data extent, ticks sit inside it. */
export const continuousTicks = (kind, min, max, count) => {
  if (kind === "time") {
    const step = STEPS.find((s) => (max - min) / s <= count) ?? STEPS[STEPS.length - 1];
    const fmt = timeFormatter(max - min);
    const ticks = [];
    for (let t = Math.ceil(min / step) * step; t <= max; t += step) ticks.push(t);
    return { ticks, label: fmt };
  }
  const step = niceStep(max - min || 1, count);
  const ticks = [];
  for (let t = Math.ceil(min / step) * step; t <= max + step / 1e6; t += step) ticks.push(Math.round(t / step) * step);
  return { ticks, label: (v) => num(v) };
};

export const band = (count, r0, r1, padding = 0.25) => {
  const step = (r1 - r0) / Math.max(1, count);
  const bandwidth = step * (1 - padding);
  return { start: (i) => r0 + i * step + (step - bandwidth) / 2, bandwidth, step };
};

export const truncate = (text, max) => (text.length > max ? `${text.slice(0, Math.max(1, max - 1))}…` : text);
