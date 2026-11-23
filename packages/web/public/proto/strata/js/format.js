/** Number, time and cell formatting shared by every view. */
export const toMs = (v) => {
  if (typeof v === "number") return v;
  if (v instanceof Date) return v.getTime();
  return new Date(String(v)).getTime();
};

const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const full = new Intl.NumberFormat("en", { maximumFractionDigits: 2 });

export const num = (v, unit) => {
  const text = Math.abs(v) >= 100_000 ? compact.format(v) : full.format(v);
  return unit ? `${text} ${unit}` : text;
};

const pad = (n) => String(n).padStart(2, "0");

export const clock = (ms) => `${pad(new Date(ms).getHours())}:${pad(new Date(ms).getMinutes())}`;

export const clockSeconds = (value) => {
  const ms = toMs(value);
  if (Number.isNaN(ms)) return String(value ?? "unknown");
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Axis label for a timestamp: clock time within a day or two, date beyond. */
export const timeLabel = (ms, spanMs) => {
  const d = new Date(ms);
  if (spanMs <= 2 * 86_400_000) return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
};

export const isNumericType = (type) => type === "int" || type === "float" || type === "duration";

export const cell = (v, type) => {
  if (v === null || v === undefined) return "—";
  if (type === "timestamp") {
    const ms = toMs(v);
    return Number.isNaN(ms) ? String(v) : new Date(ms).toISOString().replace("T", " ").slice(0, 19);
  }
  if (typeof v === "number") return full.format(v);
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
};

export const initials = (name) =>
  name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
