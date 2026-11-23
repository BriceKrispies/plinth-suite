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

export const isNumericType = (t) => t === "int" || t === "float" || t === "duration";

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

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAY = 86_400_000;

/** Axis label formatter chosen from the visible span; all times are shown in UTC. */
export const timeFormatter = (span) => (ms) => {
  const d = new Date(ms);
  if (span <= 2 * DAY) return d.toISOString().slice(11, 16);
  if (span <= 120 * DAY) return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};

export const clock = (ms) => new Date(ms).toLocaleTimeString("en-GB", { hour12: false });

export const initials = (name) =>
  name
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

export const stamp = (v) => {
  const ms = toMs(v);
  return Number.isNaN(ms) ? String(v ?? "—") : `${new Date(ms).toISOString().slice(0, 19).replace("T", " ")} UTC`;
};

export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
