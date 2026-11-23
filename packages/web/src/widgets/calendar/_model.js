// Calendar helpers (all dates are UTC days, CONTRACT 1.5): ranges, grouping, entry presentation.
import { h } from "../../ds/js/dom.js";
import { icon, ICON_PATHS } from "../../ds/js/icons.js";
import { statusPill, pill } from "../../ds/js/pill.js";
import { enumLabel } from "../promotions/_kit.js";

export const TYPES = ["promotion", "content", "automation", "expiry", "task"];
export const TYPE_META = {
  promotion: { label: "Promotions", one: "Promotion", icon: "percent" },
  content: { label: "Content", one: "Content", icon: "document" },
  automation: { label: "Automations", one: "Automation", icon: "workflow" },
  expiry: { label: "Point expiry", one: "Expiry", icon: "clock" },
  task: { label: "Tasks", one: "Task", icon: "task" },
};

const DAY = 86400000;
const p2 = (n) => String(n).padStart(2, "0");

/** `YYYY-MM-DD` of an instant, in UTC. */
export const ymd = (d) => new Date(d).toISOString().slice(0, 10);
export const dayStart = (key) => new Date(`${key}T00:00:00.000Z`);
export const addDaysKey = (key, n) => ymd(dayStart(key).getTime() + n * DAY);
/** Monday-first weekday index 0..6 of a day key. */
export const weekdayIndex = (key) => (dayStart(key).getUTCDay() + 6) % 7;
export const mondayOf = (key) => addDaysKey(key, -weekdayIndex(key));
export const monthKey = (key) => key.slice(0, 7);
export const firstOfMonth = (key) => `${key.slice(0, 7)}-01`;
export const shiftMonth = (key, n) => {
  const d = dayStart(firstOfMonth(key));
  const m = d.getUTCMonth() + n;
  const out = new Date(Date.UTC(d.getUTCFullYear() + Math.floor(m / 12), ((m % 12) + 12) % 12, 1));
  const want = Number(key.slice(8, 10));
  const last = new Date(Date.UTC(out.getUTCFullYear(), out.getUTCMonth() + 1, 0)).getUTCDate();
  return `${ymd(out).slice(0, 8)}${p2(Math.min(want, last))}`;
};

/** The days to show and the API range `[from, to)` for a view. */
export const rangeFor = (view, cursor) => {
  let first;
  let count;
  if (view === "month") {
    first = mondayOf(firstOfMonth(cursor));
    count = 42;
  } else if (view === "week") {
    first = mondayOf(cursor);
    count = 7;
  } else {
    first = cursor;
    count = 1;
  }
  const days = Array.from({ length: count }, (_, i) => addDaysKey(first, i));
  return { days, from: `${first}T00:00:00.000Z`, to: `${addDaysKey(first, count)}T00:00:00.000Z` };
};

const endOf = (e) => e.ends_at ?? e.starts_at;

/** Does the entry touch the UTC day? */
export const touchesDay = (e, key) => {
  const start = dayStart(key).getTime();
  const end = start + DAY;
  const s = new Date(e.starts_at).getTime();
  const f = new Date(endOf(e)).getTime();
  return s < end && f >= start;
};

export const isMultiDay = (e) => Boolean(e.ends_at) && ymd(e.ends_at) !== ymd(e.starts_at);

/**
 * `{ [dayKey]: entries[] }` for the given days; multi-day entries appear on every day they cover, or with
 * `once` only on the first of those days (a list such as the agenda must not repeat a window daily).
 */
export const groupByDay = (entries, days, { once = false } = {}) => {
  const out = Object.fromEntries(days.map((d) => [d, []]));
  for (const e of entries)
    for (const d of days)
      if (touchesDay(e, d)) {
        out[d].push(e);
        if (once) break;
      }
  for (const d of days)
    out[d].sort(
      (a, b) =>
        Number(isMultiDay(b)) - Number(isMultiDay(a)) ||
        a.starts_at.localeCompare(b.starts_at) ||
        a.title.localeCompare(b.title),
    );
  return out;
};

/** "start", "end", "middle" or "single" for the entry on a given day. */
export const phaseOn = (e, key) => {
  if (!isMultiDay(e)) return "single";
  const s = ymd(e.starts_at);
  const f = ymd(e.ends_at);
  if (key === s) return "start";
  if (key === f) return "end";
  return "middle";
};

export const timeText = (iso) => `${iso.slice(11, 16)} UTC`;
export const entryTime = (e, key) => {
  const phase = phaseOn(e, key);
  if (phase === "single")
    return timeText(e.starts_at) === "00:00 UTC" && !e.ends_at ? "All day" : timeText(e.starts_at);
  if (phase === "start") return `Starts ${timeText(e.starts_at)}`;
  if (phase === "end") return `Ends ${timeText(e.ends_at)}`;
  return "Ongoing";
};

export const safeIcon = (name, fallback = "calendar", size = 16) =>
  icon(name in ICON_PATHS ? name : fallback, { size });

/** The id the page bus carries for a promotion or content entry. */
export const busId = (e) => {
  const fromId = String(e.id ?? "").split(":");
  if (fromId.length > 1 && fromId[1]) return fromId[fromId.length - 1];
  return (
    String(e.href ?? "")
      .split("/")
      .filter(Boolean)
      .pop() ?? null
  );
};

/** A status pill for an entry, falling back to a plain pill for statuses outside the vocabularies. */
export const entryStatus = (e) => {
  const vocab = { promotion: "promotion", content: "content", task: "task" }[e.type];
  try {
    if (vocab && e.status) return statusPill(vocab, e.status);
  } catch {
    /* fall through to the plain pill */
  }
  return e.status ? pill({ label: enumLabel(e.status), tone: e.tone ?? "neutral" }) : null;
};

export const dayLabel = (key, nowKey) => {
  const d = dayStart(key);
  const diff = Math.round((d.getTime() - dayStart(nowKey).getTime()) / DAY);
  const base = new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(d);
  if (diff === 0) return `Today, ${base}`;
  if (diff === 1) return `Tomorrow, ${base}`;
  return base;
};

export const monthTitle = (key) =>
  new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(dayStart(key));

export const longDay = (key) =>
  new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(dayStart(key));

/** A compact entry link-or-button row used by drawers and the agenda. */
export const entryRow = (e, key, { onOpen } = {}) =>
  h(
    "a",
    {
      class: `wc-entry wc-tone--${e.tone ?? "neutral"}`,
      href: e.href,
      onclick: () => onOpen?.(e),
    },
    h("span", { class: "wc-entry__icon" }, safeIcon(e.icon, TYPE_META[e.type]?.icon ?? "calendar")),
    h(
      "span",
      { class: "wc-entry__text" },
      h("span", { class: "wc-entry__title" }, e.title),
      h(
        "span",
        { class: "wc-entry__meta u-muted" },
        `${TYPE_META[e.type]?.one ?? e.type} · ${entryTime(e, key)}`,
      ),
    ),
    entryStatus(e),
  );
