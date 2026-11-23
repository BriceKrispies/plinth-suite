// Number, time and cell formatting. Numerals are grouped the same way everywhere.
const grouped = new Intl.NumberFormat("en", { maximumFractionDigits: 2 });
const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });

export const isNumericType = (t) => t === "int" || t === "float" || t === "duration";

export const toMs = (v) => {
  if (typeof v === "number") return v;
  if (v instanceof Date) return v.getTime();
  return new Date(String(v)).getTime();
};

export const num = (v, unit) => {
  const text = Math.abs(v) >= 100_000 ? compact.format(v) : grouped.format(v);
  return unit ? `${text} ${unit}` : text;
};

const pad = (n) => String(n).padStart(2, "0");

// All times are UTC and say so. The data is UTC; local time would disagree with what agents report.
export const clock = (ms) => {
  const d = new Date(ms);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
};

export const clockSeconds = (ms) => `${clock(ms)}:${pad(new Date(ms).getUTCSeconds())}`;

/** "14:30:00 UTC" */
export const utcTime = (ms) => `${clockSeconds(ms)} UTC`;

/** "14:30 UTC" */
export const utcClock = (ms) => `${clock(ms)} UTC`;

/** Full ISO instant for a datetime attribute. */
export const isoInstant = (ms) => new Date(ms).toISOString();

export const isoShort = (ms) => `${new Date(ms).toISOString().replace("T", " ").slice(0, 19)} UTC`;

export const cell = (v, type) => {
  if (v === null || v === undefined) return "—";
  if (type === "timestamp") {
    const ms = toMs(v);
    return Number.isNaN(ms) ? String(v) : isoShort(ms);
  }
  if (typeof v === "number") return grouped.format(v);
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
};

/** Readable label for a query column name: p95_handoff_ms becomes "p95 handoff ms". */
export const label = (name) => String(name).replace(/_/g, " ");

export const initials = (name) =>
  name
    .split(/\s+/)
    .map((p) => p[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();

/** Round a domain outward to tidy tick values. */
export const niceTicks = (min, max, count = 5) => {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { ticks: [0, 1], min: 0, max: 1 };
  if (min === max) {
    const gap = Math.abs(min) * 0.1 || 1;
    min -= gap;
    max += gap;
  }
  const rough = (max - min) / Math.max(1, count - 1);
  const mag = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((c) => c >= rough) ?? 10 * mag;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let t = lo; t <= hi + step / 2; t += step) ticks.push(Math.round(t / step) * step);
  return { ticks, min: lo, max: hi };
};
