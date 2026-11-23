// Shared plumbing for the SVG charts: column resolution, scales, responsive mounting, legends.
import { h, s, frameOnce, uid } from "./dom.js";
import { clock, isNumericType, toMs } from "./format.js";

/** A visual channel maps a column the query did not return. Surfaced in the panel, never a blank chart. */
export class ChannelError extends Error {}

export const col = (result, channel, name) => {
  const index = result.columns.findIndex((c) => c.name === name);
  if (index < 0) {
    throw new ChannelError(
      `Channel ${channel} maps '${name}', which the query did not return. Returned: ${result.columns.map((c) => c.name).join(", ")}.`,
    );
  }
  return { index, name, type: result.columns[index].type };
};

export const optCol = (result, channel, name) => (name === undefined ? undefined : col(result, channel, name));

export const axisKind = (c) => (c.type === "timestamp" ? "time" : isNumericType(c.type) ? "value" : "category");

export const axisValue = (v, kind) => (kind === "time" ? toMs(v) : kind === "value" ? Number(v) : String(v));

export const numeric = (v) => {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Group rows by an optional series column, preserving first-seen order. */
export const groupRows = (result, series) => {
  const groups = new Map();
  for (const row of result.rows) {
    const key = series ? String(row[series.index]) : "";
    if (groups.has(key)) groups.get(key).push(row);
    else groups.set(key, [row]);
  }
  return groups;
};

export const SERIES_COUNT = 5;
export const seriesClass = (i) => `s${i % SERIES_COUNT}`;

export const linear = (d0, d1, r0, r1) => {
  const k = d1 === d0 ? 0 : (r1 - r0) / (d1 - d0);
  return (v) => r0 + (v - d0) * k;
};

export const extent = (values) => {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of values) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return lo === Infinity ? [0, 1] : [lo, hi];
};

const pad2 = (n) => String(n).padStart(2, "0");

/** Axis label for a timestamp; includes the date once the span exceeds a day and a half. */
export const timeLabel = (ms, span) => {
  if (span <= 36 * 3_600_000) return clock(ms);
  const d = new Date(ms);
  return `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};

export const truncate = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** Approximate rendered width of a label in px; avoids measuring the DOM inside draw loops. */
export const textWidth = (text, size) => String(text).length * size * 0.58;

/** Pick at most `max` evenly spaced items, always keeping first and last. */
export const sample = (items, max) => {
  if (items.length <= max) return items;
  const out = [];
  const step = (items.length - 1) / Math.max(1, max - 1);
  for (let i = 0; i < max; i += 1) out.push(items[Math.round(i * step)]);
  return [...new Set(out)];
};

/** Hatched fill, defined per SVG so ids never collide. Threshold breaches carry it in addition to colour. */
export const hatchDef = () => {
  const id = uid("hatch");
  const def = s(
    "pattern",
    { id, width: 6, height: 6, patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)" },
    s("rect", { class: "hatch__bg", width: 6, height: 6 }),
    s("line", { class: "hatch__line", x1: 0, y1: 0, x2: 0, y2: 6 }),
  );
  return { id, def, ref: `url(#${id})` };
};

/** Root <svg role="img"> with an accessible name and description. */
export const chartSvg = ({ width, height, title, desc, className }) => {
  const titleId = uid("t");
  const descId = uid("d");
  return s(
    "svg",
    {
      class: `chart__svg ${className ?? ""}`.trim(),
      viewBox: `0 0 ${width} ${height}`,
      width,
      height,
      role: "img",
      "aria-labelledby": `${titleId} ${descId}`,
    },
    s("title", { id: titleId }, title),
    s("desc", { id: descId }, desc),
  );
};

/**
 * Keep an SVG drawn at the size of its host. `draw({width, height, fs})` returns an element.
 * Redraws only when the measured size changes, and at most once per frame.
 */
export const mountChart = (host, draw) => {
  let last = "";
  const paint = () => {
    const width = Math.floor(host.clientWidth);
    const height = Math.floor(host.clientHeight);
    if (width < 48 || height < 32) return;
    const key = `${width}x${height}`;
    if (key === last) return;
    last = key;
    const fs = parseFloat(getComputedStyle(host).fontSize) || 16;
    host.replaceChildren(draw({ width, height, fs }));
  };
  const observer = new ResizeObserver(frameOnce(paint));
  observer.observe(host);
  paint();
  return {
    redraw() {
      last = "";
      paint();
    },
    dispose() {
      observer.disconnect();
    },
  };
};

/** Legend list. items: [{name, cls, kind}] where kind is "line" | "area" | "dot" | "hatch". */
export const legend = (items, label = "Legend") =>
  items.length === 0
    ? null
    : h(
        "ul",
        { class: "legend", "aria-label": label },
        items.map((it) =>
          h(
            "li",
            { class: "legend__item" },
            s(
              "svg",
              { class: `legend__swatch ${it.cls ?? ""}`, viewBox: "0 0 20 10", width: 20, height: 10, "aria-hidden": "true", focusable: "false" },
              it.kind === "hatch"
                ? s("rect", { class: "legend__hatch", x: 1, y: 1, width: 18, height: 8 })
                : it.kind === "dot"
                  ? s("circle", { class: "legend__dot", cx: 10, cy: 5, r: 3.5 })
                  : s("line", { class: "legend__line", x1: 0, y1: 5, x2: 20, y2: 5 }),
            ),
            it.name,
          ),
        ),
      );
