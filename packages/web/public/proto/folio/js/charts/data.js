import { isNumericType, toMs } from "../format.js";

/** A visual channel maps a column the query did not return. Shown in the panel, never a blank chart. */
export class ChannelError extends Error {}

export const col = (result, channel, name) => {
  const index = result.columns.findIndex((c) => c.name === name);
  if (index < 0)
    throw new ChannelError(
      `Channel ${channel} maps '${name}', which the query did not return. Returned: ${result.columns.map((c) => c.name).join(", ")}.`,
    );
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
    const group = groups.get(key);
    if (group) group.push(row);
    else groups.set(key, [row]);
  }
  return groups;
};

export const seriesColor = (i) => `var(--series-${(i % 5) + 1})`;
