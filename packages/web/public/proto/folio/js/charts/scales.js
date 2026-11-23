import { axisNum, dayHm, hm } from "../format.js";

export const linear = (d0, d1, r0, r1) => {
  const span = d1 - d0 || 1;
  return (v) => r0 + ((v - d0) / span) * (r1 - r0);
};

/** Round the data range out to friendly tick values. */
export const niceScale = (min, max, count = 5) => {
  if (!Number.isFinite(min) || !Number.isFinite(max)) { min = 0; max = 1; }
  if (min === max) { const d = min === 0 ? 1 : Math.abs(min) * 0.1; min -= d; max += d; }
  const raw = (max - min) / Math.max(1, count - 1);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
  const lo = Math.floor(min / step + 1e-9) * step;
  const hi = Math.ceil(max / step - 1e-9) * step;
  const ticks = [];
  for (let i = 0; lo + i * step <= hi + step / 2; i++) ticks.push(Number((lo + i * step).toPrecision(12)));
  return { min: lo, max: hi, ticks };
};

const STEPS = [1e3, 5e3, 15e3, 30e3, 6e4, 5 * 6e4, 10 * 6e4, 15 * 6e4, 30 * 6e4, 36e5, 3 * 36e5, 6 * 36e5, 12 * 36e5, 864e5, 7 * 864e5];

/** Tick positions for a time axis (milliseconds, UTC) and a formatter matching the step. */
export const timeTicks = (min, max, target) => {
  const span = Math.max(1, max - min);
  const step = STEPS.find((s) => span / s <= target) ?? STEPS[STEPS.length - 1];
  const ticks = [];
  for (let t = Math.ceil(min / step) * step; t <= max; t += step) ticks.push(t);
  return { ticks, format: span > 864e5 ? dayHm : hm };
};

export const textWidth = (text, fontPx) => String(text).length * fontPx * 0.58;

/** Spread labels vertically so they do not overlap while staying close to their anchor. */
export const spreadLabels = (items, minGap, lo, hi) => {
  const sorted = [...items].sort((a, b) => a.y - b.y);
  sorted.forEach((it, i) => { it.ly = i === 0 ? Math.max(lo, it.y) : Math.max(it.y, sorted[i - 1].ly + minGap); });
  for (let i = sorted.length - 1; i >= 0; i--) {
    const limit = i === sorted.length - 1 ? hi : sorted[i + 1].ly - minGap;
    sorted[i].ly = Math.min(sorted[i].ly, limit);
  }
  return sorted;
};

export const tickLabels = (ticks) => ticks.map((t) => axisNum(t));

/** Smooth path through points (Catmull-Rom converted to cubic Beziers). */
export const smoothPath = (pts) => {
  if (pts.length < 3) return pts.map((p, i) => `${i ? "L" : "M"}${p[0]} ${p[1]}`).join("");
  let d = `M${pts[0][0]} ${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    d += `C${p1[0] + (p2[0] - p0[0]) / 6} ${p1[1] + (p2[1] - p0[1]) / 6} ${p2[0] - (p3[0] - p1[0]) / 6} ${p2[1] - (p3[1] - p1[1]) / 6} ${p2[0]} ${p2[1]}`;
  }
  return d;
};

export const linePath = (pts) => pts.map((p, i) => `${i ? "L" : "M"}${p[0]} ${p[1]}`).join("");
