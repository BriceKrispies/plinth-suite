import { cell, isNumericType, num, toMs } from '../format.js';

/** A visual channel maps a column the query did not return. Surfaced in the panel, never a blank chart. */
export class ChannelError extends Error {}

export const col = (result, channel, name) => {
  const index = result.columns.findIndex((c) => c.name === name);
  if (index < 0)
    throw new ChannelError(
      `Channel ${channel} maps '${name}', which the query did not return. Returned: ${result.columns.map((c) => c.name).join(', ')}.`,
    );
  return { index, name, type: result.columns[index].type };
};

export const optCol = (result, channel, name) => (name === undefined ? undefined : col(result, channel, name));

export const axisKind = (c) => (c.type === 'timestamp' ? 'time' : isNumericType(c.type) ? 'value' : 'category');

export const numeric = (v) => {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export const axisValue = (v, kind) => (kind === 'time' ? toMs(v) : Number(v));

/** Rows grouped by an optional series column, first-seen order. */
export const groupRows = (result, series) => {
  const groups = new Map();
  for (const row of result.rows) {
    const key = series ? String(row[series.index]) : '';
    if (groups.has(key)) groups.get(key).push(row);
    else groups.set(key, [row]);
  }
  return groups;
};

// ---- Thresholds: breaches are reported in words as well as drawn ----------------------------

export const thresholdOf = (visual, result) => {
  if (!visual?.threshold) return undefined;
  const name = visual.channels?.value ?? visual.channels?.y;
  const index = result.columns.findIndex((c) => c.name === name);
  if (index < 0) return undefined;
  return { index, value: visual.threshold.value, unit: visual.options?.unit };
};

export const isBreach = (th, row) => {
  const v = numeric(row[th.index]);
  return v !== null && v > th.value;
};

const labelChannels = (visual) => {
  const c = visual.channels ?? {};
  if (visual.type === 'heatmap') return [c.x, c.y];
  if (visual.type === 'kpi') return [];
  return [c.x, c.color ?? c.series];
};

/** One sentence naming what crossed the threshold, or '' when nothing did. */
export const breachNote = (visual, result) => {
  const th = thresholdOf(visual, result);
  if (!th) return '';
  const hits = result.rows.filter((r) => isBreach(th, r));
  if (!hits.length) return '';
  const idx = labelChannels(visual)
    .map((n) => result.columns.findIndex((c) => c.name === n))
    .filter((i) => i >= 0);
  const label = (r) => idx.map((i) => cell(r[i], result.columns[i].type)).join(' / ');
  const shown = hits
    .slice(0, 3)
    .map((r) => (idx.length ? `${label(r)} (${num(Number(r[th.index]), th.unit)})` : num(Number(r[th.index]), th.unit)))
    .join(', ');
  const more = hits.length > 3 ? ` and ${hits.length - 3} more` : '';
  return `${hits.length} above threshold ${num(th.value, th.unit)}: ${shown}${more}`;
};
