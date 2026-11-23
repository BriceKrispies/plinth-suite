// Number, points, date and text formatting (DESIGN-SYSTEM 9.7). Pure functions, no DOM.
const THIN = " ";
const NBSP = " ";

let prefs = { locale: undefined, timeZone: undefined, currency: "USD" };
/** Called by the prefs store; formatting falls back to the browser's locale and zone. */
export const configureFormat = (next) => {
  prefs = { ...prefs, ...next };
};

const group = (digits) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, THIN);

export const number = (n) => {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return "–";
  const v = Math.round(Number(n) * 100) / 100;
  const [i, d] = String(Math.abs(v)).split(".");
  return `${v < 0 ? "−" : ""}${group(i)}${d ? `.${d}` : ""}`;
};

export const points = (n) => `${number(Math.round(Number(n ?? 0)))}${NBSP}pts`;

export const signedPoints = (n) => {
  const v = Math.round(Number(n ?? 0));
  if (v === 0) return `0${NBSP}pts`;
  return `${v > 0 ? "+" : "−"}${group(String(Math.abs(v)))}${NBSP}pts`;
};

export const cents = (n) =>
  new Intl.NumberFormat(prefs.locale, { style: "currency", currency: prefs.currency }).format(
    Number(n) / 100,
  );

export const percent = (x) => {
  const v = Number(x) * 100;
  const text = Math.abs(v) >= 10 ? String(Math.round(v)) : String(Math.round(v * 10) / 10);
  return `${text}${THIN}%`;
};

const dtf = (opts) => new Intl.DateTimeFormat(prefs.locale ?? "en-GB", { timeZone: prefs.timeZone, ...opts });

export const date = (iso) =>
  iso ? dtf({ day: "numeric", month: "short", year: "numeric" }).format(new Date(iso)) : "";

export const dateTime = (iso) => {
  if (!iso) return "";
  const parts = dtf({ day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
    .formatToParts(new Date(iso))
    .reduce((acc, p) => ({ ...acc, [p.type]: p.value }), {});
  return `${parts.day} ${parts.month} ${parts.year}, ${parts.hour}:${parts.minute}`;
};

/** Pure: `nowIso` is passed in (from clockStore), never read from the clock here. */
export const relativeTime = (iso, nowIso) => {
  const diff = new Date(iso).getTime() - new Date(nowIso).getTime();
  const abs = Math.abs(diff);
  const s = abs / 1000;
  const say = (n, unit) => {
    const label = `${n} ${unit}`;
    return diff < 0 ? `${label} ago` : `in ${label}`;
  };
  if (s < 45) return "just now";
  if (s < 45 * 60) return say(Math.max(1, Math.round(s / 60)), "min");
  if (s < 22 * 3600) return say(Math.round(s / 3600), "h");
  if (s < 6 * 86400) {
    const d = Math.round(s / 86400);
    return say(d, d === 1 ? "day" : "days");
  }
  return dateTime(iso);
};

export const initials = (name) => {
  const words = String(name ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return "?";
  const first = words[0][0];
  const last = words.length > 1 ? words[words.length - 1][0] : "";
  return `${first}${last}`.toUpperCase();
};
